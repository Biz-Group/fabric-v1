import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import {
  assertOrgOwns,
  requireOrgAdmin,
  requireOrgContributor,
  resolveOrgForAction,
} from "./lib/orgAuth";
import {
  isAIConfigured,
  isTokenLimitFinishReason,
} from "./lib/aiProvider";
import {
  meteredCompletion,
  recordVoiceUsage,
  type UsageAttribution,
} from "./lib/aiUsageMeter";
import { normalizeSummaryTitle } from "./lib/conversationTitle";
import { startConversationPipelines } from "./lib/conversationPipelines";
import {
  serializeUntrustedEvidence,
  withUntrustedEvidenceBoundary,
} from "./lib/aiPromptSafety";
import {
  MAX_AUDIO_DURATION_SECONDS,
  MAX_ORG_UPLOAD_BYTES_PER_WINDOW,
  MAX_ORG_UPLOADS_PER_WINDOW,
  MAX_USER_UPLOAD_BYTES_PER_WINDOW,
  MAX_USER_UPLOADS_PER_WINDOW,
  ORG_UPLOAD_WINDOW_MS,
  USER_UPLOAD_WINDOW_MS,
  VOICE_UPLOAD_GRANT_TTL_MS,
  audioFileExtension,
  audioUploadRejectionMessage,
  fixedWindowStart,
  inspectAudioUpload,
  normalizeAudioMimeType,
  validateAudioUploadMetadata,
} from "./lib/audioUpload";
import type { ResolvedAttribution } from "./postCall";

type TranscriptMessage = {
  role: string;
  content: string;
  time_in_call_secs: number;
  speakerId?: string;
  speakerName?: string;
};

type ScribeWord = {
  text?: string;
  start?: number;
  end?: number;
  type?: string;
  speaker_id?: string;
};

type ScribeResponse = {
  text?: string;
  words?: ScribeWord[];
};

type AnalysisPayload = {
  /** Empty when the model omitted it; mirrors ElevenLabs' field of the same
   *  name so every input mode titles conversations the same way. */
  call_summary_title: string;
  transcript_summary: string;
  data_collection: {
    process_steps: string;
    step_connections: string;
    step_issues: string;
    dependencies: string;
    frequency: string;
    edge_cases: string;
    total_process_duration: string;
    compliance_or_approvals: string;
  };
  success_evaluation: {
    described_specific_steps: boolean;
    mentioned_tools_or_systems: boolean;
    identified_dependencies: boolean;
  };
};

type SpeakerLabel = {
  speakerId: string;
  displayName: string;
  userId?: Id<"users">;
};

type VoiceRecordingForAnalysis = {
  processId: Id<"processes">;
  transcript: TranscriptMessage[];
  durationSeconds?: number;
};

type VoiceUploadRateLimitState = {
  row: Doc<"voiceUploadRateLimits"> | null;
  key: string;
  clerkOrgId: string;
  scope: "user" | "organization";
  windowStartedAt: number;
  uploadUrlsIssued: number;
  admittedUploads: number;
  admittedBytes: number;
};

type VoiceUploadAdmission =
  | { ok: true; conversationId: Id<"conversations"> }
  | {
      ok: false;
      reason:
        | "invalid_grant"
        | "invalid_upload"
        | "duplicate_upload"
        | "user_quota"
        | "organization_quota";
    };

const transcriptMessageValidator = v.object({
  role: v.string(),
  content: v.string(),
  time_in_call_secs: v.number(),
  speakerId: v.optional(v.string()),
  speakerName: v.optional(v.string()),
});

const speakerLabelValidator = v.object({
  speakerId: v.string(),
  displayName: v.string(),
  userId: v.optional(v.id("users")),
});

const VOICE_RECORDING_ANALYSIS_PROMPT = withUntrustedEvidenceBoundary(`You are analyzing a diarized voice recording about one business process. The transcript messages include confirmed speaker names when available.

Return ONLY a valid JSON object with this exact shape:
{
  "call_summary_title": "Short headline (4-8 words) naming what this recording covered.",
  "transcript_summary": "Concise 4-6 sentence summary of what the contributor explained.",
  "data_collection": {
    "process_steps": "JSON array string of steps: [{\\"id\\":\\"kebab-case\\",\\"name\\":\\"Step name\\",\\"type\\":\\"action|decision|handoff|wait\\",\\"actor\\":\\"person/team\\",\\"tools\\":[\\"tool\\"],\\"duration\\":\\"duration or null\\"}]",
    "step_connections": "JSON array string of connections: [{\\"from\\":\\"step-id\\",\\"to\\":\\"step-id\\",\\"condition\\":\\"condition or null\\"}]",
    "step_issues": "JSON array string of issues: [{\\"step_id\\":\\"step-id\\",\\"pain_point\\":\\"issue or null\\",\\"is_bottleneck\\":false,\\"bottleneck_reason\\":\\"reason or null\\",\\"automation_potential\\":\\"none|low|medium|high|null\\",\\"workaround\\":\\"workaround or null\\"}]",
    "dependencies": "People, teams, or systems depended on. Empty string if not mentioned.",
    "frequency": "How often this process happens. Empty string if not mentioned.",
    "edge_cases": "Exceptions or failure modes. Empty string if not mentioned.",
    "total_process_duration": "End-to-end duration. Empty string if not mentioned.",
    "compliance_or_approvals": "Approval or compliance gates. Empty string if none mentioned."
  },
  "success_evaluation": {
    "described_specific_steps": true,
    "mentioned_tools_or_systems": true,
    "identified_dependencies": true
  }
}

Rules:
- Base the JSON only on the transcript. Do not invent tools, dependencies, speakers, or durations.
- call_summary_title names the work discussed, with no trailing period and no speaker names. Use Title Case to match the interview titles it sits beside in the UI — e.g. "Monthly Payroll Close and Approvals". Never write a generic title like "Process Interview".
- Preserve named speakers as actors when the transcript makes their role in the process clear.
- process_steps, step_connections, and step_issues must be strings containing valid JSON arrays.
- Use stable kebab-case ids for steps so downstream process-flow generation can merge them.
- If the transcript is vague, keep fields sparse and mark booleans false where appropriate.`);

function appendToken(current: string, token: string): string {
  if (!current) return token;
  if (/^[,.;:!?)]/.test(token)) return `${current}${token}`;
  if (/^['"]$/.test(token)) return `${current}${token}`;
  return `${current} ${token}`;
}

export function normalizeScribeTranscript(
  data: ScribeResponse,
): TranscriptMessage[] {
  const words = Array.isArray(data.words) ? data.words : [];
  const speechWords = words.filter((word) => {
    const token = (word.text ?? "").trim();
    return token && word.type !== "audio_event";
  });

  if (speechWords.length === 0) {
    const text = (data.text ?? "").trim();
    return text
      ? [
          {
            role: "user",
            content: text,
            time_in_call_secs: 0,
            speakerId: "speaker_0",
          },
        ]
      : [];
  }

  const chunks: TranscriptMessage[] = [];
  let content = "";
  let chunkStart = speechWords[0]?.start ?? 0;
  let lastEnd = chunkStart;
  let currentSpeakerId =
    (speechWords[0]?.speaker_id ?? "").trim() || "speaker_0";

  for (const word of speechWords) {
    const token = (word.text ?? "").trim();
    if (!token) continue;

    const start = typeof word.start === "number" ? word.start : lastEnd;
    const end = typeof word.end === "number" ? word.end : start;
    const speakerId = (word.speaker_id ?? "").trim() || "speaker_0";
    const shouldSplit =
      speakerId !== currentSpeakerId ||
      content.length > 260 ||
      (content.length > 120 && /[.!?]$/.test(content)) ||
      start - chunkStart > 25;

    if (content && shouldSplit) {
      chunks.push({
        role: "user",
        content,
        time_in_call_secs: chunkStart,
        speakerId: currentSpeakerId,
      });
      content = token;
      chunkStart = start;
      currentSpeakerId = speakerId;
    } else {
      content = appendToken(content, token);
    }
    lastEnd = end;
  }

  if (content) {
    chunks.push({
      role: "user",
      content,
      time_in_call_secs: chunkStart,
      speakerId: currentSpeakerId,
    });
  }

  return chunks;
}

function defaultSpeakerLabels(transcript: TranscriptMessage[]): SpeakerLabel[] {
  const labels: SpeakerLabel[] = [];
  const seen = new Set<string>();
  for (const msg of transcript) {
    const speakerId = msg.speakerId ?? "speaker_0";
    if (seen.has(speakerId)) continue;
    seen.add(speakerId);
    labels.push({
      speakerId,
      displayName: `Speaker ${labels.length + 1}`,
    });
  }
  return labels;
}

function applySpeakerLabels(
  transcript: TranscriptMessage[],
  labels: SpeakerLabel[],
): TranscriptMessage[] {
  const labelById = new Map(
    labels.map((label) => [label.speakerId, label.displayName]),
  );
  return transcript.map((msg) => {
    if (!msg.speakerId) return msg;
    const speakerName = labelById.get(msg.speakerId);
    return speakerName ? { ...msg, speakerName } : msg;
  });
}

function transcriptText(transcript: TranscriptMessage[]): string {
  return transcript
    .map((msg) => {
      const speaker = msg.speakerName ?? msg.speakerId ?? "Speaker";
      return `${speaker}: ${msg.content}`;
    })
    .join("\n");
}

function stripJsonFences(content: string): string {
  const trimmed = content.trim();
  const withoutFences = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const first = withoutFences.indexOf("{");
  const last = withoutFences.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return withoutFences.slice(first, last + 1);
  }
  return withoutFences;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function jsonArrayString(value: unknown): string {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? JSON.stringify(parsed) : "[]";
    } catch {
      return "[]";
    }
  }
  return Array.isArray(value) ? JSON.stringify(value) : "[]";
}

export function coerceAnalysisPayload(
  value: unknown,
  fallbackSummary: string,
): AnalysisPayload {
  const root =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const dc =
    root.data_collection && typeof root.data_collection === "object"
      ? (root.data_collection as Record<string, unknown>)
      : {};
  const success =
    root.success_evaluation && typeof root.success_evaluation === "object"
      ? (root.success_evaluation as Record<string, unknown>)
      : {};

  return {
    call_summary_title: normalizeSummaryTitle(root.call_summary_title) ?? "",
    transcript_summary: stringValue(root.transcript_summary) || fallbackSummary,
    data_collection: {
      process_steps: jsonArrayString(dc.process_steps),
      step_connections: jsonArrayString(dc.step_connections),
      step_issues: jsonArrayString(dc.step_issues),
      dependencies: stringValue(dc.dependencies),
      frequency: stringValue(dc.frequency),
      edge_cases: stringValue(dc.edge_cases),
      total_process_duration: stringValue(dc.total_process_duration),
      compliance_or_approvals: stringValue(dc.compliance_or_approvals),
    },
    success_evaluation: {
      described_specific_steps: success.described_specific_steps === true,
      mentioned_tools_or_systems: success.mentioned_tools_or_systems === true,
      identified_dependencies: success.identified_dependencies === true,
    },
  };
}

function fallbackSummaryFromTranscript(
  transcript: TranscriptMessage[],
): string {
  const text = transcriptText(transcript).trim();
  if (!text) return "No transcript content was available for this recording.";
  return text.length > 800 ? `${text.slice(0, 797)}...` : text;
}

async function transcribeWithScribe(
  audio: Blob,
  apiKey: string,
  mimeType: string,
): Promise<ScribeResponse> {
  const form = new FormData();
  const extension = audioFileExtension(mimeType);
  form.append("file", audio, `voice-recording.${extension}`);
  form.append("model_id", "scribe_v2");
  form.append("language_code", "en");
  form.append("tag_audio_events", "true");
  form.append("timestamps_granularity", "word");
  form.append("diarize", "true");
  form.append("no_verbatim", "true");

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs Scribe error ${response.status}: ${body}`);
  }

  return (await response.json()) as ScribeResponse;
}

// Analysis output is verbose JSON (process_steps + connections + issues, each an
// escaped JSON-array string), so give it more headroom than the rolling summary
// to reduce truncation. Residual truncation is still detected explicitly below.
const VOICE_ANALYSIS_MAX_TOKENS = 16384;

/**
 * Turns a normalized AI completion into an AnalysisPayload.
 * Detects token-limit truncation explicitly — a truncated payload would
 * otherwise blow up in JSON.parse and surface as an opaque failure — and
 * distinguishes it from genuinely malformed JSON.
 */
export function parseAnalysisResponse(
  result: { text: string | null; finishReason: string | null },
  fallbackSummary: string,
): AnalysisPayload {
  const finishReason = result.finishReason;
  if (isTokenLimitFinishReason(finishReason)) {
    throw new Error(
      `Voice recording analysis hit the AI response token limit (finish_reason: ${finishReason}). The recording may be too long to analyze in a single pass.`,
    );
  }

  const content = result.text;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("AI returned an empty analysis response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(content));
  } catch (error) {
    throw new Error(
      `Voice recording analysis returned unparseable JSON: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }

  return coerceAnalysisPayload(parsed, fallbackSummary);
}

async function analyzeTranscript(
  ctx: ActionCtx,
  attribution: UsageAttribution,
  transcript: TranscriptMessage[],
): Promise<{
  analysis: AnalysisPayload;
  analysisProvider: "fabric-foundry";
}> {
  const fallbackSummary = fallbackSummaryFromTranscript(transcript);
  const completion = await meteredCompletion(ctx, attribution, {
    capability: "synthesis",
    operation: "voice-recording-analysis",
    system: VOICE_RECORDING_ANALYSIS_PROMPT,
    user: serializeUntrustedEvidence({ transcript }),
    maxTokens: VOICE_ANALYSIS_MAX_TOKENS,
  });
  return {
    analysis: parseAnalysisResponse(completion, fallbackSummary),
    analysisProvider: "fabric-foundry",
  };
}

function voiceUploadRateLimitKey(
  scope: "user" | "organization",
  clerkOrgId: string,
  userId?: Id<"users">,
): string {
  return scope === "user"
    ? `voice-upload:user:${clerkOrgId}:${userId}`
    : `voice-upload:organization:${clerkOrgId}`;
}

async function readVoiceUploadRateLimit(
  ctx: MutationCtx,
  args: {
    scope: "user" | "organization";
    clerkOrgId: string;
    userId?: Id<"users">;
    now: number;
    windowMs: number;
  },
): Promise<VoiceUploadRateLimitState> {
  const key = voiceUploadRateLimitKey(
    args.scope,
    args.clerkOrgId,
    args.userId,
  );
  const row = await ctx.db
    .query("voiceUploadRateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const windowStartedAt = fixedWindowStart(args.now, args.windowMs);
  const inCurrentWindow = row?.windowStartedAt === windowStartedAt;
  return {
    row,
    key,
    clerkOrgId: args.clerkOrgId,
    scope: args.scope,
    windowStartedAt,
    uploadUrlsIssued: inCurrentWindow ? row.uploadUrlsIssued : 0,
    admittedUploads: inCurrentWindow ? row.admittedUploads : 0,
    admittedBytes: inCurrentWindow ? row.admittedBytes : 0,
  };
}

async function writeVoiceUploadRateLimit(
  ctx: MutationCtx,
  state: VoiceUploadRateLimitState,
  values: {
    uploadUrlsIssued: number;
    admittedUploads: number;
    admittedBytes: number;
    now: number;
  },
): Promise<void> {
  const fields = {
    windowStartedAt: state.windowStartedAt,
    uploadUrlsIssued: values.uploadUrlsIssued,
    admittedUploads: values.admittedUploads,
    admittedBytes: values.admittedBytes,
    updatedAt: values.now,
  };
  if (state.row) {
    await ctx.db.patch(state.row._id, fields);
    return;
  }
  await ctx.db.insert("voiceUploadRateLimits", {
    key: state.key,
    clerkOrgId: state.clerkOrgId,
    scope: state.scope,
    ...fields,
  });
}

async function deleteUnattachedAudio(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
): Promise<boolean> {
  const existing = await ctx.db
    .query("conversations")
    .withIndex("by_audioStorageId", (q) => q.eq("audioStorageId", storageId))
    .first();
  if (existing) return false;
  const metadata = await ctx.db.system.get("_storage", storageId);
  if (!metadata) return false;
  await ctx.storage.delete(storageId);
  return true;
}

export const generateUploadUrl = mutation({
  args: { processId: v.id("processes") },
  handler: async (ctx, args) => {
    const caller = await requireOrgContributor(ctx);
    const process = await ctx.db.get(args.processId);
    assertOrgOwns(caller, process);

    const now = Date.now();
    const userLimit = await readVoiceUploadRateLimit(ctx, {
      scope: "user",
      clerkOrgId: caller.orgId,
      userId: caller.userId,
      now,
      windowMs: USER_UPLOAD_WINDOW_MS,
    });
    const orgLimit = await readVoiceUploadRateLimit(ctx, {
      scope: "organization",
      clerkOrgId: caller.orgId,
      now,
      windowMs: ORG_UPLOAD_WINDOW_MS,
    });
    if (userLimit.uploadUrlsIssued >= MAX_USER_UPLOADS_PER_WINDOW) {
      throw new Error("Audio upload rate limit reached. Try again later.");
    }
    if (orgLimit.uploadUrlsIssued >= MAX_ORG_UPLOADS_PER_WINDOW) {
      throw new Error(
        "Organization audio upload limit reached. Try again later.",
      );
    }

    await writeVoiceUploadRateLimit(ctx, userLimit, {
      uploadUrlsIssued: userLimit.uploadUrlsIssued + 1,
      admittedUploads: userLimit.admittedUploads,
      admittedBytes: userLimit.admittedBytes,
      now,
    });
    await writeVoiceUploadRateLimit(ctx, orgLimit, {
      uploadUrlsIssued: orgLimit.uploadUrlsIssued + 1,
      admittedUploads: orgLimit.admittedUploads,
      admittedBytes: orgLimit.admittedBytes,
      now,
    });

    const token = crypto.randomUUID();
    const existingGrant = await ctx.db
      .query("voiceUploadGrants")
      .withIndex("by_clerkOrgId_and_userId_and_processId", (q) =>
        q
          .eq("clerkOrgId", caller.orgId)
          .eq("userId", caller.userId)
          .eq("processId", args.processId),
      )
      .unique();
    const grant = {
      token,
      processId: args.processId,
      clerkOrgId: caller.orgId,
      userId: caller.userId,
      expiresAt: now + VOICE_UPLOAD_GRANT_TTL_MS,
    };
    if (existingGrant) {
      await ctx.db.patch(existingGrant._id, grant);
    } else {
      await ctx.db.insert("voiceUploadGrants", grant);
    }

    return {
      uploadUrl: await ctx.storage.generateUploadUrl(),
      uploadToken: token,
    };
  },
});

export const hasValidVoiceUploadGrant = internalQuery({
  args: {
    token: v.string(),
    processId: v.id("processes"),
    clerkOrgId: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const grant = await ctx.db
      .query("voiceUploadGrants")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    return Boolean(
      grant &&
        grant.processId === args.processId &&
        grant.clerkOrgId === args.clerkOrgId &&
        grant.userId === args.userId &&
        grant.expiresAt > Date.now(),
    );
  },
});

export const rejectVoiceUpload = internalMutation({
  args: {
    token: v.string(),
    processId: v.id("processes"),
    clerkOrgId: v.string(),
    userId: v.id("users"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const grant = await ctx.db
      .query("voiceUploadGrants")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (
      !grant ||
      grant.processId !== args.processId ||
      grant.clerkOrgId !== args.clerkOrgId ||
      grant.userId !== args.userId
    ) {
      return false;
    }

    await ctx.db.delete(grant._id);
    return await deleteUnattachedAudio(ctx, args.storageId);
  },
});

export const admitVoiceRecording = internalMutation({
  args: {
    token: v.string(),
    processId: v.id("processes"),
    clerkOrgId: v.string(),
    storageId: v.id("_storage"),
    audioSizeBytes: v.number(),
    durationSeconds: v.optional(v.number()),
    mimeType: v.string(),
    source: v.union(v.literal("record"), v.literal("upload")),
    contributorName: v.string(),
    userId: v.id("users"),
    subjectUserId: v.optional(v.id("users")),
    submittedByName: v.optional(v.string()),
    consentAttestedAt: v.optional(v.number()),
    analysisProvider: v.literal("fabric-foundry"),
  },
  handler: async (ctx, args): Promise<VoiceUploadAdmission> => {
    const grant = await ctx.db
      .query("voiceUploadGrants")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (
      !grant ||
      grant.processId !== args.processId ||
      grant.clerkOrgId !== args.clerkOrgId ||
      grant.userId !== args.userId ||
      grant.expiresAt <= Date.now()
    ) {
      return { ok: false, reason: "invalid_grant" };
    }

    const process = await ctx.db.get(args.processId);
    if (!process || process.clerkOrgId !== args.clerkOrgId) {
      return { ok: false, reason: "invalid_grant" };
    }

    const duplicate = await ctx.db
      .query("conversations")
      .withIndex("by_audioStorageId", (q) =>
        q.eq("audioStorageId", args.storageId),
      )
      .first();
    if (duplicate) {
      await ctx.db.delete(grant._id);
      return { ok: false, reason: "duplicate_upload" };
    }

    const metadata = await ctx.db.system.get("_storage", args.storageId);
    const metadataValidation = metadata
      ? validateAudioUploadMetadata({
          sizeBytes: metadata.size,
          // Convex production uploads retain Content-Type. convex-test's
          // ctx.storage.store currently omits it from the system table, so the
          // already-inspected canonical type is the test-runtime fallback.
          storedMimeType: metadata.contentType ?? args.mimeType,
          claimedMimeType: args.mimeType,
          durationSeconds: args.durationSeconds,
        })
      : null;
    if (
      !metadataValidation?.ok ||
      metadataValidation.sizeBytes !== args.audioSizeBytes ||
      metadataValidation.mimeType !== args.mimeType
    ) {
      await ctx.db.delete(grant._id);
      await deleteUnattachedAudio(ctx, args.storageId);
      return { ok: false, reason: "invalid_upload" };
    }

    const now = Date.now();
    const userLimit = await readVoiceUploadRateLimit(ctx, {
      scope: "user",
      clerkOrgId: args.clerkOrgId,
      userId: args.userId,
      now,
      windowMs: USER_UPLOAD_WINDOW_MS,
    });
    const orgLimit = await readVoiceUploadRateLimit(ctx, {
      scope: "organization",
      clerkOrgId: args.clerkOrgId,
      now,
      windowMs: ORG_UPLOAD_WINDOW_MS,
    });
    const exceedsUserQuota =
      userLimit.admittedUploads >= MAX_USER_UPLOADS_PER_WINDOW ||
      userLimit.admittedBytes + args.audioSizeBytes >
        MAX_USER_UPLOAD_BYTES_PER_WINDOW;
    const exceedsOrgQuota =
      orgLimit.admittedUploads >= MAX_ORG_UPLOADS_PER_WINDOW ||
      orgLimit.admittedBytes + args.audioSizeBytes >
        MAX_ORG_UPLOAD_BYTES_PER_WINDOW;
    if (exceedsUserQuota || exceedsOrgQuota) {
      await ctx.db.delete(grant._id);
      await deleteUnattachedAudio(ctx, args.storageId);
      return {
        ok: false,
        reason: exceedsUserQuota ? "user_quota" : "organization_quota",
      };
    }

    await writeVoiceUploadRateLimit(ctx, userLimit, {
      uploadUrlsIssued: userLimit.uploadUrlsIssued,
      admittedUploads: userLimit.admittedUploads + 1,
      admittedBytes: userLimit.admittedBytes + args.audioSizeBytes,
      now,
    });
    await writeVoiceUploadRateLimit(ctx, orgLimit, {
      uploadUrlsIssued: orgLimit.uploadUrlsIssued,
      admittedUploads: orgLimit.admittedUploads + 1,
      admittedBytes: orgLimit.admittedBytes + args.audioSizeBytes,
      now,
    });
    await ctx.db.delete(grant._id);

    const conversationId = await ctx.db.insert("conversations", {
      processId: args.processId,
      clerkOrgId: args.clerkOrgId,
      contributorName: args.contributorName,
      userId: args.userId,
      subjectUserId: args.subjectUserId,
      submittedByName: args.submittedByName,
      consentAttestedAt: args.consentAttestedAt,
      inputMode: args.source === "upload" ? "audioUpload" : "voiceRecord",
      audioStorageId: args.storageId,
      audioMimeType: args.mimeType,
      audioSizeBytes: args.audioSizeBytes,
      transcriptionProvider: "elevenlabs-scribe",
      analysisProvider: args.analysisProvider,
      durationSeconds: args.durationSeconds,
      status: "processing",
    });

    await ctx.scheduler.runAfter(
      0,
      internal.voiceRecordings.processVoiceRecordingInternal,
      {
        conversationId,
        processId: args.processId,
        clerkOrgId: args.clerkOrgId,
        storageId: args.storageId,
        durationSeconds: args.durationSeconds,
        mimeType: args.mimeType,
      },
    );
    return { ok: true, conversationId };
  },
});

export const processVoiceRecording = action({
  args: {
    processId: v.id("processes"),
    storageId: v.id("_storage"),
    uploadToken: v.string(),
    durationSeconds: v.optional(v.number()),
    mimeType: v.string(),
    source: v.optional(v.union(v.literal("record"), v.literal("upload"))),
    // Optional on-behalf-of attribution; omitted for ordinary self-recordings.
    contributorName: v.optional(v.string()),
    subjectUserId: v.optional(v.id("users")),
    consentAttested: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: "processing";
    conversationId: Id<"conversations">;
  }> => {
    const isUpload = args.source === "upload";
    const { orgId } = await resolveOrgForAction(ctx);
    await ctx.runQuery(internal.processFlows.assertProcessInOrg, {
      processId: args.processId,
      clerkOrgId: orgId,
    });

    // Also gates the caller on contributor role, and on admin + a consent
    // attestation when the recording is attributed to someone else.
    const attribution: ResolvedAttribution = await ctx.runQuery(
      internal.postCall.resolveContributorAttribution,
      {
        clerkOrgId: orgId,
        contributorName: args.contributorName,
        subjectUserId: args.subjectUserId,
        consentAttested: args.consentAttested,
      },
    );

    const hasGrant: boolean = await ctx.runQuery(
      internal.voiceRecordings.hasValidVoiceUploadGrant,
      {
        processId: args.processId,
        clerkOrgId: orgId,
        token: args.uploadToken,
        userId: attribution.userId,
      },
    );
    if (!hasGrant) {
      throw new Error("Audio upload authorization is invalid or expired.");
    }

    const audio = await ctx.storage.get(args.storageId);
    if (!audio) {
      await ctx.runMutation(internal.voiceRecordings.rejectVoiceUpload, {
        token: args.uploadToken,
        processId: args.processId,
        clerkOrgId: orgId,
        userId: attribution.userId,
        storageId: args.storageId,
      });
      throw new Error("The uploaded audio file could not be found.");
    }

    const inspection = await inspectAudioUpload(
      audio,
      args.mimeType,
      args.durationSeconds,
    );
    if (!inspection.ok) {
      await ctx.runMutation(internal.voiceRecordings.rejectVoiceUpload, {
        token: args.uploadToken,
        processId: args.processId,
        clerkOrgId: orgId,
        userId: attribution.userId,
        storageId: args.storageId,
      });
      throw new Error(audioUploadRejectionMessage(inspection.reason));
    }

    const admission: VoiceUploadAdmission = await ctx.runMutation(
      internal.voiceRecordings.admitVoiceRecording,
      {
        token: args.uploadToken,
        processId: args.processId,
        clerkOrgId: orgId,
        storageId: args.storageId,
        audioSizeBytes: inspection.sizeBytes,
        durationSeconds: args.durationSeconds,
        mimeType: inspection.mimeType,
        source: isUpload ? "upload" : "record",
        contributorName: attribution.contributorName,
        userId: attribution.userId,
        subjectUserId: attribution.subjectUserId,
        submittedByName: attribution.submittedByName,
        consentAttestedAt: attribution.submittedByName ? Date.now() : undefined,
        analysisProvider: "fabric-foundry",
      },
    );
    if (!admission.ok) {
      if (
        admission.reason === "user_quota" ||
        admission.reason === "organization_quota"
      ) {
        throw new Error("Audio upload quota reached. Try again later.");
      }
      if (admission.reason === "duplicate_upload") {
        throw new Error("This audio file has already been submitted.");
      }
      throw new Error("The audio upload could not be accepted.");
    }

    return {
      status: "processing" as const,
      conversationId: admission.conversationId,
    };
  },
});

export const finishVoiceRecording = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    clerkOrgId: v.string(),
    transcript: v.array(transcriptMessageValidator),
    summary: v.string(),
    title: v.optional(v.string()),
    analysis: v.any(),
    // Only Foundry can produce a new recording analysis. The wider union
    // survives in the table schema for pre-cutover rows, not for writes.
    analysisProvider: v.literal("fabric-foundry"),
    durationSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.clerkOrgId !== args.clerkOrgId) {
      throw new Error("Conversation not found in this organization");
    }
    await ctx.db.patch(args.conversationId, {
      transcript: args.transcript,
      summary: args.summary,
      title: args.title,
      analysis: args.analysis,
      analysisProvider: args.analysisProvider,
      durationSeconds: args.durationSeconds,
      status: "done",
    });
  },
});

export const markVoiceRecordingNeedsSpeakerLabels = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    clerkOrgId: v.string(),
    transcript: v.array(transcriptMessageValidator),
    speakerLabels: v.array(speakerLabelValidator),
    durationSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.clerkOrgId !== args.clerkOrgId) {
      throw new Error("Conversation not found in this organization");
    }
    await ctx.db.patch(args.conversationId, {
      transcript: args.transcript,
      speakerLabels: args.speakerLabels,
      durationSeconds: args.durationSeconds,
      status: "needs_speaker_labels",
    });
  },
});

export const markVoiceRecordingFailed = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    clerkOrgId: v.string(),
  },
  handler: async (ctx, args) => {
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.clerkOrgId !== args.clerkOrgId) return;
    await ctx.db.patch(args.conversationId, { status: "failed" });
  },
});

export const getVoiceRecordingForAnalysis = internalQuery({
  args: {
    conversationId: v.id("conversations"),
    clerkOrgId: v.string(),
  },
  handler: async (ctx, args): Promise<VoiceRecordingForAnalysis | null> => {
    const conv = await ctx.db.get(args.conversationId);
    const mode = conv?.inputMode ?? "agent";
    if (
      !conv ||
      conv.clerkOrgId !== args.clerkOrgId ||
      (mode !== "voiceRecord" && mode !== "audioUpload") ||
      conv.status !== "processing" ||
      !conv.transcript ||
      conv.transcript.length === 0
    ) {
      return null;
    }
    return {
      processId: conv.processId,
      transcript: conv.transcript,
      durationSeconds: conv.durationSeconds,
    };
  },
});

export const submitSpeakerLabels = mutation({
  args: {
    conversationId: v.id("conversations"),
    labels: v.array(speakerLabelValidator),
  },
  handler: async (ctx, args) => {
    const caller = await requireOrgContributor(ctx);
    const conv = await ctx.db.get(args.conversationId);
    assertOrgOwns(caller, conv);
    const convMode = conv.inputMode ?? "agent";
    if (convMode !== "voiceRecord" && convMode !== "audioUpload") {
      throw new Error("Only voice recordings can be speaker-labeled");
    }
    if (conv.status !== "needs_speaker_labels") {
      throw new Error("This recording is not waiting for speaker labels");
    }
    if (!conv.transcript || conv.transcript.length === 0) {
      throw new Error("No transcript is available to label");
    }

    const requiredSpeakerIds = new Set<string>();
    for (const existing of conv.speakerLabels ?? []) {
      requiredSpeakerIds.add(existing.speakerId);
    }
    for (const msg of conv.transcript) {
      if (msg.speakerId) requiredSpeakerIds.add(msg.speakerId);
    }
    if (requiredSpeakerIds.size === 0) {
      requiredSpeakerIds.add("speaker_0");
    }

    const labelBySpeakerId = new Map<string, SpeakerLabel>();
    for (const label of args.labels) {
      const speakerId = label.speakerId.trim();
      const displayName = label.displayName.trim();
      if (!speakerId || !requiredSpeakerIds.has(speakerId)) {
        throw new Error("Speaker labels do not match this transcript");
      }
      if (!displayName) {
        throw new Error("Every speaker needs a display name");
      }
      if (displayName.length > 120) {
        throw new Error("Speaker names must be 120 characters or fewer");
      }
      if (labelBySpeakerId.has(speakerId)) {
        throw new Error("Duplicate speaker label submitted");
      }
      if (label.userId) {
        const user = await ctx.db.get(label.userId);
        if (!user) throw new Error("Selected member was not found");
        const memberships = await ctx.db
          .query("memberships")
          .withIndex("by_userId", (q) => q.eq("userId", label.userId!))
          .take(100);
        if (!memberships.some((m) => m.clerkOrgId === caller.orgId)) {
          throw new Error("Selected member is not in this organization");
        }
      }
      labelBySpeakerId.set(
        speakerId,
        label.userId
          ? { speakerId, displayName, userId: label.userId }
          : { speakerId, displayName },
      );
    }

    if (labelBySpeakerId.size !== requiredSpeakerIds.size) {
      throw new Error("Every speaker needs a label before analysis can run");
    }

    const speakerLabels = [...requiredSpeakerIds].map((speakerId) => {
      const label = labelBySpeakerId.get(speakerId);
      if (!label) {
        throw new Error("Every speaker needs a label before analysis can run");
      }
      return label;
    });
    const transcript = applySpeakerLabels(conv.transcript, speakerLabels);

    await ctx.db.patch(args.conversationId, {
      speakerLabels,
      transcript,
      status: "processing",
    });

    await ctx.scheduler.runAfter(
      0,
      internal.voiceRecordings.analyzeVoiceRecordingInternal,
      { conversationId: args.conversationId, clerkOrgId: caller.orgId },
    );

    return { status: "processing" as const };
  },
});

export const retryAudioProcessing = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const caller = await requireOrgAdmin(ctx);
    const conv = await ctx.db.get(args.conversationId);
    assertOrgOwns(caller, conv);

    if (conv.status !== "failed") {
      throw new Error("Only failed audio conversations can be retried");
    }

    const mode = conv.inputMode ?? "agent";
    if (mode !== "voiceRecord" && mode !== "audioUpload") {
      throw new Error("Only failed audio conversations can be retried");
    }

    const hasTranscript = Boolean(conv.transcript?.length);

    if (hasTranscript) {
      await ctx.db.patch(args.conversationId, {
        status: "processing",
        summary: undefined,
        title: undefined,
        analysis: undefined,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.voiceRecordings.analyzeVoiceRecordingInternal,
        { conversationId: args.conversationId, clerkOrgId: caller.orgId },
      );
      return { status: "processing" as const, retryStage: "analysis" as const };
    }

    if (!conv.audioStorageId) {
      throw new Error("Audio file is no longer available for retry");
    }

    await ctx.db.patch(args.conversationId, {
      status: "processing",
      transcript: undefined,
      speakerLabels: undefined,
      summary: undefined,
      processSummaryInput: undefined,
      processSummaryInputHash: undefined,
      processSummaryEvidenceV2: undefined,
      processSummaryEvidenceV2Failure: undefined,
      title: undefined,
      analysis: undefined,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.voiceRecordings.processVoiceRecordingInternal,
      {
        conversationId: args.conversationId,
        processId: conv.processId,
        clerkOrgId: caller.orgId,
        storageId: conv.audioStorageId,
        durationSeconds: conv.durationSeconds,
        mimeType: conv.audioMimeType ?? "audio/webm",
      },
    );

    return {
      status: "processing" as const,
      retryStage: "transcription" as const,
    };
  },
});

// User abandoned the modal before completing analysis. Drop the audio bytes
// and the conversation row so we don't retain inputs we never finished
// processing. Refuses to delete already-finalized rows.
export const abandonVoiceRecording = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const caller = await requireOrgContributor(ctx);
    const conv = await ctx.db.get(args.conversationId);
    if (!conv) return;
    assertOrgOwns(caller, conv);
    if (caller.role !== "admin" && conv.userId !== caller.userId) {
      throw new Error("Insufficient permissions");
    }
    if (conv.status === "done") return;
    const mode = conv.inputMode ?? "agent";
    if (mode !== "voiceRecord" && mode !== "audioUpload") return;
    if (conv.audioStorageId) {
      try {
        await ctx.storage.delete(conv.audioStorageId);
      } catch {
        // Already gone — fall through and delete the row.
      }
    }
    await ctx.db.delete(args.conversationId);
  },
});

export const processVoiceRecordingInternal = internalAction({
  args: {
    conversationId: v.id("conversations"),
    processId: v.id("processes"),
    clerkOrgId: v.string(),
    storageId: v.id("_storage"),
    durationSeconds: v.optional(v.number()),
    mimeType: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
      if (!elevenLabsKey) {
        throw new Error("ELEVENLABS_API_KEY is not configured");
      }

      const audio = await ctx.storage.get(args.storageId);
      if (!audio) {
        throw new Error(`Storage object ${args.storageId} not found`);
      }
      const inspection = await inspectAudioUpload(
        audio,
        normalizeAudioMimeType(args.mimeType),
        args.durationSeconds,
      );
      if (!inspection.ok) {
        throw new Error(audioUploadRejectionMessage(inspection.reason));
      }

      const transcriptionStartedAt = Date.now();
      let scribeResult: ScribeResponse;
      try {
        scribeResult = await transcribeWithScribe(
          audio,
          elevenLabsKey,
          inspection.mimeType,
        );
      } catch (transcriptionError) {
        // Recorded even on failure: ElevenLabs may well have processed audio
        // before erroring, and an unmetered failure is indistinguishable from a
        // call that never happened.
        await recordVoiceUsage(
          ctx,
          {
            clerkOrgId: args.clerkOrgId,
            entityType: "conversation",
            entityId: args.conversationId,
          },
          {
            operation: "voice-transcription",
            provider: "elevenlabs",
            model: "scribe_v2",
            rateKey: "elevenlabs:scribe_v2",
            seconds: args.durationSeconds ?? 0,
            status: "failed",
            startedAt: transcriptionStartedAt,
            errorType:
              transcriptionError instanceof Error
                ? transcriptionError.name
                : "UnknownError",
          },
        );
        throw transcriptionError;
      }

      const transcript = normalizeScribeTranscript(scribeResult);

      const inferredDuration =
        args.durationSeconds ??
        transcript[transcript.length - 1]?.time_in_call_secs;

      // Scribe bills per audio minute regardless of what came back, so this is
      // metered before the empty-transcript guard below.
      await recordVoiceUsage(
        ctx,
        {
          clerkOrgId: args.clerkOrgId,
          entityType: "conversation",
          entityId: args.conversationId,
        },
        {
          operation: "voice-transcription",
          provider: "elevenlabs",
          model: "scribe_v2",
          rateKey: "elevenlabs:scribe_v2",
          seconds: inferredDuration ?? 0,
          startedAt: transcriptionStartedAt,
        },
      );

      if (transcript.length === 0) {
        throw new Error("Scribe returned an empty transcript");
      }
      if (
        inferredDuration !== undefined &&
        inferredDuration > MAX_AUDIO_DURATION_SECONDS
      ) {
        throw new Error("Recording exceeds the four-hour duration limit");
      }

      const speakerLabels = defaultSpeakerLabels(transcript);

      await ctx.runMutation(
        internal.voiceRecordings.markVoiceRecordingNeedsSpeakerLabels,
        {
          conversationId: args.conversationId,
          clerkOrgId: args.clerkOrgId,
          transcript,
          speakerLabels,
          durationSeconds: inferredDuration,
        },
      );

      return {
        status: "needs_speaker_labels" as const,
        conversationId: args.conversationId,
      };
    } catch (error) {
      console.error("Voice recording transcription failed:", error);
      await ctx.runMutation(internal.voiceRecordings.markVoiceRecordingFailed, {
        conversationId: args.conversationId,
        clerkOrgId: args.clerkOrgId,
      });
      return { status: "failed" as const };
    }
  },
});

export const analyzeVoiceRecordingInternal = internalAction({
  args: {
    conversationId: v.id("conversations"),
    clerkOrgId: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      if (!isAIConfigured("synthesis")) {
        throw new Error("AI synthesis is not configured");
      }

      const recording: VoiceRecordingForAnalysis | null = await ctx.runQuery(
        internal.voiceRecordings.getVoiceRecordingForAnalysis,
        {
          conversationId: args.conversationId,
          clerkOrgId: args.clerkOrgId,
        },
      );
      if (!recording) {
        throw new Error("Voice recording is not ready for analysis");
      }

      const { analysis, analysisProvider } = await analyzeTranscript(
        ctx,
        {
          clerkOrgId: args.clerkOrgId,
          entityType: "conversation",
          entityId: args.conversationId,
        },
        recording.transcript,
      );

      await ctx.runMutation(internal.voiceRecordings.finishVoiceRecording, {
        conversationId: args.conversationId,
        clerkOrgId: args.clerkOrgId,
        transcript: recording.transcript,
        summary: analysis.transcript_summary,
        title: analysis.call_summary_title || undefined,
        analysis,
        analysisProvider,
        durationSeconds: recording.durationSeconds,
      });

      // The recording is committed as done; both pipelines start from here,
      // independently of each other.
      await startConversationPipelines(
        ctx,
        recording.processId,
        args.clerkOrgId,
      );

      return { status: "done" as const };
    } catch (error) {
      console.error("Voice recording analysis failed:", error);
      await ctx.runMutation(internal.voiceRecordings.markVoiceRecordingFailed, {
        conversationId: args.conversationId,
        clerkOrgId: args.clerkOrgId,
      });
      return { status: "failed" as const };
    }
  },
});

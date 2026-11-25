import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  requireOrgContributor,
  requireOrgMember,
  resolveOrgForAction,
  isActiveMembership,
} from "./lib/orgAuth";
import { recordAgentConversationUsage } from "./lib/aiUsageMeter";
import {
  isSamePersonName,
  sanitizeContributorName,
} from "./lib/contributorAttribution";
import { summaryTitleFromAnalysis } from "./lib/conversationTitle";
import { isWorkspaceClosed } from "./lib/workspaceStatus";
import { startConversationPipelines } from "./lib/conversationPipelines";
import { conversationFailureReasonValidator } from "./lib/conversationFailure";
import { interviewBindingEnforcedFrom, markSessionImported } from "./lib/interviewLimits";
import { userError } from "./lib/userError";
import {
  assertElevenLabsConversationIdentity,
  buildElevenLabsConversationUrl,
  requireElevenLabsConversationId,
} from "./lib/elevenLabsConversation";
import {
  AUDIO_PLAYBACK_TOKEN_TTL_MS,
  signAudioPlaybackToken,
} from "./lib/audioPlaybackToken";
import { hashTranscript } from "./lib/transcriptHash";

// Normalize ElevenLabs transcript to the shape our UI expects:
// ElevenLabs returns { role: "agent"|"user", message: string, time_in_call_secs: number }
// Our UI expects { role: "ai"|"user", content: string, time_in_call_secs: number }
function normalizeTranscript(
  raw: Array<{
    role: string;
    message?: string;
    time_in_call_secs?: number;
  }> | null,
):
  | Array<{
      role: string;
      content: string;
      time_in_call_secs: number;
      speakerId?: string;
      speakerName?: string;
    }>
  | undefined {
  if (!raw || !Array.isArray(raw)) return undefined;
  return raw.map((msg) => ({
    role: msg.role === "agent" ? "ai" : msg.role,
    content: msg.message ?? "",
    time_in_call_secs: msg.time_in_call_secs ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Internal auth-gating helpers for actions
// ---------------------------------------------------------------------------

/**
 * Gate an action on the caller being a contributor (or admin) in their active
 * org. Actions call this via `ctx.runQuery(internal.postCall.requireOrgContributorInternal, {})`.
 * Throws if not authenticated, no active org, no membership, or role < contributor.
 */
export const requireOrgContributorInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const caller = await requireOrgContributor(ctx);
    return { orgId: caller.orgId, userId: caller.userId };
  },
});

// ---------------------------------------------------------------------------
// Contributor attribution
// ---------------------------------------------------------------------------

export type ResolvedAttribution = {
  /** Display name of the person the recording is about. */
  contributorName: string;
  /** The submitting account. Always the authenticated caller. */
  userId: Id<"users">;
  /** The subject's account, when they are a verified org member. */
  subjectUserId?: Id<"users">;
  /** Set only when subject ≠ submitter; its presence marks an on-behalf row. */
  submittedByName?: string;
};

/**
 * Separates who a recording is *about* from who submitted it, so third-party
 * consultants can file interviews for an employee without the record claiming
 * the employee submitted it.
 *
 * Called by every public entry point that inserts a conversation. Passing no
 * `contributorName`/`subjectUserId` (or naming yourself) yields the pre-existing
 * behaviour: attribution derived from the caller's account.
 *
 * On-behalf-of submissions are gated on two things, because the modal's
 * recording notice is consent from whoever is typing — not from the person named:
 *   1. admin role, so an ordinary contributor cannot put words under a
 *      colleague's byline;
 *   2. an explicit consent attestation, recorded on the row by the caller.
 * `subjectUserId` is verified against org membership the same way
 * `submitSpeakerLabels` verifies speaker links.
 */
export const resolveContributorAttribution = internalQuery({
  args: {
    clerkOrgId: v.string(),
    contributorName: v.optional(v.string()),
    subjectUserId: v.optional(v.id("users")),
    consentAttested: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ResolvedAttribution> => {
    const caller = await requireOrgContributor(ctx);
    if (caller.orgId !== args.clerkOrgId) {
      throw new Error("Organisation mismatch");
    }
    const submitter = await ctx.db.get(caller.userId);
    const submitterName =
      sanitizeContributorName(submitter?.name ?? "") || "Anonymous";

    let subjectUserId: Id<"users"> | undefined;
    let subjectName: string | undefined;
    if (args.subjectUserId) {
      const subject = await ctx.db.get(args.subjectUserId);
      if (!subject) throw new Error("Selected member was not found");
      const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_userId", (q) => q.eq("userId", args.subjectUserId!))
        .take(100);
      if (
        !memberships.some(
          (m) => m.clerkOrgId === caller.orgId && isActiveMembership(m),
        )
      ) {
        throw new Error("Selected member is not in this organisation");
      }
      subjectUserId = subject._id;
      subjectName = sanitizeContributorName(subject.name) || "Anonymous";
    }

    const typedName = sanitizeContributorName(args.contributorName ?? "");
    const resolvedName = subjectName ?? typedName;

    const isSelfRecording =
      subjectUserId !== undefined
        ? subjectUserId === caller.userId
        : resolvedName === "" || isSamePersonName(resolvedName, submitterName);
    if (isSelfRecording) {
      return {
        contributorName: submitterName,
        userId: caller.userId,
        subjectUserId: caller.userId,
      };
    }

    if (caller.role !== "admin") {
      throw new Error(
        "Only organisation admins can record on another person's behalf",
      );
    }
    if (!args.consentAttested) {
      throw new Error(
        "Confirm the person was informed and consented before recording on their behalf",
      );
    }

    return {
      contributorName: resolvedName,
      userId: caller.userId,
      subjectUserId,
      submittedByName: submitterName,
    };
  },
});

// ---------------------------------------------------------------------------
// Internal helpers — all tenant-scoped via explicit clerkOrgId arg
// ---------------------------------------------------------------------------

const FOREIGN_CONVERSATION_MESSAGE =
  "This conversation can't be imported into this workspace.";

/** Every tenant shares one ElevenLabs agent, so a conversation id says nothing
 * about which org it came from. The first org to import it owns it; any other
 * org is refused, so a learned id can't pull another tenant's transcript. */
async function elevenLabsConversationOwnedElsewhere(
  ctx: QueryCtx | MutationCtx,
  elevenlabsConversationId: string,
  clerkOrgId: string,
): Promise<boolean> {
  const imports = await ctx.db
    .query("conversations")
    .withIndex("by_elevenlabsConversationId", (q) =>
      q.eq("elevenlabsConversationId", elevenlabsConversationId),
    )
    .take(10);
  return imports.some((conversation) => conversation.clerkOrgId !== clerkOrgId);
}

async function sameOrgImport(
  ctx: QueryCtx | MutationCtx,
  elevenlabsConversationId: string,
  clerkOrgId: string,
): Promise<Doc<"conversations"> | null> {
  const imports = await ctx.db
    .query("conversations")
    .withIndex("by_elevenlabsConversationId", (q) =>
      q.eq("elevenlabsConversationId", elevenlabsConversationId),
    )
    .take(10);
  return imports.find((conversation) => conversation.clerkOrgId === clerkOrgId) ?? null;
}

type ConversationStatus = Doc<"conversations">["status"];

/**
 * `created` is false when this org already had a row for the ElevenLabs
 * conversation: the caller then records no usage and starts no pipeline.
 */
export type InsertConversationResult = {
  conversationId: Id<"conversations">;
  created: boolean;
  processId: Id<"processes">;
  status: ConversationStatus;
};

/** This org's row for an ElevenLabs conversation, if it has imported it. */
export const sameOrgImportStatus = internalQuery({
  args: { elevenlabsConversationId: v.string(), clerkOrgId: v.string() },
  handler: async (ctx, args): Promise<ConversationStatus | null> =>
    (await sameOrgImport(ctx, args.elevenlabsConversationId, args.clerkOrgId))
      ?.status ?? null,
});

const UNBOUND_CONVERSATION_MESSAGE =
  "This interview can't be imported: it wasn't started from Fabric by you.";

/**
 * Import binding (Phase 3, D2): an ElevenLabs conversation can only be
 * imported by the member Fabric issued it to, or an admin of that workspace.
 * Enforced for conversations that started at or after
 * INTERVIEW_SESSIONS_ENFORCED_FROM; earlier ones (from before the switch-over,
 * when the browser started sessions itself) import as before. While the
 * variable is unset, a mismatch is only logged.
 */
function assertImportBinding(
  data: { metadata?: { start_time_unix_secs?: unknown } },
  elevenlabsConversationId: string,
  issuedToCaller: boolean,
) {
  if (issuedToCaller) return;
  const enforcedFrom = interviewBindingEnforcedFrom();
  const startSecs = data.metadata?.start_time_unix_secs;
  const startedAt = typeof startSecs === "number" ? startSecs * 1000 : null;
  const enforced = enforcedFrom !== null && (startedAt === null || startedAt >= enforcedFrom);
  console.warn("Interview import not issued to caller", {
    elevenlabsConversationId,
    enforced,
  });
  if (enforced) throw userError("INTERVIEW_NOT_ISSUED", UNBOUND_CONVERSATION_MESSAGE);
}

/** What the recording modal is told about an import that already exists. */
function fetchStatusFor(status: ConversationStatus): "done" | "failed" | "timeout" {
  if (status === "done") return "done";
  if (status === "failed") return "failed";
  // `processing` (or labelling, which agent imports never use): still settling.
  return "timeout";
}

export const isElevenLabsConversationOwnedElsewhere = internalQuery({
  args: { elevenlabsConversationId: v.string(), clerkOrgId: v.string() },
  handler: async (ctx, args): Promise<boolean> =>
    await elevenLabsConversationOwnedElsewhere(
      ctx,
      args.elevenlabsConversationId,
      args.clerkOrgId,
    ),
});

export const insertConversation = internalMutation({
  args: {
    processId: v.id("processes"),
    clerkOrgId: v.string(),
    elevenlabsConversationId: v.optional(v.string()),
    contributorName: v.string(),
    userId: v.optional(v.id("users")),
    subjectUserId: v.optional(v.id("users")),
    submittedByName: v.optional(v.string()),
    consentAttestedAt: v.optional(v.number()),
    inputMode: v.optional(
      v.union(
        v.literal("agent"),
        v.literal("voiceRecord"),
        v.literal("audioUpload"),
      ),
    ),
    audioStorageId: v.optional(v.id("_storage")),
    audioMimeType: v.optional(v.string()),
    transcriptionProvider: v.optional(
      v.union(v.literal("elevenlabs-convai"), v.literal("elevenlabs-scribe")),
    ),
    analysisProvider: v.optional(
      v.union(
        v.literal("elevenlabs-convai"),
        v.literal("fabric-openrouter"),
        v.literal("fabric-foundry"),
      ),
    ),
    transcript: v.optional(
      v.array(
        v.object({
          role: v.string(),
          content: v.string(),
          time_in_call_secs: v.number(),
          speakerId: v.optional(v.string()),
          speakerName: v.optional(v.string()),
        }),
      ),
    ),
    speakerLabels: v.optional(
      v.array(
        v.object({
          speakerId: v.string(),
          displayName: v.string(),
          userId: v.optional(v.id("users")),
        }),
      ),
    ),
    summary: v.optional(v.string()),
    title: v.optional(v.string()),
    analysis: v.optional(v.any()),
    durationSeconds: v.optional(v.number()),
    status: v.union(
      v.literal("processing"),
      v.literal("needs_speaker_labels"),
      v.literal("done"),
      v.literal("failed"),
    ),
    failureReason: v.optional(conversationFailureReasonValidator),
  },
  handler: async (ctx, args): Promise<InsertConversationResult> => {
    // Defensive: ensure the parent process belongs to the stamping org.
    const process = await ctx.db.get(args.processId);
    if (!process || process.clerkOrgId !== args.clerkOrgId) {
      throw new Error("Process not found in this organisation");
    }
    if (args.elevenlabsConversationId !== undefined) {
      requireElevenLabsConversationId(args.elevenlabsConversationId);
      // Re-checked in the transaction: the import action polls for up to a
      // minute, so another org could have imported the id meanwhile.
      if (
        await elevenLabsConversationOwnedElsewhere(
          ctx,
          args.elevenlabsConversationId,
          args.clerkOrgId,
        )
      ) {
        throw new Error(FOREIGN_CONVERSATION_MESSAGE);
      }
      // One row per ElevenLabs conversation per org. A resend returns the row
      // already there and starts nothing, so a looped import can't buy repeat
      // pipelines or inflate counts. The one exception: a row left
      // `processing` by an import that timed out is completed by a later
      // import that finished, keeping its original process and attribution.
      const existing = await sameOrgImport(
        ctx,
        args.elevenlabsConversationId,
        args.clerkOrgId,
      );
      await markSessionImported(ctx, args.clerkOrgId, args.elevenlabsConversationId);
      if (existing) {
        const completes =
          existing.status === "processing" &&
          (args.status === "done" || args.status === "failed");
        if (!completes) {
          return {
            conversationId: existing._id,
            created: false,
            processId: existing.processId,
            status: existing.status,
          };
        }
        await ctx.db.patch("conversations", existing._id, {
          transcript: args.transcript,
          summary: args.summary,
          title: args.title,
          analysis: args.analysis,
          durationSeconds: args.durationSeconds,
          status: args.status,
          failureReason: args.status === "failed" ? args.failureReason : undefined,
        });
        return {
          conversationId: existing._id,
          created: true,
          processId: existing.processId,
          status: args.status,
        };
      }
    }
    const conversationId = await ctx.db.insert("conversations", {
      processId: args.processId,
      clerkOrgId: args.clerkOrgId,
      elevenlabsConversationId: args.elevenlabsConversationId,
      contributorName: args.contributorName,
      userId: args.userId,
      subjectUserId: args.subjectUserId,
      submittedByName: args.submittedByName,
      consentAttestedAt: args.consentAttestedAt,
      inputMode: args.inputMode ?? "agent",
      audioStorageId: args.audioStorageId,
      audioMimeType: args.audioMimeType,
      transcriptionProvider: args.transcriptionProvider ?? "elevenlabs-convai",
      analysisProvider: args.analysisProvider ?? "elevenlabs-convai",
      transcript: args.transcript,
      speakerLabels: args.speakerLabels,
      summary: args.summary,
      title: args.title,
      analysis: args.analysis,
      durationSeconds: args.durationSeconds,
      status: args.status,
      failureReason: args.status === "failed" ? args.failureReason : undefined,
    });
    return {
      conversationId,
      created: true,
      processId: args.processId,
      status: args.status,
    };
  },
});

// ---------------------------------------------------------------------------
// Public action: fetchConversation
// Called by the frontend after onDisconnect fires. Polls ElevenLabs API
// until the conversation is processed, then inserts data.
// ---------------------------------------------------------------------------

export const fetchConversation = action({
  args: {
    elevenlabsConversationId: v.string(),
    processId: v.id("processes"),
    // Optional on-behalf-of attribution; omitted for ordinary self-recordings.
    contributorName: v.optional(v.string()),
    subjectUserId: v.optional(v.id("users")),
    consentAttested: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "done" | "failed" | "timeout" }> => {
    const { orgId } = await resolveOrgForAction(ctx);
    const elevenlabsConversationId = requireElevenLabsConversationId(
      args.elevenlabsConversationId,
    );
    await ctx.runQuery(internal.processFlows.assertProcessInOrg, {
      processId: args.processId,
      clerkOrgId: orgId,
    });
    // Also gates the caller on contributor role — the resolver runs
    // requireOrgContributor, and escalates to admin for on-behalf submissions.
    const attribution: ResolvedAttribution = await ctx.runQuery(
      internal.postCall.resolveContributorAttribution,
      {
        clerkOrgId: orgId,
        contributorName: args.contributorName,
        subjectUserId: args.subjectUserId,
        consentAttested: args.consentAttested,
      },
    );
    // Spread into every insert below rather than repeating the fields, so a
    // future attribution field can't be added to one exit path and missed in
    // the other four.
    const attributionFields = {
      contributorName: attribution.contributorName,
      userId: attribution.userId,
      subjectUserId: attribution.subjectUserId,
      submittedByName: attribution.submittedByName,
      consentAttestedAt: attribution.submittedByName ? Date.now() : undefined,
    };

    // Refuse before fetching anything from ElevenLabs.
    const ownedElsewhere: boolean = await ctx.runQuery(
      internal.postCall.isElevenLabsConversationOwnedElsewhere,
      { elevenlabsConversationId, clerkOrgId: orgId },
    );
    if (ownedElsewhere) {
      throw new Error(FOREIGN_CONVERSATION_MESSAGE);
    }
    // Already imported here and settled: answer from the row, skipping the
    // poll. A `processing` row falls through so this import can complete it.
    const existingStatus: ConversationStatus | null = await ctx.runQuery(
      internal.postCall.sameOrgImportStatus,
      { elevenlabsConversationId, clerkOrgId: orgId },
    );
    if (existingStatus !== null && existingStatus !== "processing") {
      return { status: fetchStatusFor(existingStatus) };
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error("ELEVENLABS_API_KEY is not configured");
    }

    // Was this interview started through Fabric for this caller? Checked
    // against the conversation's start time once ElevenLabs answers, before
    // anything is stored (see assertImportBinding).
    const issuedToCaller: boolean = await ctx.runQuery(
      internal.interviewSessions.isIssuedToCaller,
      { elevenlabsConversationId },
    );
    let bindingChecked = false;

    const maxRetries = 30;
    const pollIntervalMs = 2000;
    const maxNetworkErrors = 5;
    let consecutiveNetworkErrors = 0;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      let response: Response;
      try {
        response = await fetch(
          buildElevenLabsConversationUrl(elevenlabsConversationId),
          { headers: { "xi-api-key": apiKey } },
        );
      } catch (networkError) {
        consecutiveNetworkErrors++;
        console.error(
          `ElevenLabs network error (attempt ${attempt + 1}, consecutive: ${consecutiveNetworkErrors}):`,
          networkError,
        );

        if (consecutiveNetworkErrors >= maxNetworkErrors) {
          const settled: InsertConversationResult = await ctx.runMutation(internal.postCall.insertConversation, {
            processId: args.processId,
            clerkOrgId: orgId,
            elevenlabsConversationId,
            ...attributionFields,
            inputMode: "agent",
            transcriptionProvider: "elevenlabs-convai",
            analysisProvider: "elevenlabs-convai",
            status: "failed",
            failureReason: "interview_fetch",
          });
          return { status: fetchStatusFor(settled.status) };
        }

        await new Promise((resolve) => setTimeout(resolve, 3000));
        continue;
      }

      consecutiveNetworkErrors = 0;

      if (!response.ok) {
        if (response.status >= 500) {
          console.error(
            `ElevenLabs server error ${response.status} on attempt ${attempt + 1} — retrying`,
          );
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          continue;
        }
        const settled: InsertConversationResult = await ctx.runMutation(internal.postCall.insertConversation, {
          processId: args.processId,
          clerkOrgId: orgId,
          elevenlabsConversationId,
          ...attributionFields,
          inputMode: "agent",
          transcriptionProvider: "elevenlabs-convai",
          analysisProvider: "elevenlabs-convai",
          status: "failed",
          failureReason: "interview_fetch",
        });
        return { status: fetchStatusFor(settled.status) };
      }

      const data = await response.json();
      assertElevenLabsConversationIdentity(
        data,
        elevenlabsConversationId,
        process.env.ELEVENLABS_AGENT_ID,
      );
      if (!bindingChecked) {
        bindingChecked = true;
        assertImportBinding(data, elevenlabsConversationId, issuedToCaller);
      }

      if (data.status === "done") {
        const transcript = normalizeTranscript(data.transcript);
        const summary = data.analysis?.transcript_summary ?? undefined;
        const title = summaryTitleFromAnalysis(data.analysis);
        const analysis = data.analysis ?? null;
        const durationSeconds = data.metadata?.call_duration_secs ?? undefined;

        const inserted: InsertConversationResult = await ctx.runMutation(
          internal.postCall.insertConversation,
          {
            processId: args.processId,
            clerkOrgId: orgId,
            elevenlabsConversationId,
            ...attributionFields,
            transcript,
            summary,
            title,
            analysis,
            durationSeconds,
            inputMode: "agent",
            transcriptionProvider: "elevenlabs-convai",
            analysisProvider: "elevenlabs-convai",
            status: "done",
          },
        );
        // Another import of this conversation got there first: nothing to pay
        // for or rebuild.
        if (!inserted.created) return { status: fetchStatusFor(inserted.status) };

        // ElevenLabs itemises this conversation's bill in metadata.charging —
        // capture it now rather than estimating from duration later.
        await recordAgentConversationUsage(
          ctx,
          {
            clerkOrgId: orgId,
            entityType: "conversation",
            entityId: inserted.conversationId,
            entityLabel: attributionFields.contributorName,
          },
          {
            elevenlabsConversationId,
            metadata: data.metadata,
          },
        );

        // The conversation is committed as done; both pipelines start from here,
        // independently of each other.
        await startConversationPipelines(ctx, inserted.processId, orgId);

        return { status: "done" as const };
      }

      if (data.status === "failed") {
        const settled: InsertConversationResult = await ctx.runMutation(internal.postCall.insertConversation, {
          processId: args.processId,
          clerkOrgId: orgId,
          elevenlabsConversationId,
          ...attributionFields,
          inputMode: "agent",
          transcriptionProvider: "elevenlabs-convai",
          analysisProvider: "elevenlabs-convai",
          status: "failed",
          failureReason: "interview_failed",
        });
        return { status: fetchStatusFor(settled.status) };
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    // Max retries exceeded — insert as processing so frontend can detect via reactivity
    const settled: InsertConversationResult = await ctx.runMutation(internal.postCall.insertConversation, {
      processId: args.processId,
      clerkOrgId: orgId,
      elevenlabsConversationId,
      ...attributionFields,
      inputMode: "agent",
      transcriptionProvider: "elevenlabs-convai",
      analysisProvider: "elevenlabs-convai",
      status: "processing",
    });

    return { status: fetchStatusFor(settled.status) };
  },
});

// Helper query for looking up user by tokenIdentifier (internal only)
export const getUserByToken = internalQuery({
  args: { tokenIdentifier: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", args.tokenIdentifier),
      )
      .unique();
  },
});

// Helper query: verify an ElevenLabs conversation exists in our DB for the
// given org. Used by the audio proxy (Phase 13.7) to authorize playback.
export const conversationExistsByElevenLabsId = internalQuery({
  args: {
    elevenlabsConversationId: v.string(),
    clerkOrgId: v.string(),
  },
  handler: async (ctx, args) => {
    const conv = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_elevenlabsConversationId", (q) =>
        q
          .eq("clerkOrgId", args.clerkOrgId)
          .eq("elevenlabsConversationId", args.elevenlabsConversationId),
      )
      .first();
    return conv !== null;
  },
});

/**
 * Resolves the caller's current membership and verifies that the requested
 * conversation belongs to the same organization. The membership document ID
 * becomes the token's revocation handle.
 */
export const getAudioPlaybackGrant = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const caller = await requireOrgMember(ctx);
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.clerkOrgId !== caller.orgId) return null;
    return {
      clerkOrgId: caller.orgId,
      membershipId: caller.membershipId,
    };
  },
});

/**
 * Mints a short-lived, membership-bound playback token. This is an action so
 * the result is never held indefinitely in Convex's reactive query cache.
 * The audio endpoint rechecks the signed membership ID on every request.
 */
export const getAudioPlaybackToken = action({
  args: { conversationId: v.id("conversations") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    clerkOrgId: string;
    membershipId: Id<"memberships">;
    exp: number;
    sig: string;
  } | null> => {
    const grant: {
      clerkOrgId: string;
      membershipId: Id<"memberships">;
    } | null = await ctx.runQuery(internal.postCall.getAudioPlaybackGrant, {
      conversationId: args.conversationId,
    });
    if (!grant) return null;

    const secret = process.env.AUDIO_SIGNING_SECRET;
    if (!secret) {
      throw new Error(
        "AUDIO_SIGNING_SECRET is not configured on the Convex deployment",
      );
    }

    const exp = Date.now() + AUDIO_PLAYBACK_TOKEN_TTL_MS;
    const sig = await signAudioPlaybackToken(
      secret,
      {
        clerkOrgId: grant.clerkOrgId,
        conversationId: args.conversationId,
        membershipId: grant.membershipId,
        expiresAt: exp,
      },
    );
    return {
      clerkOrgId: grant.clerkOrgId,
      membershipId: grant.membershipId,
      exp,
      sig,
    };
  },
});

export const getConversationAudioSource = internalQuery({
  args: {
    conversationId: v.id("conversations"),
    clerkOrgId: v.string(),
    membershipId: v.id("memberships"),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db.get(args.membershipId);
    if (
      !isActiveMembership(membership) ||
      membership.clerkOrgId !== args.clerkOrgId
    ) {
      return null;
    }
    // Closing a workspace revokes its open playback links too.
    if (await isWorkspaceClosed(ctx, args.clerkOrgId)) return null;

    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.clerkOrgId !== args.clerkOrgId) return null;

    const inputMode = conv.inputMode ?? "agent";
    if (inputMode === "voiceRecord" || inputMode === "audioUpload") {
      if (!conv.audioStorageId) return null;
      return {
        inputMode,
        audioStorageId: conv.audioStorageId,
        audioMimeType: conv.audioMimeType ?? "audio/webm",
      };
    }

    if (!conv.elevenlabsConversationId) return null;
    return {
      inputMode: "agent" as const,
      elevenlabsConversationId: conv.elevenlabsConversationId,
    };
  },
});

// ---------------------------------------------------------------------------
// Internal backfill helpers — always scoped by explicit clerkOrgId arg
// ---------------------------------------------------------------------------

export const getImportedConversationIds = internalQuery({
  args: { clerkOrgId: v.string() },
  handler: async (ctx, args) => {
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_processId", (q) =>
        q.eq("clerkOrgId", args.clerkOrgId),
      )
      .take(10000);
    return conversations.flatMap((c) =>
      c.elevenlabsConversationId ? [c.elevenlabsConversationId] : [],
    );
  },
});

export const listUnimported = internalAction({
  args: { clerkOrgId: v.string() },
  handler: async (ctx, args) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");

    const agentId = process.env.ELEVENLABS_AGENT_ID;

    const url = new URL("https://api.elevenlabs.io/v1/convai/conversations");
    if (agentId) url.searchParams.set("agent_id", agentId);

    const response = await fetch(url.toString(), {
      headers: { "xi-api-key": apiKey },
    });
    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    const data = await response.json();
    const allConversations: Array<{
      conversation_id: string;
      status: string;
      start_time_unix_secs?: number;
      call_duration_secs?: number;
    }> = data.conversations ?? [];

    const importedIds: string[] = await ctx.runQuery(
      internal.postCall.getImportedConversationIds,
      { clerkOrgId: args.clerkOrgId },
    );
    const importedSet: Set<string> = new Set(importedIds);

    const unimported: Array<{
      conversationId: string;
      startTime: string | null;
      durationSeconds: number | null;
    }> = allConversations
      .filter((c) => !importedSet.has(c.conversation_id) && c.status === "done")
      .map((c) => ({
        conversationId: c.conversation_id,
        startTime: c.start_time_unix_secs
          ? new Date(c.start_time_unix_secs * 1000).toISOString()
          : null,
        durationSeconds: c.call_duration_secs ?? null,
      }));

    return unimported;
  },
});

export const importConversation = internalAction({
  args: {
    elevenlabsConversationId: v.string(),
    processId: v.id("processes"),
    contributorName: v.string(),
    clerkOrgId: v.string(),
  },
  handler: async (ctx, args) => {
    const elevenlabsConversationId = requireElevenLabsConversationId(
      args.elevenlabsConversationId,
    );
    await ctx.runQuery(internal.processFlows.assertProcessInOrg, {
      processId: args.processId,
      clerkOrgId: args.clerkOrgId,
    });

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");

    const response = await fetch(
      buildElevenLabsConversationUrl(elevenlabsConversationId),
      { headers: { "xi-api-key": apiKey } },
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    const data = await response.json();
    assertElevenLabsConversationIdentity(
      data,
      elevenlabsConversationId,
      process.env.ELEVENLABS_AGENT_ID,
    );

    if (data.status !== "done") {
      throw new Error(
        `Conversation status is "${data.status}" — only "done" conversations can be imported`,
      );
    }

    const transcript = normalizeTranscript(data.transcript);
    const summary = data.analysis?.transcript_summary ?? undefined;
    const title = summaryTitleFromAnalysis(data.analysis);
    const analysis = data.analysis ?? null;
    const durationSeconds = data.metadata?.call_duration_secs ?? undefined;

    const inserted: InsertConversationResult = await ctx.runMutation(
      internal.postCall.insertConversation,
      {
        processId: args.processId,
        clerkOrgId: args.clerkOrgId,
        elevenlabsConversationId,
        contributorName: args.contributorName,
        transcript,
        summary,
        title,
        analysis,
        durationSeconds,
        inputMode: "agent",
        transcriptionProvider: "elevenlabs-convai",
        analysisProvider: "elevenlabs-convai",
        status: "done",
      },
    );
    if (!inserted.created) {
      return { status: fetchStatusFor(inserted.status), summary };
    }

    await recordAgentConversationUsage(
      ctx,
      {
        clerkOrgId: args.clerkOrgId,
        entityType: "conversation",
        entityId: inserted.conversationId,
        entityLabel: args.contributorName,
      },
      {
        elevenlabsConversationId,
        metadata: data.metadata,
      },
    );

    await startConversationPipelines(ctx, inserted.processId, args.clerkOrgId);

    return { status: "done" as const, summary };
  },
});

export const refreshConversationAnalysis = internalAction({
  args: {
    elevenlabsConversationId: v.string(),
    clerkOrgId: v.string(),
  },
  handler: async (ctx, args) => {
    const elevenlabsConversationId = requireElevenLabsConversationId(
      args.elevenlabsConversationId,
    );
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");

    const existing = await ctx.runQuery(
      internal.postCall.getConversationByElevenLabsId,
      {
        elevenlabsConversationId,
        clerkOrgId: args.clerkOrgId,
      },
    );
    if (!existing) {
      throw new Error(
        `Conversation ${elevenlabsConversationId} not found in org ${args.clerkOrgId}`,
      );
    }

    const response = await fetch(
      buildElevenLabsConversationUrl(elevenlabsConversationId),
      { headers: { "xi-api-key": apiKey } },
    );
    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    const data = await response.json();
    assertElevenLabsConversationIdentity(
      data,
      elevenlabsConversationId,
      process.env.ELEVENLABS_AGENT_ID,
    );
    const transcript =
      normalizeTranscript(data.transcript) ?? existing.transcript;
    const summary = data.analysis?.transcript_summary ?? existing.summary;
    const title = summaryTitleFromAnalysis(data.analysis) ?? existing.title;
    const analysis = data.analysis ?? existing.analysis;
    const durationSeconds =
      data.metadata?.call_duration_secs ?? existing.durationSeconds;

    // Re-reading the same immutable bill, so this converges on the existing row
    // (the ledger upserts on idempotencyKey) rather than double-counting.
    await recordAgentConversationUsage(
      ctx,
      {
        clerkOrgId: args.clerkOrgId,
        entityType: "conversation",
        entityId: existing._id,
      },
      {
        elevenlabsConversationId,
        metadata: data.metadata,
      },
    );

    const transcriptChanged =
      hashTranscript(existing.transcript ?? null) !==
      hashTranscript(transcript ?? null);
    await ctx.runMutation(internal.postCall.updateConversationAnalysis, {
      conversationId: existing._id,
      clerkOrgId: args.clerkOrgId,
      transcript,
      summary,
      title,
      analysis,
      durationSeconds,
    });

    if (transcriptChanged) {
      // A rewritten transcript invalidates the summary but still waits for a
      // person: the cached evidence for this conversation is already keyed by
      // transcript hash, so the rebuild re-extracts only what changed.
      await ctx.runMutation(internal.summaryEvidence.markProcessSummaryStale, {
        processId: existing.processId,
        clerkOrgId: args.clerkOrgId,
      });
    }

    console.log(`Refreshed analysis for ${elevenlabsConversationId}`);
    return { status: "updated" as const };
  },
});

export const getConversationByElevenLabsId = internalQuery({
  args: {
    elevenlabsConversationId: v.string(),
    clerkOrgId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_elevenlabsConversationId", (q) =>
        q
          .eq("clerkOrgId", args.clerkOrgId)
          .eq("elevenlabsConversationId", args.elevenlabsConversationId),
      )
      .first();
  },
});

export const updateConversationAnalysis = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    clerkOrgId: v.string(),
    transcript: v.optional(
      v.array(
        v.object({
          role: v.string(),
          content: v.string(),
          time_in_call_secs: v.number(),
          speakerId: v.optional(v.string()),
          speakerName: v.optional(v.string()),
        }),
      ),
    ),
    summary: v.optional(v.string()),
    title: v.optional(v.string()),
    analysis: v.optional(v.any()),
    durationSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.clerkOrgId !== args.clerkOrgId) {
      throw new Error("Conversation not found in this organisation");
    }
    await ctx.db.patch(args.conversationId, {
      transcript: args.transcript,
      summary: args.summary,
      title: args.title,
      analysis: args.analysis,
      durationSeconds: args.durationSeconds,
    });
  },
});

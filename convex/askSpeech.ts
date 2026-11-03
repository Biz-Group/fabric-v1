import { v } from "convex/values";
import { action, internalMutation, internalQuery, type ActionCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ASKFABRIC_OPERATIONS } from "./lib/askFabricFeature";
import { readSpeechConfig, speakableText, TTS_OUTPUT_FORMAT, TTS_PROVIDER } from "./lib/askSpeech";
import { recordSpeechUsage, type UsageAttribution } from "./lib/aiUsageMeter";
import { AUDIO_PLAYBACK_TOKEN_TTL_MS, signAskSpeechToken, verifyAskSpeechToken } from "./lib/audioPlaybackToken";
import { isActiveMembership, requireOrgMember } from "./lib/orgAuth";
import { userError } from "./lib/userError";

/**
 * Read aloud (ElevenLabs text-to-speech). The first press streams the
 * answer's audio from ElevenLabs through `GET /ask/speech`, so it starts
 * playing within a second or so, and keeps a copy; every later press replays
 * the stored file. Only the answer's owner can hear it, as with the thread
 * itself, and the audio is deleted with the thread.
 */

const ELEVENLABS_TTS_ORIGIN = "https://api.elevenlabs.io";
const TTS_TIMEOUT_MS = 120_000;
export const SPEECH_STREAM_PATH = "/ask/speech";

const notFound = () => userError("MESSAGE_NOT_FOUND", "This answer no longer exists.");

type SpeechTarget =
  | { kind: "stored"; url: string; storageId: Id<"_storage"> }
  | { kind: "generate"; text: string; threadId: Id<"askThreads">; clerkOrgId: string; userId: Id<"users"> };

/** The member's own finished answer: its stored audio, or the text to speak. */
async function answerTarget(
  ctx: QueryCtx,
  messageId: Id<"askMessages">,
  owner: { orgId: string; userId: Id<"users"> },
): Promise<SpeechTarget> {
  const message = await ctx.db.get(messageId);
  if (!message || message.clerkOrgId !== owner.orgId || message.userId !== owner.userId || message.role !== "assistant") {
    throw notFound();
  }
  const thread = await ctx.db.get(message.threadId);
  if (!thread || thread.status === "deleting") throw notFound();
  if (message.status === "streaming") throw userError("ANSWER_NOT_READY", "Wait for the answer to finish.");
  const stored = await ctx.db
    .query("askSpeech")
    .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
    .first();
  const url = stored ? await ctx.storage.getUrl(stored.storageId) : null;
  if (stored && url) return { kind: "stored", url, storageId: stored.storageId };
  const text = speakableText(
    message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n"),
  );
  if (!text) throw userError("NOTHING_TO_READ", "This answer has nothing to read aloud.");
  return { kind: "generate", text, threadId: message.threadId, clerkOrgId: message.clerkOrgId, userId: message.userId };
}

/** For the signed-in caller, plus the membership their stream link is bound to. */
export const speechTarget = internalQuery({
  args: { messageId: v.id("askMessages") },
  handler: async (ctx, args): Promise<{ target: SpeechTarget; membershipId: Id<"memberships"> }> => {
    const org = await requireOrgMember(ctx);
    const target = await answerTarget(ctx, args.messageId, org);
    return { target, membershipId: org.membershipId };
  },
});

/**
 * For a stream link: the membership it was signed for must still be active,
 * so removing a member revokes their open links at once.
 */
export const streamTarget = internalQuery({
  args: { messageId: v.id("askMessages"), clerkOrgId: v.string(), membershipId: v.id("memberships") },
  handler: async (ctx, args): Promise<SpeechTarget> => {
    const membership: Doc<"memberships"> | null = await ctx.db.get(args.membershipId);
    if (!isActiveMembership(membership) || membership.clerkOrgId !== args.clerkOrgId) throw notFound();
    const user = await ctx.db.get(membership.userId);
    if (!user || user.deletedAt !== undefined) throw notFound();
    return await answerTarget(ctx, args.messageId, { orgId: args.clerkOrgId, userId: membership.userId });
  },
});

/**
 * Keeps the generated audio, unless the thread went away meanwhile or a
 * second press got there first; then this copy is discarded.
 */
export const saveSpeech = internalMutation({
  args: {
    messageId: v.id("askMessages"),
    storageId: v.id("_storage"),
    voiceId: v.string(),
    model: v.string(),
    characters: v.number(),
  },
  handler: async (ctx, args): Promise<string | null> => {
    const message = await ctx.db.get(args.messageId);
    const thread = message ? await ctx.db.get(message.threadId) : null;
    if (!message || !thread || thread.status === "deleting") {
      await ctx.storage.delete(args.storageId);
      return null;
    }
    const existing = await ctx.db
      .query("askSpeech")
      .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
      .first();
    if (existing) {
      await ctx.storage.delete(args.storageId);
      return await ctx.storage.getUrl(existing.storageId);
    }
    await ctx.db.insert("askSpeech", {
      messageId: message._id,
      threadId: message.threadId,
      clerkOrgId: message.clerkOrgId,
      userId: message.userId,
      storageId: args.storageId,
      voiceId: args.voiceId,
      model: args.model,
      characters: args.characters,
    });
    return await ctx.storage.getUrl(args.storageId);
  },
});

/**
 * Where to play the answer from: the stored file, or, on the first press, a
 * five-minute link that streams it as ElevenLabs generates it.
 */
export const readAloud = action({
  args: { messageId: v.id("askMessages") },
  handler: async (ctx, args): Promise<{ kind: "stored" | "stream"; url: string }> => {
    const { target, membershipId }: { target: SpeechTarget; membershipId: Id<"memberships"> } = await ctx.runQuery(
      internal.askSpeech.speechTarget,
      args,
    );
    if (target.kind === "stored") return { kind: "stored", url: target.url };

    const secret = process.env.AUDIO_SIGNING_SECRET;
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!secret || !siteUrl || !process.env.ELEVENLABS_API_KEY) {
      throw userError("READ_ALOUD_UNAVAILABLE", "Read aloud isn't available right now.");
    }
    const expiresAt = Date.now() + AUDIO_PLAYBACK_TOKEN_TTL_MS;
    const sig = await signAskSpeechToken(secret, {
      clerkOrgId: target.clerkOrgId,
      messageId: args.messageId,
      membershipId,
      expiresAt,
    });
    const url = new URL(SPEECH_STREAM_PATH, siteUrl);
    url.searchParams.set("m", args.messageId);
    url.searchParams.set("o", target.clerkOrgId);
    url.searchParams.set("mid", membershipId);
    url.searchParams.set("exp", String(expiresAt));
    url.searchParams.set("sig", sig);
    return { kind: "stream", url: url.toString() };
  },
});

const SPEECH_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};

/**
 * `GET /ask/speech`: relays ElevenLabs' audio stream to the browser as it is
 * generated, and stores the whole file once it ends. If the listener leaves
 * early, the rest is still read and stored, so the press isn't paid twice.
 * `cors` adds the app's CORS headers (see http.ts).
 */
export async function streamAskSpeech(
  ctx: ActionCtx,
  req: Request,
  cors: (headers: Record<string, string>) => Record<string, string>,
): Promise<Response> {
  const reject = (status: number, message: string) =>
    new Response(message, { status, headers: cors({ ...SPEECH_HEADERS }) });
  const params = new URL(req.url).searchParams;
  const messageId = params.get("m");
  const clerkOrgId = params.get("o");
  const membershipId = params.get("mid");
  const sig = params.get("sig");
  const expiresAt = Number(params.get("exp"));
  if (!messageId || !clerkOrgId || !membershipId || !sig || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return reject(404, "Not found");
  }
  const secret = process.env.AUDIO_SIGNING_SECRET;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!secret || !apiKey) return reject(500, "Server configuration error");
  if (!(await verifyAskSpeechToken(secret, { clerkOrgId, messageId, membershipId, expiresAt }, sig))) {
    return reject(404, "Not found");
  }

  let target: SpeechTarget;
  try {
    target = await ctx.runQuery(internal.askSpeech.streamTarget, {
      messageId: messageId as Id<"askMessages">,
      clerkOrgId,
      membershipId: membershipId as Id<"memberships">,
    });
  } catch {
    return reject(404, "Not found");
  }
  const audioHeaders = cors({ ...SPEECH_HEADERS, "Content-Type": "audio/mpeg" });
  if (target.kind === "stored") {
    const blob = await ctx.storage.get(target.storageId);
    return blob ? new Response(blob, { status: 200, headers: audioHeaders }) : reject(404, "Not found");
  }

  const { voiceId, model } = readSpeechConfig();
  const attribution: UsageAttribution = {
    clerkOrgId: target.clerkOrgId,
    entityType: "askThread",
    entityId: target.threadId,
    actorUserId: target.userId,
    runId: messageId,
  };
  const startedAt = Date.now();
  const meter = (status: "ok" | "failed", characters: number, extra: { requestId?: string; errorType?: string }) =>
    recordSpeechUsage(ctx, attribution, {
      operation: ASKFABRIC_OPERATIONS.speech,
      provider: TTS_PROVIDER,
      model,
      characters,
      status,
      startedAt,
      ...extra,
    });

  const upstreamUrl = new URL(`/v1/text-to-speech/${voiceId}/stream`, ELEVENLABS_TTS_ORIGIN);
  upstreamUrl.searchParams.set("output_format", TTS_OUTPUT_FORMAT);
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: target.text, model_id: model }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    });
  } catch (error) {
    const errorType = error instanceof Error ? error.name : "UnknownError";
    console.error("AskFabric read aloud request failed", { errorType });
    await meter("failed", 0, { errorType });
    return reject(502, "Couldn't read this answer aloud.");
  }
  const requestId = upstream.headers.get("request-id") ?? undefined;
  if (!upstream.ok || !upstream.body) {
    const detail = (await upstream.text().catch(() => "")).slice(0, 300);
    console.error("AskFabric read aloud rejected", { status: upstream.status, requestId, detail });
    await meter("failed", 0, { requestId, errorType: `http_${upstream.status}` });
    return reject(502, "Couldn't read this answer aloud.");
  }

  let finished = false;
  // Billed per character sent; the `character-cost` header is plan credits.
  const finish = async (outcome: RelayOutcome) => {
    if (finished) return;
    finished = true;
    if (!outcome.ok) {
      console.error("AskFabric read aloud stream broke", { requestId, errorType: outcome.errorType });
      await meter("failed", target.text.length, { requestId, errorType: outcome.errorType });
      return;
    }
    await meter("ok", target.text.length, { requestId });
    const storageId = await ctx.storage.store(new Blob(outcome.chunks as BlobPart[], { type: "audio/mpeg" }));
    await ctx.runMutation(internal.askSpeech.saveSpeech, {
      messageId: messageId as Id<"askMessages">,
      storageId,
      voiceId,
      model,
      characters: target.text.length,
    });
  };
  const body = relayStream(upstream.body.getReader(), finish);
  return new Response(body, { status: 200, headers: audioHeaders });
}

type RelayOutcome = { ok: true; chunks: Uint8Array[] } | { ok: false; errorType: string };

const errorTypeOf = (error: unknown) => (error instanceof Error ? error.name : "UnknownError");

/**
 * Passes each chunk on as it arrives and hands `finish` the whole file at the
 * end. If the reader cancels, the rest is still read, so the audio is kept.
 */
export function relayStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  finish: (outcome: RelayOutcome) => Promise<void>,
): ReadableStream<Uint8Array> {
  const chunks: Uint8Array[] = [];
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch (error) {
        await finish({ ok: false, errorType: errorTypeOf(error) });
        controller.error(error);
        return;
      }
      if (!next.done) {
        chunks.push(next.value);
        controller.enqueue(next.value);
        return;
      }
      await finish({ ok: true, chunks });
      controller.close();
    },
    async cancel() {
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          chunks.push(next.value);
        }
        await finish({ ok: true, chunks });
      } catch (error) {
        await finish({ ok: false, errorType: errorTypeOf(error) });
      }
    },
  });
}

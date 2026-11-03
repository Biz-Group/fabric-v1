import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ASKFABRIC_OPERATIONS } from "./lib/askFabricFeature";
import { readSpeechConfig, speakableText, TTS_OUTPUT_FORMAT, TTS_PROVIDER } from "./lib/askSpeech";
import { recordSpeechUsage, type UsageAttribution } from "./lib/aiUsageMeter";
import { requireOrgMember } from "./lib/orgAuth";
import { userError } from "./lib/userError";

/**
 * Read aloud (ElevenLabs text-to-speech). The first press on an answer
 * generates its audio and stores it; every later press replays the stored
 * file. Only the answer's owner can hear it, as with the thread itself, and
 * the audio is deleted with the thread.
 */

const ELEVENLABS_TTS_ORIGIN = "https://api.elevenlabs.io";
const TTS_TIMEOUT_MS = 60_000;

const notFound = () => userError("MESSAGE_NOT_FOUND", "This answer no longer exists.");
const failed = () => userError("READ_ALOUD_FAILED", "Couldn't read this answer aloud. Try again.");

type SpeechTarget =
  | { kind: "stored"; url: string }
  | { kind: "generate"; text: string; threadId: Id<"askThreads">; clerkOrgId: string; userId: Id<"users"> };

/** The caller's own finished answer: its stored audio, or the text to speak. */
export const speechTarget = internalQuery({
  args: { messageId: v.id("askMessages") },
  handler: async (ctx, args): Promise<SpeechTarget> => {
    const org = await requireOrgMember(ctx);
    const message = await ctx.db.get(args.messageId);
    if (!message || message.clerkOrgId !== org.orgId || message.userId !== org.userId || message.role !== "assistant") {
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
    if (url) return { kind: "stored", url };
    const text = speakableText(
      message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n"),
    );
    if (!text) throw userError("NOTHING_TO_READ", "This answer has nothing to read aloud.");
    return { kind: "generate", text, threadId: message.threadId, clerkOrgId: message.clerkOrgId, userId: message.userId };
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

/** The answer's audio URL, generating and storing it on the first press. */
export const readAloud = action({
  args: { messageId: v.id("askMessages") },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const target: SpeechTarget = await ctx.runQuery(internal.askSpeech.speechTarget, args);
    if (target.kind === "stored") return { url: target.url };

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw userError("READ_ALOUD_UNAVAILABLE", "Read aloud isn't available right now.");
    const { voiceId, model } = readSpeechConfig();
    const attribution: UsageAttribution = {
      clerkOrgId: target.clerkOrgId,
      entityType: "askThread",
      entityId: target.threadId,
      actorUserId: target.userId,
      runId: args.messageId,
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

    const url = new URL(`/v1/text-to-speech/${voiceId}`, ELEVENLABS_TTS_ORIGIN);
    url.searchParams.set("output_format", TTS_OUTPUT_FORMAT);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text: target.text, model_id: model }),
        signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      });
    } catch (error) {
      const errorType = error instanceof Error ? error.name : "UnknownError";
      console.error("AskFabric read aloud request failed", { errorType });
      await meter("failed", 0, { errorType });
      throw failed();
    }
    const requestId = response.headers.get("request-id") ?? undefined;
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      console.error("AskFabric read aloud rejected", { status: response.status, requestId, detail });
      await meter("failed", 0, { requestId, errorType: `http_${response.status}` });
      throw failed();
    }
    const audio = await response.arrayBuffer();
    // The API price is per character sent. (The `character-cost` header is
    // plan credits, which v4 Turbo discounts, so it is not used here.)
    const characters = target.text.length;
    await meter("ok", characters, { requestId });

    const storageId = await ctx.storage.store(new Blob([audio], { type: "audio/mpeg" }));
    const stored: string | null = await ctx.runMutation(internal.askSpeech.saveSpeech, {
      messageId: args.messageId,
      storageId,
      voiceId,
      model,
      characters,
    });
    if (!stored) throw notFound();
    return { url: stored };
  },
});

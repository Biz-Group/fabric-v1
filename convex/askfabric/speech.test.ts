/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { MAX_SPEECH_CHARS, speakableText } from "../lib/askSpeech";
import { userErrorMessageOf } from "../lib/userError";

const modules = import.meta.glob("/convex/**/*.ts");
const ORG = "org_ask_speech";
const ISSUER = "https://ask-speech.test";
const ENV = { CLERK_JWT_ISSUER_DOMAIN: ISSUER, ELEVENLABS_API_KEY: "el_test_key" };
const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

describe("speakableText", () => {
  test("drops citation markers and markdown, and ends structural lines with a stop", () => {
    const markdown = [
      "## Where time goes",
      "",
      "Finance waits on **approvals**[[cite:1]] and *manual* re-keying[[cite:2]].",
      "",
      "- Invoices are checked twice",
      "1. See [the flow](https://example.test) first",
      "",
      "| Process | Delay |",
      "| --- | ---: |",
      "| Payroll | `3 days` |",
    ].join("\n");
    expect(speakableText(markdown)).toBe(
      [
        "Where time goes.",
        "",
        "Finance waits on approvals and manual re-keying.",
        "",
        "Invoices are checked twice.",
        "See the flow first.",
        "",
        "Process, Delay.",
        "Payroll, 3 days.",
      ].join("\n"),
    );
  });

  test("a sources section the model wrote, and bare links, are not read out", () => {
    const markdown = [
      "Approvals wait on Finance, see https://example.test/flow for detail.[[cite:1]]",
      "",
      "**Sources:**",
      "- [1] Finance overview",
    ].join("\n");
    expect(speakableText(markdown)).toBe("Approvals wait on Finance, see for detail.");
    // A sentence that merely starts with the word stays.
    expect(speakableText("Sources disagree on the date.")).toBe("Sources disagree on the date.");
  });

  test("a very long answer is cut at a sentence and says the rest is on screen", () => {
    const text = speakableText("A sentence here. ".repeat(1_000));
    expect(text.length).toBeLessThanOrEqual(MAX_SPEECH_CHARS + 40);
    expect(text.endsWith("here. The rest of this answer is on screen.")).toBe(true);
  });
});

async function member(ctx: MutationCtx, clerkUserId: string) {
  const tokenIdentifier = `${ISSUER}|${clerkUserId}`;
  const userId = await ctx.db.insert("users", { tokenIdentifier, name: clerkUserId, email: `${clerkUserId}@example.test`, profileComplete: true });
  await ctx.db.insert("memberships", { tokenIdentifier, userId, clerkOrgId: ORG, role: "viewer", createdAt: 0, clerkUserId });
  return { tokenIdentifier, userId };
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ana = await member(ctx, "user_ana");
    const olga = await member(ctx, "user_olga");
    const threadId = await ctx.db.insert("askThreads", { clerkOrgId: ORG, userId: ana.userId, title: "t", status: "active", lastMessageAt: 1 });
    const messageId = await ctx.db.insert("askMessages", {
      threadId,
      clerkOrgId: ORG,
      userId: ana.userId,
      role: "assistant",
      parts: [{ type: "text", text: "Finance waits on **approvals**.[[cite:1]]" }],
      status: "complete",
    });
    return { ana, olga, threadId, messageId };
  });
  const as = (who: { tokenIdentifier: string }) =>
    t.withIdentity({ tokenIdentifier: who.tokenIdentifier, subject: who.tokenIdentifier, issuer: ISSUER, orgId: ORG, orgSlug: ORG });
  return { t, ...ids, as };
}

const tts = vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>(async () =>
  new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg", "request-id": "req_1" } }),
);

beforeEach(() => {
  Object.assign(process.env, ENV);
  tts.mockClear();
  vi.stubGlobal("fetch", tts);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("read aloud", () => {
  test("generates once with the Fabric voice, then replays the stored audio", async () => {
    const s = await setup();
    const first = await s.as(s.ana).action(api.askSpeech.readAloud, { messageId: s.messageId });
    const second = await s.as(s.ana).action(api.askSpeech.readAloud, { messageId: s.messageId });
    expect(first.url).toBeTruthy();
    expect(second.url).toBe(first.url);
    expect(tts).toHaveBeenCalledTimes(1);
    const [url, init] = tts.mock.calls[0];
    expect(String(url)).toBe("https://api.elevenlabs.io/v1/text-to-speech/l4Coq6695JDX9xtLqXDE?output_format=mp3_44100_64");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "Finance waits on approvals.", model_id: "eleven_flash_v2_5" });

    const usage = await s.t.run((ctx) => ctx.db.query("aiUsageEvents").collect());
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      unit: "characters",
      operation: "askfabric.speech",
      provider: "elevenlabs",
      model: "eleven_flash_v2_5",
      characters: 27,
      costMicroUsd: 27 * 40,
      status: "ok",
      runId: s.messageId,
    });
  });

  test("only the answer's owner can hear it", async () => {
    const s = await setup();
    // convex-test double-encodes a ConvexError thrown in a nested query, so
    // only the refusal itself is checked here.
    await expect(s.as(s.olga).action(api.askSpeech.readAloud, { messageId: s.messageId })).rejects.toThrow(
      /This answer no longer exists/,
    );
    expect(tts).not.toHaveBeenCalled();
  });

  test("a rejected request stores nothing and says so", async () => {
    const s = await setup();
    tts.mockResolvedValueOnce(new Response("quota", { status: 429 }));
    const error = await s.as(s.ana).action(api.askSpeech.readAloud, { messageId: s.messageId }).catch((e) => e);
    expect(userErrorMessageOf(error)).toBe("Couldn't read this answer aloud. Try again.");
    const rows = await s.t.run(async (ctx) => ({
      speech: await ctx.db.query("askSpeech").collect(),
      usage: await ctx.db.query("aiUsageEvents").collect(),
    }));
    expect(rows.speech).toHaveLength(0);
    expect(rows.usage[0]).toMatchObject({ status: "failed", characters: 0, errorType: "http_429" });
  });

  test("the audio goes with its thread", async () => {
    vi.useFakeTimers();
    try {
      const s = await setup();
      await s.as(s.ana).action(api.askSpeech.readAloud, { messageId: s.messageId });
      const storageId = await s.t.run(async (ctx) => (await ctx.db.query("askSpeech").first())!.storageId);
      await s.as(s.ana).mutation(api.askThreads.deleteThread, { threadId: s.threadId as Id<"askThreads"> });
      await s.t.finishAllScheduledFunctions(vi.runAllTimers);
      const left = await s.t.run(async (ctx) => ({
        speech: await ctx.db.query("askSpeech").collect(),
        blob: await ctx.storage.get(storageId),
      }));
      expect(left).toEqual({ speech: [], blob: null });
    } finally {
      vi.useRealTimers();
    }
  });
});

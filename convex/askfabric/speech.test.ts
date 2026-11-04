/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { relayStream } from "../askSpeech";
import { buildSpeechUsageEvent } from "../lib/aiUsageMeter";
import { MAX_SPEECH_CHARS, speakableText } from "../lib/askSpeech";

const modules = import.meta.glob("/convex/**/*.ts");
const ORG = "org_ask_speech";
const ISSUER = "https://ask-speech.test";
const SITE = "https://ask-speech.convex.site";
const ENV = {
  CLERK_JWT_ISSUER_DOMAIN: ISSUER,
  ELEVENLABS_API_KEY: "el_test_key",
  AUDIO_SIGNING_SECRET: "test-audio-signing-secret-with-sufficient-entropy",
  CONVEX_SITE_URL: SITE,
};
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

function streamOf(chunks: number[][], failAt?: number) {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i === failAt) return controller.error(new TypeError("network"));
      if (i === chunks.length) return controller.close();
      controller.enqueue(new Uint8Array(chunks[i++]));
    },
  }).getReader();
}

describe("relayStream", () => {
  test("passes chunks through as they come and hands over the whole file at the end", async () => {
    const finish = vi.fn(async () => {});
    const relayed = relayStream(streamOf([[1, 2], [3]]), finish);
    expect([...new Uint8Array(await new Response(relayed).arrayBuffer())]).toEqual([1, 2, 3]);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith({ ok: true, chunks: [new Uint8Array([1, 2]), new Uint8Array([3])] });
  });

  test("a listener who leaves early still gets the whole file kept", async () => {
    const finish = vi.fn(async () => {});
    const reader = relayStream(streamOf([[1], [2], [3]]), finish).getReader();
    await reader.read();
    await reader.cancel();
    expect(finish).toHaveBeenCalledWith({ ok: true, chunks: [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])] });
  });

  test("a broken upstream is reported, not kept", async () => {
    const finish = vi.fn(async () => {});
    await expect(new Response(relayStream(streamOf([[1]], 1), finish)).arrayBuffer()).rejects.toThrow();
    expect(finish).toHaveBeenCalledWith({ ok: false, errorType: "TypeError" });
  });
});

async function member(ctx: MutationCtx, clerkUserId: string) {
  const tokenIdentifier = `${ISSUER}|${clerkUserId}`;
  const userId = await ctx.db.insert("users", { tokenIdentifier, name: clerkUserId, email: `${clerkUserId}@example.test`, profileComplete: true });
  const membershipId = await ctx.db.insert("memberships", { tokenIdentifier, userId, clerkOrgId: ORG, role: "viewer", createdAt: 0, clerkUserId });
  return { tokenIdentifier, userId, membershipId };
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
  /** Presses read aloud and plays the stream link it hands back. */
  const listen = async (who: { tokenIdentifier: string }) => {
    const source = await as(who).action(api.askSpeech.readAloud, { messageId: ids.messageId });
    if (source.kind !== "stream") return { source, response: null };
    expect(source.url.startsWith(`${SITE}/ask/speech?`)).toBe(true);
    const response = await t.fetch(source.url.slice(SITE.length), { method: "GET" });
    return { source, response, bytes: response.ok ? [...new Uint8Array(await response.arrayBuffer())] : null };
  };
  return { t, ...ids, as, listen };
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
  test("the first press streams from ElevenLabs with the Fabric voice", async () => {
    const s = await setup();
    const { url, kind } = await s.as(s.ana).action(api.askSpeech.readAloud, { messageId: s.messageId });
    expect(kind).toBe("stream");
    expect(url.startsWith(`${SITE}/ask/speech?`)).toBe(true);
    // convex-test can't run Convex calls once the handler has returned, so the
    // relay itself is covered by the relayStream tests above.
    const response = await s.t.fetch(url.slice(SITE.length), { method: "GET" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(tts).toHaveBeenCalledTimes(1);
    const [upstream, init] = tts.mock.calls[0];
    expect(String(upstream)).toBe("https://api.elevenlabs.io/v1/text-to-speech/l4Coq6695JDX9xtLqXDE/stream?output_format=mp3_44100_64");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "Finance waits on approvals.", model_id: "eleven_v4_turbo" });
  });

  test("stored audio is replayed, not generated again", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([new Uint8Array([9])], { type: "audio/mpeg" }));
      await ctx.runMutation(internal.askSpeech.saveSpeech, { messageId: s.messageId, storageId, voiceId: "v", model: "m", characters: 27 });
    });
    const source = await s.as(s.ana).action(api.askSpeech.readAloud, { messageId: s.messageId });
    expect(source.kind).toBe("stored");
    expect(tts).not.toHaveBeenCalled();
  });

  test("characters are metered at the list rate", () => {
    expect(
      buildSpeechUsageEvent({
        attribution: { clerkOrgId: ORG, runId: "m1" },
        deployment: "dev",
        idempotencyKey: "k",
        createdAt: 1,
        operation: "askfabric.speech",
        provider: "elevenlabs",
        model: "eleven_v4_turbo",
        characters: 27,
        status: "ok",
      }),
    ).toMatchObject({ unit: "characters", characters: 27, costMicroUsd: 27 * 40, runId: "m1" });
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

  test("a stream link is refused when tampered with, or once its member is removed", async () => {
    const s = await setup();
    const { url } = await s.as(s.ana).action(api.askSpeech.readAloud, { messageId: s.messageId });
    const path = url.slice(SITE.length);
    const forged = path.replace(/mid=[^&]+/, `mid=${s.olga.membershipId}`);
    expect((await s.t.fetch(forged, { method: "GET" })).status).toBe(404);
    await s.t.run((ctx) => ctx.db.patch("memberships", s.ana.membershipId, { removedAt: 1 }));
    expect((await s.t.fetch(path, { method: "GET" })).status).toBe(404);
    expect(tts).not.toHaveBeenCalled();
  });

  test("a rejected request stores nothing and fails the stream", async () => {
    const s = await setup();
    tts.mockResolvedValueOnce(new Response("quota", { status: 429 }));
    const { response } = await s.listen(s.ana);
    expect(response?.status).toBe(502);
    const rows = await s.t.run(async (ctx) => ({
      speech: await ctx.db.query("askSpeech").collect(),
      usage: await ctx.db.query("aiUsageEvents").collect(),
    }));
    expect(rows.speech).toHaveLength(0);
    expect(rows.usage[0]).toMatchObject({ status: "failed", characters: 0, errorType: "http_429", httpStatus: 429 });
  });

  test("the audio goes with its thread", async () => {
    vi.useFakeTimers();
    try {
      const s = await setup();
      const storageId = await s.t.run(async (ctx) => {
        const id = await ctx.storage.store(new Blob([new Uint8Array([9])], { type: "audio/mpeg" }));
        await ctx.runMutation(internal.askSpeech.saveSpeech, { messageId: s.messageId, storageId: id, voiceId: "v", model: "m", characters: 27 });
        return id;
      });
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

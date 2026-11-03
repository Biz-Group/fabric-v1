/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { userErrorMessageOf } from "../lib/userError";
import { SUMMARY_V2_PROMPT_VERSIONS, type ProcessOverviewArtifactV2 } from "../summaryV2";

const modules = import.meta.glob("/convex/**/*.ts");
const ORG = "org_ask_threads";
const ISSUER = "https://ask-threads.test";
const saved = process.env.SUMMARY_V2;

function artifact(findingId: string): ProcessOverviewArtifactV2 {
  return {
    schemaVersion: "v2",
    sourceMode: "interview_evidence",
    headline: "h",
    executiveBrief: "b",
    scope: [],
    consensus: [],
    variations: [],
    gaps: [{ id: findingId, title: "Gap", body: "b", evidenceLevel: "corroborated", supportCount: 1, sources: [] }],
    notable: [],
    coverage: { includedSources: 1, totalEligibleSources: 1, complete: true },
    provenance: { sourceSnapshotHash: "x", generatedAt: 1, promptVersion: SUMMARY_V2_PROMPT_VERSIONS.processOverview, provider: "p", model: "m" },
  };
}

async function member(ctx: MutationCtx, name: string) {
  const tokenIdentifier = `${ISSUER}|${name}`;
  const userId = await ctx.db.insert("users", { tokenIdentifier, name, email: `${name}@example.test`, profileComplete: true });
  await ctx.db.insert("memberships", { tokenIdentifier, userId, clerkOrgId: ORG, role: "viewer", createdAt: 0 });
  return { tokenIdentifier, userId };
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ana = await member(ctx, "ana");
    const olga = await member(ctx, "olga");
    const functionId = await ctx.db.insert("functions", { name: "Ops", sortOrder: 0, clerkOrgId: ORG });
    const departmentId = await ctx.db.insert("departments", { functionId, name: "Dispatch", sortOrder: 0, clerkOrgId: ORG });
    const processId = await ctx.db.insert("processes", { departmentId, name: "Scheduling", sortOrder: 0, clerkOrgId: ORG, summaryV2: artifact("gap-1") });
    const conversationId = await ctx.db.insert("conversations", { processId, contributorName: "Ana", status: "done", clerkOrgId: ORG, title: "t", summary: "s" });
    return { ana, olga, functionId, departmentId, processId, conversationId };
  });
  const as = (tokenIdentifier: string) =>
    t.withIdentity({ tokenIdentifier, subject: tokenIdentifier, issuer: ISSUER, orgId: ORG, orgSlug: ORG });
  return { t, ids, ana: as(ids.ana.tokenIdentifier), olga: as(ids.olga.tokenIdentifier) };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function thread(s: Setup, title: string, lastMessageAt = 1) {
  return await s.t.run((ctx) =>
    ctx.db.insert("askThreads", { clerkOrgId: ORG, userId: s.ids.ana.userId, title, status: "active", lastMessageAt }),
  );
}

beforeEach(() => {
  process.env.SUMMARY_V2 = ORG;
});

afterEach(() => {
  vi.useRealTimers();
  if (saved === undefined) delete process.env.SUMMARY_V2;
  else process.env.SUMMARY_V2 = saved;
});

describe("thread management (FR-3)", () => {
  test("lists the owner's threads newest first, pinned separately, and nobody else's", async () => {
    const s = await setup();
    const older = await thread(s, "Older", 1);
    const newer = await thread(s, "Newer", 2);
    await s.ana.mutation(api.askThreads.setPinned, { threadId: older, pinned: true });

    const page = await s.ana.query(api.askThreads.listThreads, { archived: false, paginationOpts: { numItems: 25, cursor: null } });
    expect(page.page.map((t) => t._id)).toEqual([newer]);
    expect((await s.ana.query(api.askThreads.listPinned, {})).map((t) => t._id)).toEqual([older]);
    expect((await s.olga.query(api.askThreads.listThreads, { archived: false, paginationOpts: { numItems: 25, cursor: null } })).page).toEqual([]);
    await expect(s.olga.mutation(api.askThreads.renameThread, { threadId: newer, title: "Mine now" })).rejects.toThrow();
  });

  test("allows 10 pins and refuses an 11th", async () => {
    const s = await setup();
    const threads: Id<"askThreads">[] = [];
    for (let i = 0; i < 11; i++) threads.push(await thread(s, `T${i}`));
    for (const id of threads.slice(0, 10)) await s.ana.mutation(api.askThreads.setPinned, { threadId: id, pinned: true });
    const error = await s.ana.mutation(api.askThreads.setPinned, { threadId: threads[10], pinned: true }).catch((e) => e);
    expect(userErrorMessageOf(error)).toBe("Unpin a thread first.");
  });

  test("archiving unpins and moves the thread to the archived list", async () => {
    const s = await setup();
    const id = await thread(s, "Archive me");
    await s.ana.mutation(api.askThreads.setPinned, { threadId: id, pinned: true });
    await s.ana.mutation(api.askThreads.setArchived, { threadId: id, archived: true });
    expect(await s.ana.query(api.askThreads.listPinned, {})).toEqual([]);
    const archived = await s.ana.query(api.askThreads.listThreads, { archived: true, paginationOpts: { numItems: 25, cursor: null } });
    expect(archived.page.map((t) => [t._id, t.pinnedAt])).toEqual([[id, null]]);
  });

  test("renames and finds threads by title", async () => {
    const s = await setup();
    const id = await thread(s, "Untitled");
    await s.ana.mutation(api.askThreads.renameThread, { threadId: id, title: "  Dispatch   bottlenecks " });
    const hits = await s.ana.query(api.askThreads.searchThreads, { query: "bottlenecks" });
    expect(hits.map((t) => t.title)).toEqual(["Dispatch bottlenecks"]);
    expect(await s.olga.query(api.askThreads.searchThreads, { query: "bottlenecks" })).toEqual([]);
  });

  test("delete hides the thread at once, stops a streaming answer, then removes every row", async () => {
    const s = await setup();
    const id = await thread(s, "Delete me");
    const messageId = await s.t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("askMessages", { threadId: id, clerkOrgId: ORG, userId: s.ids.ana.userId, role: "user", parts: [{ type: "text", text: "q" }] });
      }
      const assistant = await ctx.db.insert("askMessages", { threadId: id, clerkOrgId: ORG, userId: s.ids.ana.userId, role: "assistant", parts: [], status: "streaming" });
      await ctx.db.insert("askCitations", { messageId: assistant, threadId: id, clerkOrgId: ORG, userId: s.ids.ana.userId, ordinal: 1, source: "fabric:entity/org", sourceKind: "org", sourceEntityId: "org", title: "t", citedText: "c" });
      await ctx.db.insert("askFeedback", { messageId: assistant, threadId: id, clerkOrgId: ORG, userId: s.ids.ana.userId, rating: "down" });
      return assistant;
    });

    vi.useFakeTimers({ toFake: ["setTimeout"] });
    await s.ana.mutation(api.askThreads.deleteThread, { threadId: id });
    expect(await s.ana.query(api.ask.getThread, { threadId: id })).toBeNull();
    expect(await s.t.run((ctx) => ctx.db.get("askMessages", messageId))).toMatchObject({ cancelRequested: true });

    for (let i = 0; i < 5; i++) await s.t.mutation(internal.askThreads.deleteThreadBatch, { threadId: id });
    const left = await s.t.run(async (ctx) => ({
      thread: await ctx.db.get("askThreads", id),
      messages: await ctx.db.query("askMessages").collect(),
      citations: await ctx.db.query("askCitations").collect(),
      feedback: await ctx.db.query("askFeedback").collect(),
    }));
    expect(left).toEqual({ thread: null, messages: [], citations: [], feedback: [] });
  });
});

describe("citation re-authorization (FR-5.5)", () => {
  async function citeAll(s: Setup) {
    const id = await thread(s, "Cited");
    await s.t.run(async (ctx) => {
      const messageId = await ctx.db.insert("askMessages", { threadId: id, clerkOrgId: ORG, userId: s.ids.ana.userId, role: "assistant", parts: [{ type: "text", text: "a" }], status: "complete" });
      const cite = (ordinal: number, source: string, sourceKind: "process" | "conversation", sourceEntityId: string) =>
        ctx.db.insert("askCitations", { messageId, threadId: id, clerkOrgId: ORG, userId: s.ids.ana.userId, ordinal, source, sourceKind, sourceEntityId, title: `Source ${ordinal}`, citedText: "quoted" });
      await cite(1, `fabric:finding/process/${s.ids.processId}/gap-1`, "process", s.ids.processId);
      await cite(2, `fabric:finding/process/${s.ids.processId}/gap-gone`, "process", s.ids.processId);
      await cite(3, `fabric:conversation/${s.ids.processId}/${s.ids.conversationId}?t=10&line=2`, "conversation", s.ids.conversationId);
    });
    return id;
  }

  test("reports each citation's state and the path its link needs", async () => {
    const s = await setup();
    const id = await citeAll(s);
    const citations = (await s.ana.query(api.ask.getThread, { threadId: id }))!.messages[0].citations;
    const path = { fn: s.ids.functionId, dept: s.ids.departmentId, proc: s.ids.processId };
    expect(citations.map((c) => [c.ordinal, c.availability, c.path])).toEqual([
      [1, "available", path],
      [2, "updated", path],
      [3, "available", path],
    ]);
  });

  test("a deleted source reads as no longer available, with its text withheld", async () => {
    const s = await setup();
    const id = await citeAll(s);
    await s.t.run((ctx) => ctx.db.delete("conversations", s.ids.conversationId));
    const third = (await s.ana.query(api.ask.getThread, { threadId: id }))!.messages[0].citations[2];
    expect(third).toMatchObject({ availability: "unavailable", title: "Source no longer available", citedText: null });
  });

  test("with SUMMARY_V2 off, a cited finding reads as updated", async () => {
    process.env.SUMMARY_V2 = "false";
    const s = await setup();
    const id = await citeAll(s);
    const first = (await s.ana.query(api.ask.getThread, { threadId: id }))!.messages[0].citations[0];
    expect(first.availability).toBe("updated");
  });
});

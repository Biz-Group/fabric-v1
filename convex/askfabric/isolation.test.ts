/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { userErrorMessageOf } from "../lib/userError";
import * as askModule from "../ask";
import * as askFeedbackModule from "../askFeedback";
import * as askSharedModule from "../askShared";
import * as askSuggestionsModule from "../askSuggestions";
import * as askThreadsModule from "../askThreads";
import * as askUsageModule from "../askUsage";
import * as askSpeechModule from "../askSpeech";
import { ASK_TOOLS } from "../askTools/catalog";

/**
 * 1G.1: tenant isolation (FR-9.1) and thread privacy (FR-9.2) across every
 * public AskFabric function. The tools have their own cross-org and role
 * suites in `askTools/tools.test.ts` (FR-1.4, FR-9.3).
 *
 * Each org's content carries a marker (ANA-SECRET, BOB-SECRET), so a leak
 * shows up as the marker in a response, and a refused write as a changed row.
 */

const modules = import.meta.glob("/convex/**/*.ts");
const ORG_A = "org_ask_isolation_a";
const ORG_B = "org_ask_isolation_b";
const ISSUER = "https://ask-isolation.test";
const ENV = {
  ASKFABRIC: `${ORG_A},${ORG_B}`,
  ASKFABRIC_FOUNDRY_DEPLOYMENT: "askfabric-claude-sonnet-5-5",
  ASKFABRIC_MODEL: "claude-sonnet-5-5",
  FOUNDRY_ENDPOINT: "https://example.services.ai.azure.com",
  FOUNDRY_API_KEY: "k",
  FOUNDRY_CLAUDE_DEPLOYMENT: "fabric-claude-haiku-5-5",
  SUMMARY_V2: `${ORG_A},${ORG_B}`,
};
const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

type Role = "viewer" | "contributor" | "admin";
const NO_LINK = { fn: null, dept: null, proc: null };

async function person(ctx: MutationCtx, name: string, orgId: string, role: Role, superAdmin = false) {
  const tokenIdentifier = `${ISSUER}|${name}`;
  const userId = await ctx.db.insert("users", {
    tokenIdentifier,
    name,
    email: `${name}@example.test`,
    profileComplete: true,
    ...(superAdmin ? { platformRole: "superAdmin" as const } : {}),
  });
  const membershipId = await ctx.db.insert("memberships", { tokenIdentifier, userId, clerkOrgId: orgId, role, createdAt: 0 });
  return { tokenIdentifier, userId, membershipId, orgId };
}

async function hierarchy(ctx: MutationCtx, orgId: string, marker: string) {
  const functionId = await ctx.db.insert("functions", { name: `Ops ${marker}`, sortOrder: 0, clerkOrgId: orgId });
  const departmentId = await ctx.db.insert("departments", { functionId, name: `Dispatch ${marker}`, sortOrder: 0, clerkOrgId: orgId });
  const processId = await ctx.db.insert("processes", { departmentId, name: `Scheduling ${marker}`, sortOrder: 0, clerkOrgId: orgId });
  const conversationId = await ctx.db.insert("conversations", {
    processId,
    contributorName: "Contributor",
    status: "done",
    clerkOrgId: orgId,
    title: `Walkthrough ${marker}`,
    summary: "s",
  });
  return { functionId, departmentId, processId, conversationId };
}

/** One member's AskFabric content: a rated, shared, cited answer and a prompt set. */
async function askContent(ctx: MutationCtx, orgId: string, userId: Id<"users">, marker: string, citedSource: string) {
  const threadId = await ctx.db.insert("askThreads", {
    clerkOrgId: orgId,
    userId,
    title: `${marker} thread`,
    status: "active",
    lastMessageAt: 1,
    pinnedAt: 1,
  });
  await ctx.db.insert("askMessages", { threadId, clerkOrgId: orgId, userId, role: "user", parts: [{ type: "text", text: `${marker} question` }] });
  const messageId = await ctx.db.insert("askMessages", {
    threadId,
    clerkOrgId: orgId,
    userId,
    role: "assistant",
    parts: [{ type: "text", text: `${marker} answer[[cite:1]]` }],
    status: "complete",
  });
  const parsed = citedSource.replace(/^fabric:/, "").split("/");
  await ctx.db.insert("askCitations", {
    messageId,
    threadId,
    clerkOrgId: orgId,
    userId,
    ordinal: 1,
    source: citedSource,
    sourceKind: parsed[0] === "conversation" ? "conversation" : (parsed[1] as "process"),
    sourceEntityId: parsed[parsed.length - 1],
    title: `${marker} source`,
    citedText: `${marker} quote`,
  });
  await ctx.db.insert("askFeedback", { messageId, threadId, clerkOrgId: orgId, userId, rating: "down" });
  await ctx.db.insert("askSharedExchanges", {
    clerkOrgId: orgId,
    userId,
    threadId,
    messageId,
    question: `${marker} question`,
    answer: `${marker} answer`,
    reasoning: [],
    citations: [{ source: citedSource, title: `${marker} source`, citedText: `${marker} quote` }],
    toolCalls: [],
    sharedAt: 1,
    expiresAt: Date.now() + 1e9,
  });
  await ctx.db.insert("askSuggestions", {
    clerkOrgId: orgId,
    userId,
    prompts: [{ text: `${marker} prompt`, category: "orgWide" }],
    signals: [],
    generatedAt: Date.now(),
    lastVisitedAt: Date.now(),
  });
  // The org default set, read by members without their own.
  await ctx.db.insert("askSuggestions", {
    clerkOrgId: orgId,
    prompts: [{ text: `${marker} default prompt`, category: "orgWide" }],
    signals: [],
    generatedAt: Date.now(),
  });
  return { threadId, messageId };
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const a = await hierarchy(ctx, ORG_A, "A");
    const b = await hierarchy(ctx, ORG_B, "B");
    const ana = await person(ctx, "ana", ORG_A, "viewer");
    const mia = await person(ctx, "mia", ORG_A, "contributor");
    const olga = await person(ctx, "olga", ORG_A, "admin");
    // Super admins auto-provision as admins in each org they open.
    const root = await person(ctx, "root", ORG_A, "admin", true);
    const bob = await person(ctx, "bob", ORG_B, "viewer");
    const bea = await person(ctx, "bea", ORG_B, "admin");
    const anaContent = await askContent(ctx, ORG_A, ana.userId, "ANA-SECRET", `fabric:conversation/${a.processId}/${a.conversationId}`);
    const bobContent = await askContent(ctx, ORG_B, bob.userId, "BOB-SECRET", `fabric:conversation/${b.processId}/${b.conversationId}`);
    return { a, b, ana, mia, olga, root, bob, bea, anaContent, bobContent };
  });
  const as = (p: { tokenIdentifier: string; orgId: string }) =>
    t.withIdentity({ tokenIdentifier: p.tokenIdentifier, subject: p.tokenIdentifier, issuer: ISSUER, orgId: p.orgId, orgSlug: p.orgId });
  return { t, ids, as };
}

type Setup = Awaited<ReturnType<typeof setup>>;
type Caller = ReturnType<Setup["as"]>;

/** Every AskFabric row, to show a refused call changed nothing. */
async function snapshot(s: Setup) {
  return await s.t.run(async (ctx) => ({
    threads: await ctx.db.query("askThreads").collect(),
    messages: await ctx.db.query("askMessages").collect(),
    citations: await ctx.db.query("askCitations").collect(),
    feedback: await ctx.db.query("askFeedback").collect(),
    shared: await ctx.db.query("askSharedExchanges").collect(),
    suggestions: await ctx.db.query("askSuggestions").collect(),
    speech: await ctx.db.query("askSpeech").collect(),
  }));
}

/**
 * Every call that targets one member's thread or answer by id. Each must be
 * refused for anyone but the owner, and leave every row as it was.
 */
function targetedWrites(target: { threadId: Id<"askThreads">; messageId: Id<"askMessages"> }) {
  return {
    sendMessage: (c: Caller) => c.mutation(api.ask.sendMessage, { threadId: target.threadId, text: "Follow-up" }),
    stopTurn: (c: Caller) => c.mutation(api.ask.stopTurn, { messageId: target.messageId }),
    requestFollowUps: (c: Caller) => c.mutation(api.ask.requestFollowUps, { messageId: target.messageId }),
    renameThread: (c: Caller) => c.mutation(api.askThreads.renameThread, { threadId: target.threadId, title: "Renamed" }),
    setPinned: (c: Caller) => c.mutation(api.askThreads.setPinned, { threadId: target.threadId, pinned: false }),
    setArchived: (c: Caller) => c.mutation(api.askThreads.setArchived, { threadId: target.threadId, archived: true }),
    deleteThread: (c: Caller) => c.mutation(api.askThreads.deleteThread, { threadId: target.threadId }),
    setFeedback: (c: Caller) => c.mutation(api.askFeedback.setFeedback, { messageId: target.messageId, rating: "up" }),
    shareExchange: (c: Caller) => c.mutation(api.askFeedback.shareExchange, { messageId: target.messageId, note: "n" }),
    unshareExchange: (c: Caller) => c.mutation(api.askFeedback.unshareExchange, { messageId: target.messageId }),
    readAloud: (c: Caller) => c.action(api.askSpeech.readAloud, { messageId: target.messageId }),
  };
}

/** Every read a member or admin can make in their own org. */
async function orgReads(c: Caller, s: Setup, admin: boolean) {
  const page = { paginationOpts: { numItems: 50, cursor: null } };
  return {
    getAvailability: await c.query(api.ask.getAvailability, {}),
    getDailyAllowance: await c.query(api.ask.getDailyAllowance, {}),
    listThreads: await c.query(api.askThreads.listThreads, { ...page, archived: false }),
    listArchived: await c.query(api.askThreads.listThreads, { ...page, archived: true }),
    listPinned: await c.query(api.askThreads.listPinned, {}),
    searchThreads: await c.query(api.askThreads.searchThreads, { query: "thread" }),
    getSuggestions: await c.query(api.askSuggestions.getSuggestions, {}),
    getStarterContext: await c.query(api.askSuggestions.getStarterContext, {}),
    getAnaThread: await c.query(api.ask.getThread, { threadId: s.ids.anaContent.threadId }),
    getBobThread: await c.query(api.ask.getThread, { threadId: s.ids.bobContent.threadId }),
    ...(admin
      ? {
          getOrgUsage: await c.query(api.askUsage.getOrgUsage, {}),
          listFeedback: await c.query(api.askUsage.listFeedback, page),
        }
      : {}),
  };
}

beforeEach(() => {
  Object.assign(process.env, ENV);
  // Keeps scheduled turns and rebuilds from firing mid-test.
  vi.useFakeTimers({ toFake: ["setTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  for (const [k, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[k];
    else process.env[k] = value;
  }
});

describe("tenant isolation: an org-A caller against org-B data (FR-9.1)", () => {
  test("every targeted write on an org-B thread or answer is refused and changes nothing", async () => {
    const s = await setup();
    const before = await snapshot(s);
    for (const caller of [s.ids.ana, s.ids.olga, s.ids.root]) {
      for (const [name, call] of Object.entries(targetedWrites(s.ids.bobContent))) {
        const error = await call(s.as(caller)).then(
          () => null,
          (e: unknown) => e,
        );
        expect(error, `${name} as ${caller.tokenIdentifier}`).not.toBeNull();
        // The refusal reads as "not found", never as "not yours".
        expect(userErrorMessageOf(error) ?? "", name).not.toMatch(/permission|another|owner/i);
      }
    }
    expect(await snapshot(s)).toEqual(before);
  });

  test("no org-A read returns org-B content, for members and admins", async () => {
    const s = await setup();
    for (const [caller, admin] of [
      [s.ids.ana, false],
      [s.ids.mia, false],
      [s.ids.olga, true],
      [s.ids.root, true],
    ] as const) {
      const reads = await orgReads(s.as(caller), s, admin);
      expect(reads.getBobThread, caller.tokenIdentifier).toBeNull();
      expect(JSON.stringify(reads), caller.tokenIdentifier).not.toMatch(/BOB-SECRET|user_bob|"bob"|"bea"/);
      if (admin) {
        expect(reads.listFeedback?.page.map((row) => row.member)).toEqual(["ana"]);
        expect(reads.getOrgUsage?.members.map((m) => m.name)).toEqual(["ana"]);
      }
    }
  });

  test("an org-B member's activity never counts against org A's limits", async () => {
    process.env.ASKFABRIC_DAILY_ORG_LIMIT = "1";
    try {
      const s = await setup();
      // Org A already has one answer today (ana's); org B adds more.
      await s.t.run(async (ctx) => {
        for (let i = 0; i < 3; i++) {
          await ctx.db.insert("askMessages", {
            threadId: s.ids.bobContent.threadId,
            clerkOrgId: ORG_B,
            userId: s.ids.bob.userId,
            role: "assistant",
            parts: [],
            status: "complete",
          });
        }
      });
      expect(await s.as(s.ids.bob).query(api.ask.getDailyAllowance, {})).toMatchObject({ orgLimitReached: true });
      // Ana's own answer reaches A's limit of 1; B's three don't add to it.
      process.env.ASKFABRIC_DAILY_ORG_LIMIT = "2";
      expect(await s.as(s.ids.mia).query(api.ask.getDailyAllowance, {})).toMatchObject({ orgLimitReached: false, remaining: 10 });
    } finally {
      delete process.env.ASKFABRIC_DAILY_ORG_LIMIT;
    }
  });

  test("an org-B entity in contextRef or mentions is dropped before it is stored", async () => {
    const s = await setup();
    const { threadId } = await s.as(s.ids.mia).mutation(api.ask.sendMessage, {
      text: "Tell me about this",
      contextRef: { kind: "process", id: s.ids.b.processId },
      mentions: [
        { kind: "process", id: s.ids.b.processId },
        { kind: "department", id: s.ids.b.departmentId },
        { kind: "function", id: s.ids.b.functionId },
      ],
    });
    const rows = await s.t.run(async (ctx) => ({
      thread: await ctx.db.get("askThreads", threadId),
      question: (await ctx.db.query("askMessages").withIndex("by_threadId", (q) => q.eq("threadId", threadId)).collect())[0],
    }));
    expect(rows.thread?.contextRef).toBeUndefined();
    expect(rows.question.contextRef).toBeUndefined();
    expect(rows.question.mentions).toBeUndefined();
  });

  test("a citation to an org-B source reads as unavailable, with its text withheld (FR-5.5)", async () => {
    const s = await setup();
    // A forged row in ana's thread pointing at org B's contribution and process.
    await s.t.run(async (ctx) => {
      const { threadId, messageId } = s.ids.anaContent;
      await ctx.db.insert("askCitations", {
        messageId,
        threadId,
        clerkOrgId: ORG_A,
        userId: s.ids.ana.userId,
        ordinal: 2,
        source: `fabric:conversation/${s.ids.b.processId}/${s.ids.b.conversationId}`,
        sourceKind: "conversation",
        sourceEntityId: s.ids.b.conversationId,
        title: "BOB-SECRET walkthrough",
        citedText: "BOB-SECRET quote",
      });
      await ctx.db.insert("askCitations", {
        messageId,
        threadId,
        clerkOrgId: ORG_A,
        userId: s.ids.ana.userId,
        ordinal: 3,
        source: `fabric:entity/process/${s.ids.b.processId}`,
        sourceKind: "process",
        sourceEntityId: s.ids.b.processId,
        title: "BOB-SECRET process",
        citedText: "BOB-SECRET process text",
      });
    });
    const thread = await s.as(s.ids.ana).query(api.ask.getThread, { threadId: s.ids.anaContent.threadId });
    const citations = thread!.messages.flatMap((m) => m.citations);
    expect(citations.map((c) => [c.ordinal, c.availability])).toEqual([
      [1, "available"],
      [2, "unavailable"],
      [3, "unavailable"],
    ]);
    expect(JSON.stringify(citations)).not.toContain("BOB-SECRET");
    // No link into org B either: the path resolves against the caller's org.
    expect(citations.filter((c) => c.ordinal > 1).map((c) => c.path)).toEqual([NO_LINK, NO_LINK]);
  });
});

describe("thread privacy inside one org (FR-9.2)", () => {
  test("another member, an org admin and a super admin all get not-found for a member's thread", async () => {
    const s = await setup();
    const before = await snapshot(s);
    for (const caller of [s.ids.mia, s.ids.olga, s.ids.root]) {
      expect(await s.as(caller).query(api.ask.getThread, { threadId: s.ids.anaContent.threadId }), caller.tokenIdentifier).toBeNull();
      for (const [name, call] of Object.entries(targetedWrites(s.ids.anaContent))) {
        await expect(call(s.as(caller)), `${name} as ${caller.tokenIdentifier}`).rejects.toThrow();
      }
      const reads = await orgReads(s.as(caller), s, caller !== s.ids.mia);
      expect(JSON.stringify(reads), caller.tokenIdentifier).not.toMatch(/ANA-SECRET (thread|question|answer|quote|prompt)/);
    }
    expect(await snapshot(s)).toEqual(before);
  });

  test("the owner reads their own thread in full", async () => {
    const s = await setup();
    const reads = await orgReads(s.as(s.ids.ana), s, false);
    expect(reads.getAnaThread?.messages).toHaveLength(2);
    expect(reads.listPinned.map((row) => row.title)).toEqual(["ANA-SECRET thread"]);
    expect(reads.searchThreads.map((row) => row.title)).toEqual(["ANA-SECRET thread"]);
    expect(reads.getSuggestions.map((p) => p.text)).toEqual(["ANA-SECRET prompt"]);
  });

  test("only super admins can list or open shared exchanges, and each opening is audited", async () => {
    const s = await setup();
    const exchanges = await s.t.run((ctx) => ctx.db.query("askSharedExchanges").collect());
    const anaExchange = exchanges.find((e) => e.clerkOrgId === ORG_A)!._id;
    for (const caller of [s.ids.ana, s.ids.mia, s.ids.olga, s.ids.bea]) {
      await expect(s.as(caller).query(api.askShared.listSharedExchanges, {}), caller.tokenIdentifier).rejects.toThrow();
      await expect(s.as(caller).mutation(api.askShared.viewSharedExchange, { exchangeId: anaExchange })).rejects.toThrow();
    }
    const root = s.t.withIdentity({ tokenIdentifier: s.ids.root.tokenIdentifier, subject: "root", issuer: ISSUER });
    expect(await root.query(api.askShared.listSharedExchanges, {})).toHaveLength(2);
    expect((await root.mutation(api.askShared.viewSharedExchange, { exchangeId: anaExchange }))?.question).toBe("ANA-SECRET question");
    const audit = await s.t.run((ctx) => ctx.db.query("authAuditEvents").collect());
    expect(audit.filter((a) => a.action === "sharedExchangeViewed")).toHaveLength(1);
  });

  test("the org admin's AskFabric page carries no thread content", async () => {
    const s = await setup();
    const olga = s.as(s.ids.olga);
    const usage = await olga.query(api.askUsage.getOrgUsage, {});
    const feedback = await olga.query(api.askUsage.listFeedback, { paginationOpts: { numItems: 25, cursor: null } });
    expect(JSON.stringify({ usage, feedback })).not.toContain("SECRET");
    for (const caller of [s.ids.ana, s.ids.mia]) {
      await expect(s.as(caller).query(api.askUsage.getOrgUsage, {})).rejects.toThrow();
      await expect(s.as(caller).query(api.askUsage.listFeedback, { paginationOpts: { numItems: 25, cursor: null } })).rejects.toThrow();
    }
  });
});

describe("citation re-authorization on every read (FR-5.5)", () => {
  test("a members citation is shown to admins only, and hides when the admin is demoted", async () => {
    const s = await setup();
    const threadId = await s.t.run(async (ctx) => {
      const id = await ctx.db.insert("askThreads", { clerkOrgId: ORG_A, userId: s.ids.olga.userId, title: "Who contributed", status: "active", lastMessageAt: 2 });
      const messageId = await ctx.db.insert("askMessages", {
        threadId: id,
        clerkOrgId: ORG_A,
        userId: s.ids.olga.userId,
        role: "assistant",
        parts: [{ type: "text", text: "Three people[[cite:1]]" }],
        status: "complete",
      });
      await ctx.db.insert("askCitations", {
        messageId,
        threadId: id,
        clerkOrgId: ORG_A,
        userId: s.ids.olga.userId,
        ordinal: 1,
        source: `fabric:members/process/${s.ids.a.processId}`,
        sourceKind: "process",
        sourceEntityId: s.ids.a.processId,
        title: "Contributors",
        citedText: "Three contributors",
      });
      return id;
    });
    const read = async () => (await s.as(s.ids.olga).query(api.ask.getThread, { threadId }))!.messages[0].citations[0];
    expect((await read()).availability).toBe("available");
    await s.t.run((ctx) => ctx.db.patch("memberships", s.ids.olga.membershipId, { role: "viewer" }));
    expect(await read()).toMatchObject({ availability: "unavailable", citedText: null });
  });

  test("a removed member reads nothing, even their own thread", async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.patch("memberships", s.ids.ana.membershipId, { removedAt: 1 }));
    await expect(s.as(s.ids.ana).query(api.ask.getThread, { threadId: s.ids.anaContent.threadId })).rejects.toThrow();
    await expect(s.as(s.ids.ana).mutation(api.ask.sendMessage, { text: "Still here?" })).rejects.toThrow();
  });
});

describe("coverage", () => {
  test("every public AskFabric function is exercised by this suite", () => {
    const covered = new Set([
      "ask.getAvailability",
      "ask.getDailyAllowance",
      "ask.sendMessage",
      "ask.stopTurn",
      "ask.requestFollowUps",
      "ask.getThread",
      "askThreads.listThreads",
      "askThreads.listPinned",
      "askThreads.searchThreads",
      "askThreads.renameThread",
      "askThreads.setPinned",
      "askThreads.setArchived",
      "askThreads.deleteThread",
      "askFeedback.setFeedback",
      "askFeedback.shareExchange",
      "askFeedback.unshareExchange",
      "askShared.listSharedExchanges",
      "askShared.viewSharedExchange",
      "askSuggestions.getSuggestions",
      "askSuggestions.getStarterContext",
      "askSuggestions.markVisited",
      "askUsage.getOrgUsage",
      "askUsage.listFeedback",
      "askSpeech.readAloud",
    ]);
    const modulesByName = {
      ask: askModule,
      askThreads: askThreadsModule,
      askFeedback: askFeedbackModule,
      askShared: askSharedModule,
      askSuggestions: askSuggestionsModule,
      askUsage: askUsageModule,
      askSpeech: askSpeechModule,
    };
    const publicFunctions = Object.entries(modulesByName).flatMap(([moduleName, exports]) =>
      Object.entries(exports)
        .filter(([, value]) => (value as { isPublic?: boolean }).isPublic === true)
        .map(([name]) => `${moduleName}.${name}`),
    );
    expect(publicFunctions.filter((name) => !covered.has(name))).toEqual([]);
  });

  test("only T13 is admin-only; every other tool is covered by tools.test.ts's same-for-every-role check (FR-9.3)", () => {
    // getParticipation has its own role test in tools.test.ts: non-admins get
    // { found: false }. A new admin-only tool needs one too, then joins this list.
    expect(ASK_TOOLS.filter((tool) => tool.access !== "member").map((tool) => tool.name)).toEqual(["getParticipation"]);
  });

  test("markVisited only touches the caller's own row in their own org", async () => {
    const s = await setup();
    const before = await snapshot(s);
    await s.as(s.ids.ana).mutation(api.askSuggestions.markVisited, {});
    const after = await snapshot(s);
    const changed = after.suggestions.filter(
      (row) => JSON.stringify(row) !== JSON.stringify(before.suggestions.find((b) => b._id === row._id)),
    );
    expect(changed.map((row) => [row.clerkOrgId, row.userId])).toEqual([[ORG_A, s.ids.ana.userId]]);
    expect({ ...after, suggestions: [] }).toEqual({ ...before, suggestions: [] });
  });
});

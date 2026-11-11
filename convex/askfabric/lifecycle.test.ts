/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { userErrorMessageOf } from "../lib/userError";
import { buildEntitySuggestions, buildSuggestions, topicForStoredPrompt } from "./suggestions";

const modules = import.meta.glob("/convex/**/*.ts");
const ORG = "org_ask_lifecycle";
const OTHER_ORG = "org_ask_lifecycle_other";
const ISSUER = "https://ask-lifecycle.test";
const ENV = {
  ASKFABRIC: `${ORG},${OTHER_ORG}`,
  ASKFABRIC_FOUNDRY_DEPLOYMENT: "askfabric-claude-sonnet-5-5",
  ASKFABRIC_MODEL: "claude-sonnet-5-5",
  FOUNDRY_ENDPOINT: "https://example.services.ai.azure.com",
  FOUNDRY_API_KEY: "k",
  FOUNDRY_CLAUDE_DEPLOYMENT: "fabric-claude-haiku-5-5",
  CLERK_JWT_ISSUER_DOMAIN: ISSUER,
};
const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

async function member(ctx: MutationCtx, clerkUserId: string, orgId: string, role: "viewer" | "admin" = "viewer") {
  const tokenIdentifier = `${ISSUER}|${clerkUserId}`;
  const existing = await ctx.db.query("users").withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", tokenIdentifier)).unique();
  const userId = existing?._id ?? (await ctx.db.insert("users", { tokenIdentifier, name: clerkUserId, email: `${clerkUserId}@example.test`, profileComplete: true }));
  const membershipId = await ctx.db.insert("memberships", { tokenIdentifier, userId, clerkOrgId: orgId, role, createdAt: 0, clerkUserId });
  return { tokenIdentifier, userId, membershipId };
}

/** A thread with a message, a citation, feedback, a shared exchange and a suggestion set. */
async function askData(ctx: MutationCtx, orgId: string, userId: Id<"users">, conversationId?: Id<"conversations">) {
  const threadId = await ctx.db.insert("askThreads", { clerkOrgId: orgId, userId, title: "t", status: "active", lastMessageAt: 1 });
  const messageId = await ctx.db.insert("askMessages", { threadId, clerkOrgId: orgId, userId, role: "assistant", parts: [{ type: "text", text: "a[[cite:1]]" }], status: "streaming" });
  const source = conversationId ? `fabric:conversation/p/${conversationId}` : "fabric:entity/org";
  await ctx.db.insert("askCitations", {
    messageId, threadId, clerkOrgId: orgId, userId, ordinal: 1, source,
    sourceKind: conversationId ? "conversation" : "org", sourceEntityId: conversationId ?? "org", title: "Source", citedText: "quoted words",
  });
  await ctx.db.insert("askFeedback", { messageId, threadId, clerkOrgId: orgId, userId, rating: "down" });
  await ctx.db.insert("askSharedExchanges", {
    clerkOrgId: orgId, userId, threadId, messageId, question: "q", answer: "a", reasoning: [],
    citations: [{ source, title: "Source", citedText: "quoted words" }], toolCalls: [], sharedAt: 1, expiresAt: Date.now() + 1e9,
  });
  await ctx.db.insert("askSuggestions", { clerkOrgId: orgId, userId, prompts: [], signals: [], generatedAt: 0, lastVisitedAt: Date.now() });
  return { threadId, messageId };
}

async function contentRows(t: ReturnType<typeof convexTest>, orgId: string, userId: Id<"users">) {
  return await t.run(async (ctx) => {
    const mine = <T extends { clerkOrgId: string; userId?: Id<"users"> }>(rows: T[]) =>
      rows.filter((r) => r.clerkOrgId === orgId && r.userId === userId).length;
    return {
      threads: mine(await ctx.db.query("askThreads").collect()),
      messages: mine(await ctx.db.query("askMessages").collect()),
      citations: mine(await ctx.db.query("askCitations").collect()),
      feedback: mine(await ctx.db.query("askFeedback").collect()),
      shared: mine(await ctx.db.query("askSharedExchanges").collect()),
      suggestions: mine(await ctx.db.query("askSuggestions").collect()),
    };
  });
}

const NONE = { threads: 0, messages: 0, citations: 0, feedback: 0, shared: 0, suggestions: 0 };

/** Runs scheduled work to completion (the purge and thread deletes reschedule themselves). */
async function drain(t: ReturnType<typeof convexTest>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

beforeEach(() => {
  Object.assign(process.env, ENV);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  for (const [k, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[k];
    else process.env[k] = value;
  }
});

describe("member removal deletes their AskFabric content (FR-3.6)", () => {
  test("through the admin removal path, keeping usage rows and other orgs' data", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const admin = await member(ctx, "user_admin", ORG, "admin");
      const ana = await member(ctx, "user_ana", ORG);
      await member(ctx, "user_ana", OTHER_ORG);
      const here = await askData(ctx, ORG, ana.userId);
      await askData(ctx, OTHER_ORG, ana.userId);
      await ctx.db.insert("aiUsageEvents", {
        deployment: "dev", idempotencyKey: "k1", createdAt: 1, clerkOrgId: ORG, unit: "tokens", operation: "askfabric.turn",
        provider: "foundry-claude", model: "m", status: "ok", costMicroUsd: 10, priceVersion: "v", costSource: "computed", actorUserId: ana.userId,
      });
      return { admin, ana, here };
    });

    await t.mutation(internal.users.completeMemberRemoval, {
      membershipId: ids.ana.membershipId,
      orgId: ORG,
      callerTokenIdentifier: ids.admin.tokenIdentifier,
    });
    // The streaming answer was told to stop in the same transaction.
    expect(await t.run((ctx) => ctx.db.get("askMessages", ids.here.messageId))).toMatchObject({ cancelRequested: true });
    await drain(t);

    expect(await contentRows(t, ORG, ids.ana.userId)).toEqual(NONE);
    expect((await contentRows(t, OTHER_ORG, ids.ana.userId)).threads).toBe(1);
    expect(await t.run((ctx) => ctx.db.query("aiUsageEvents").collect())).toHaveLength(1);
  });

  test.each([
    ["the Clerk membership webhook", "organizationMembership.deleted"],
    ["the Clerk user webhook", "user.deleted"],
  ])("through %s", async (_label, eventType) => {
    const t = convexTest(schema, modules);
    const ana = await t.run(async (ctx) => {
      const ana = await member(ctx, "user_ana", ORG);
      await askData(ctx, ORG, ana.userId);
      return ana;
    });
    await t.mutation(internal.users.handleClerkWebhook, {
      eventId: `evt_${eventType}`,
      eventType,
      data:
        eventType === "user.deleted"
          ? { id: "user_ana" }
          : { organization: { id: ORG }, public_user_data: { user_id: "user_ana" } },
    });
    await drain(t);
    expect(await contentRows(t, ORG, ana.userId)).toEqual(NONE);
  });

  test("org deletion removes everyone's AskFabric content in that org", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const ana = await member(ctx, "user_ana", ORG);
      const bo = await member(ctx, "user_bo", ORG);
      await askData(ctx, ORG, ana.userId);
      await askData(ctx, ORG, bo.userId);
      await askData(ctx, OTHER_ORG, bo.userId);
      return { ana, bo };
    });
    await t.mutation(internal.users.handleClerkWebhook, { eventId: "evt_org", eventType: "organization.deleted", data: { id: ORG } });
    await drain(t);
    expect(await contentRows(t, ORG, ids.ana.userId)).toEqual(NONE);
    expect(await contentRows(t, ORG, ids.bo.userId)).toEqual(NONE);
    expect((await contentRows(t, OTHER_ORG, ids.bo.userId)).threads).toBe(1);
  });
});

describe("source deletion clears cited text (FR-9.7)", () => {
  test("in citations and shared exchanges, and the thread shows the source as gone", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const admin = await member(ctx, "user_admin", ORG, "admin");
      const fn = await ctx.db.insert("functions", { name: "F", sortOrder: 0, clerkOrgId: ORG });
      const dept = await ctx.db.insert("departments", { functionId: fn, name: "D", sortOrder: 0, clerkOrgId: ORG });
      const processId = await ctx.db.insert("processes", { departmentId: dept, name: "P", sortOrder: 0, clerkOrgId: ORG });
      const conversationId = await ctx.db.insert("conversations", { processId, contributorName: "Ana", status: "done", clerkOrgId: ORG, title: "t", summary: "s" });
      const thread = await askData(ctx, ORG, admin.userId, conversationId);
      return { admin, conversationId, ...thread };
    });
    const asAdmin = t.withIdentity({ tokenIdentifier: ids.admin.tokenIdentifier, subject: "user_admin", issuer: ISSUER, orgId: ORG, orgSlug: ORG });
    await asAdmin.mutation(api.conversations.deleteForAdmin, { conversationId: ids.conversationId, reason: "Test cleanup" });
    await drain(t);

    const rows = await t.run(async (ctx) => ({
      citation: (await ctx.db.query("askCitations").collect())[0],
      shared: (await ctx.db.query("askSharedExchanges").collect())[0],
    }));
    expect(rows.citation.citedText).toBeUndefined();
    expect(rows.shared.citations[0].citedText).toBeUndefined();
    const cited = (await asAdmin.query(api.ask.getThread, { threadId: ids.threadId }))!.messages[0].citations[0];
    expect(cited).toMatchObject({ availability: "unavailable", title: "Source no longer available", citedText: null });
  });
});

describe("feedback and sharing (FR-7)", () => {
  async function answered() {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const ana = await member(ctx, "user_ana", ORG);
      const olga = await member(ctx, "user_olga", ORG);
      const threadId = await ctx.db.insert("askThreads", { clerkOrgId: ORG, userId: ana.userId, title: "t", status: "active", lastMessageAt: 1 });
      await ctx.db.insert("askMessages", { threadId, clerkOrgId: ORG, userId: ana.userId, role: "user", parts: [{ type: "text", text: "Why is dispatch slow?" }] });
      const messageId = await ctx.db.insert("askMessages", {
        threadId, clerkOrgId: ORG, userId: ana.userId, role: "assistant", status: "complete",
        parts: [
          { type: "reasoning", text: "Check the flow.", startedAt: 1, endedAt: 2 },
          { type: "tool", name: "getProcessFlow", status: "done", label: "Reading the process flow", startedAt: 2, endedAt: 3, resultCount: 9 },
          { type: "text", text: "Re-keying.[[cite:1]]" },
        ],
        toolTelemetry: [{ name: "getProcessFlow", latencyMs: 100, found: true, resultTokens: 900, truncated: false }],
      });
      await ctx.db.insert("askCitations", { messageId, threadId, clerkOrgId: ORG, userId: ana.userId, ordinal: 1, source: "fabric:entity/org", sourceKind: "org", sourceEntityId: "org", title: "Coverage", citedText: "9 of 14" });
      return { ana, olga, threadId, messageId };
    });
    const as = (who: { tokenIdentifier: string }) =>
      t.withIdentity({ tokenIdentifier: who.tokenIdentifier, subject: who.tokenIdentifier, issuer: ISSUER, orgId: ORG, orgSlug: ORG });
    return { t, ids, ana: as(ids.ana), olga: as(ids.olga) };
  }

  test("nothing is shared until the user shares; the snapshot holds no raw tool results", async () => {
    const { t, ids, ana } = await answered();
    await ana.mutation(api.askFeedback.setFeedback, { messageId: ids.messageId, rating: "down" });
    expect(await t.run((ctx) => ctx.db.query("askSharedExchanges").collect())).toEqual([]);

    await ana.mutation(api.askFeedback.shareExchange, { messageId: ids.messageId, note: "Missed procurement" });
    const shared = (await t.run((ctx) => ctx.db.query("askSharedExchanges").collect()))[0];
    expect(shared).toMatchObject({
      question: "Why is dispatch slow?",
      answer: "Re-keying.[[cite:1]]",
      reasoning: ["Check the flow."],
      citations: [{ source: "fabric:entity/org", title: "Coverage", citedText: "9 of 14" }],
      toolCalls: [{ name: "getProcessFlow", input: "Reading the process flow", found: true, resultTokens: 900 }],
      note: "Missed procurement",
    });
    expect(shared.expiresAt - shared.sharedAt).toBe(90 * 24 * 60 * 60 * 1_000);
    expect((await ana.query(api.ask.getThread, { threadId: ids.threadId }))!.messages[1].feedback).toEqual({ rating: "down", shared: true });
  });

  test("thumbs-up and unshare both remove the snapshot; only thumbs-down can be shared", async () => {
    const { t, ids, ana } = await answered();
    const error = await ana.mutation(api.askFeedback.shareExchange, { messageId: ids.messageId }).catch((e) => e);
    expect(userErrorMessageOf(error)).toMatch(/marked unhelpful/);

    await ana.mutation(api.askFeedback.setFeedback, { messageId: ids.messageId, rating: "down" });
    await ana.mutation(api.askFeedback.shareExchange, { messageId: ids.messageId });
    await ana.mutation(api.askFeedback.setFeedback, { messageId: ids.messageId, rating: "up" });
    expect(await t.run((ctx) => ctx.db.query("askSharedExchanges").collect())).toEqual([]);

    await ana.mutation(api.askFeedback.setFeedback, { messageId: ids.messageId, rating: "down" });
    await ana.mutation(api.askFeedback.shareExchange, { messageId: ids.messageId });
    await ana.mutation(api.askFeedback.unshareExchange, { messageId: ids.messageId });
    expect(await t.run((ctx) => ctx.db.query("askSharedExchanges").collect())).toEqual([]);
  });

  test("only the author can rate, and shared exchanges expire after 90 days", async () => {
    const { t, ids, ana, olga } = await answered();
    await expect(olga.mutation(api.askFeedback.setFeedback, { messageId: ids.messageId, rating: "up" })).rejects.toThrow();
    await ana.mutation(api.askFeedback.setFeedback, { messageId: ids.messageId, rating: "down" });
    await ana.mutation(api.askFeedback.shareExchange, { messageId: ids.messageId });
    expect(await t.mutation(internal.askFeedback.expireSharedExchanges, {})).toBe(0);
    vi.setSystemTime(Date.now() + 91 * 24 * 60 * 60 * 1_000);
    expect(await t.mutation(internal.askFeedback.expireSharedExchanges, {})).toBe(1);
  });

  test("org admins can't reach shared exchanges; a super admin's view is audited", async () => {
    const { t, ids, ana } = await answered();
    await ana.mutation(api.askFeedback.setFeedback, { messageId: ids.messageId, rating: "down" });
    await ana.mutation(api.askFeedback.shareExchange, { messageId: ids.messageId });
    const exchangeId = (await t.run((ctx) => ctx.db.query("askSharedExchanges").collect()))[0]._id;
    const superAdmin = await t.run(async (ctx) => {
      const tokenIdentifier = `${ISSUER}|user_root`;
      await ctx.db.insert("users", { tokenIdentifier, name: "root", email: "root@example.test", profileComplete: true, platformRole: "superAdmin" });
      const admin = await member(ctx, "user_orgadmin", ORG, "admin");
      return { tokenIdentifier, admin };
    });
    const asOrgAdmin = t.withIdentity({ tokenIdentifier: superAdmin.admin.tokenIdentifier, subject: "a", issuer: ISSUER, orgId: ORG, orgSlug: ORG });
    await expect(asOrgAdmin.query(api.askShared.listSharedExchanges, {})).rejects.toThrow();

    const asRoot = t.withIdentity({ tokenIdentifier: superAdmin.tokenIdentifier, subject: "root", issuer: ISSUER });
    expect((await asRoot.query(api.askShared.listSharedExchanges, {})).map((r) => r._id)).toEqual([exchangeId]);
    const viewed = await asRoot.mutation(api.askShared.viewSharedExchange, { exchangeId });
    expect(viewed?.question).toBe("Why is dispatch slow?");
    const audit = await t.run((ctx) => ctx.db.query("authAuditEvents").collect());
    expect(audit.filter((a) => a.action === "sharedExchangeViewed")).toHaveLength(1);
  });

  test("the admin AskFabric page counts without content or cost, and members can't read it", async () => {
    const { t, ids, ana } = await answered();
    await ana.mutation(api.askFeedback.setFeedback, { messageId: ids.messageId, rating: "up" });
    const admin = await t.run((ctx) => member(ctx, "user_orgadmin", ORG, "admin"));
    const asAdmin = t.withIdentity({ tokenIdentifier: admin.tokenIdentifier, subject: "a", issuer: ISSUER, orgId: ORG, orgSlug: ORG });
    const usage = await asAdmin.query(api.askUsage.getOrgUsage, {});
    expect(usage).toMatchObject({ last30Days: { questions: 1, threads: 1, activeUsers: 1 }, thumbsUp: 1, thumbsDown: 0, errorRate: 0 });
    expect(JSON.stringify(usage)).not.toMatch(/dispatch|Re-keying|"t"|cost|token/i);
    expect(usage.members).toEqual([{ userId: ids.ana.userId, name: "user_ana", questions: 1, thumbsUp: 1, thumbsDown: 0, daysAtLimit: 0 }]);
    const feedback = await asAdmin.query(api.askUsage.listFeedback, { paginationOpts: { numItems: 25, cursor: null } });
    expect(feedback.page.map(({ member, rating, shared }) => ({ member, rating, shared }))).toEqual([
      { member: "user_ana", rating: "up", shared: false },
    ]);
    expect(JSON.stringify(feedback.page)).not.toMatch(/dispatch|Re-keying/i);
    await expect(ana.query(api.askUsage.getOrgUsage, {})).rejects.toThrow();
    await expect(ana.query(api.askUsage.listFeedback, { paginationOpts: { numItems: 25, cursor: null } })).rejects.toThrow();
  });
});

describe("starter prompts (FR-6)", () => {
  test("the mix: two org-wide prompts, a named signal, the department and what's new", () => {
    const prompts = buildSuggestions({
      completedContributions: 12,
      role: "viewer",
      topSignal: { signal: "bottleneck", processName: "Dispatch" },
      hasSystems: true,
      department: "Finance",
      newSince: { count: 3, date: "2026-10-30" },
    });
    expect(prompts.filter((p) => p.category === "orgWide").length).toBeGreaterThanOrEqual(2);
    expect(prompts.map((p) => p.text)).toEqual(
      expect.arrayContaining([
        "What's behind the bottleneck in Dispatch?",
        "What are the biggest gaps in how Finance works today?",
        "What's new since 2026-10-30?",
      ]),
    );
    expect(prompts.length).toBeGreaterThanOrEqual(4);
    expect(prompts.length).toBeLessThanOrEqual(6);
  });

  test("every prompt has a topic, and a stored prompt without one maps back to the same topic", () => {
    const inputs = {
      completedContributions: 12,
      hasSystems: true,
      department: "Finance",
      newSince: { count: 3, date: "2026-10-30" },
    };
    const prompts = [
      ...(["bottleneck", "friction", "tribalKnowledge", "handoff"] as const).flatMap((signal) =>
        buildSuggestions({ ...inputs, role: "viewer", topSignal: { signal, processName: "Dispatch" } }),
      ),
      ...buildSuggestions({ ...inputs, hasSystems: false, department: null, newSince: null, role: "viewer", topSignal: null }),
      ...buildSuggestions({ ...inputs, completedContributions: 0, role: "admin", topSignal: null }),
    ];
    expect(new Set(prompts.map((p) => p.topic))).toEqual(
      new Set(["friction", "biggestMoves", "bottlenecks", "keyPersonRisk", "handoffs", "gaps", "whatsNew", "systems", "coverage", "usingFabric"]),
    );
    for (const prompt of prompts) {
      expect(topicForStoredPrompt({ text: prompt.text, category: prompt.category }), prompt.text).toBe(prompt.topic);
    }
    expect(topicForStoredPrompt({ text: "Something no template writes?", category: "orgWide" })).toBeNull();
  });

  test("an empty org gets help prompts written for the role (FR-6.5)", () => {
    const base = { completedContributions: 0, topSignal: null, hasSystems: false, department: null, newSince: null };
    expect(buildSuggestions({ ...base, role: "viewer" }).every((p) => p.category === "help")).toBe(true);
    expect(buildSuggestions({ ...base, role: "viewer" }).some((p) => /AI interview/.test(p.text))).toBe(false);
    expect(buildSuggestions({ ...base, role: "contributor" }).some((p) => /AI interview/.test(p.text))).toBe(true);
  });

  test("Ask about this: three prompts from the entity's own data, and the coverage question alone when it has none (2B.1)", () => {
    const base = { name: "Payroll", hasContributions: true, topSignal: null, hasSystems: false, hasFlow: false };
    expect(
      buildEntitySuggestions({
        ...base,
        kind: "process",
        hasFlow: true,
        hasSystems: true,
        topSignal: { signal: "bottleneck", processName: "Payroll" },
      }).map((p) => p.text),
    ).toEqual([
      "Walk me through Payroll, step by step.",
      "What's behind the bottleneck in Payroll?",
      "Which systems does Payroll rely on, and where do they cause problems?",
    ]);
    // No flow, no signal, no systems: nothing is offered that the data can't answer.
    expect(buildEntitySuggestions({ ...base, kind: "process" }).map((p) => p.topic)).toEqual(["gaps"]);
    expect(buildEntitySuggestions({ ...base, kind: "department" }).map((p) => p.topic)).toEqual(["coverage"]);
    expect(buildEntitySuggestions({ ...base, kind: "function", hasFlow: true, hasContributions: false })).toEqual([
      { text: "How much of Payroll has been interviewed, and what's still missing?", category: "entitySignal", topic: "coverage" },
    ]);
  });

  test("Ask about this checks the entity as the viewer: another org's or a malformed id finds nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const ana = await member(ctx, "user_ana", ORG);
      const fn = await ctx.db.insert("functions", { name: "F", sortOrder: 0, clerkOrgId: ORG });
      const dept = await ctx.db.insert("departments", { functionId: fn, name: "Finance", sortOrder: 0, clerkOrgId: ORG });
      const processId = await ctx.db.insert("processes", { departmentId: dept, name: "Payroll", sortOrder: 0, clerkOrgId: ORG });
      const otherFn = await ctx.db.insert("functions", { name: "Theirs", sortOrder: 0, clerkOrgId: OTHER_ORG });
      return { ana, dept, processId, otherFn };
    });
    const asAna = t.withIdentity({ tokenIdentifier: ids.ana.tokenIdentifier, subject: "a", issuer: ISSUER, orgId: ORG, orgSlug: ORG });
    expect(await asAna.query(api.askSuggestions.getEntityStarters, { ref: { kind: "process", id: ids.processId } })).toEqual({
      kind: "process",
      id: ids.processId,
      name: "Payroll",
      prompts: [{ text: "How much of Payroll has been interviewed, and what's still missing?", category: "entitySignal", topic: "coverage" }],
    });
    expect(await asAna.query(api.askSuggestions.getEntityStarters, { ref: { kind: "department", id: ids.dept } })).toMatchObject({ name: "Finance" });
    expect(await asAna.query(api.askSuggestions.getEntityStarters, { ref: { kind: "function", id: ids.otherFn } })).toBeNull();
    expect(await asAna.query(api.askSuggestions.getEntityStarters, { ref: { kind: "process", id: "not-an-id" } })).toBeNull();
    // A department id presented as a process.
    expect(await asAna.query(api.askSuggestions.getEntityStarters, { ref: { kind: "process", id: ids.dept } })).toBeNull();
  });

  test("a visit stores a personal set; rebuilds skip members inactive for 30 days", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const ana = await member(ctx, "user_ana", ORG);
      const old = await member(ctx, "user_old", ORG);
      const fn = await ctx.db.insert("functions", { name: "F", sortOrder: 0, clerkOrgId: ORG });
      const dept = await ctx.db.insert("departments", { functionId: fn, name: "Finance", sortOrder: 0, clerkOrgId: ORG });
      const processId = await ctx.db.insert("processes", { departmentId: dept, name: "P", sortOrder: 0, clerkOrgId: ORG });
      await ctx.db.insert("conversations", { processId, contributorName: "Ana", status: "done", clerkOrgId: ORG, title: "t", summary: "s" });
      await ctx.db.patch("memberships", ana.membershipId, { departmentId: dept });
      await ctx.db.insert("askSuggestions", { clerkOrgId: ORG, userId: old.userId, prompts: [], signals: [], generatedAt: 0, lastVisitedAt: Date.now() - 40 * 24 * 60 * 60 * 1_000 });
      return { ana, old };
    });
    const asAna = t.withIdentity({ tokenIdentifier: ids.ana.tokenIdentifier, subject: "a", issuer: ISSUER, orgId: ORG, orgSlug: ORG });
    await asAna.mutation(api.askSuggestions.markVisited, {});
    await drain(t);
    const prompts = await asAna.query(api.askSuggestions.getSuggestions, {});
    expect(prompts.map((p) => p.text)).toContain("What are the biggest gaps in how Finance works today?");
    // The new-thread page: what answers draw on, and ana's own placement.
    expect(await asAna.query(api.askSuggestions.getStarterContext, {})).toMatchObject({
      stats: { contributions: 1, contributionsCapped: false, processes: 1, departments: 1 },
      department: { name: "Finance" },
      function: { name: "F" },
    });

    await t.mutation(internal.askSuggestions.recomputeForOrg, { clerkOrgId: ORG });
    const oldRow = await t.run(async (ctx) =>
      (await ctx.db.query("askSuggestions").collect()).find((r) => r.userId === ids.old.userId),
    );
    expect(oldRow?.prompts).toEqual([]);
  });
});

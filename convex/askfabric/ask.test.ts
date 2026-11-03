/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { userErrorMessageOf } from "../lib/userError";
import { createScriptedAskClient, setAskModelClientFactory, type ScriptedStep } from "./modelClient";

// Root-anchored, as in askTools: a relative glob can't be mapped by convex-test.
const modules = import.meta.glob("/convex/**/*.ts");
const ORG_A = "org_ask_turn_a";
const ORG_B = "org_ask_turn_b";
const ISSUER = "https://ask-turn.test";

const ENV = {
  ASKFABRIC: ORG_A,
  ASKFABRIC_FOUNDRY_DEPLOYMENT: "askfabric-claude-sonnet-5-5",
  ASKFABRIC_MODEL: "claude-sonnet-5-5",
  FOUNDRY_ENDPOINT: "https://example.services.ai.azure.com",
  FOUNDRY_API_KEY: "test-key",
  FOUNDRY_CLAUDE_DEPLOYMENT: "fabric-claude-haiku-5-5",
};
const saved = Object.fromEntries(
  [...Object.keys(ENV), "ASKFABRIC_DAILY_USER_LIMIT", "ASKFABRIC_DAILY_ORG_LIMIT"].map((key) => [key, process.env[key]]),
);

const ANSWER: ScriptedStep[] = [
  { content: [{ type: "text", text: "Checking coverage." }, { type: "tool_use", id: "toolu_1", name: "getCoverage", input: { kind: "org", id: "" } }] },
  {
    content: [
      {
        type: "text",
        text: "Half the processes have contributions.",
        citations: [{ type: "search_result_location", source: "fabric:entity/org", title: "Coverage — the organization", cited_text: "1 of 2 processes" }],
      },
    ],
  },
];

function useScript(steps: ScriptedStep[]) {
  const scripted = createScriptedAskClient(steps);
  setAskModelClientFactory(() => scripted.client);
  return scripted;
}

async function seed(ctx: MutationCtx, orgId: string, name: string) {
  const functionId = await ctx.db.insert("functions", { name: `Ops ${orgId}`, sortOrder: 0, clerkOrgId: orgId });
  const departmentId = await ctx.db.insert("departments", { functionId, name: "Dispatch", sortOrder: 0, clerkOrgId: orgId });
  const processId = await ctx.db.insert("processes", { departmentId, name: "Scheduling", sortOrder: 0, clerkOrgId: orgId });
  await ctx.db.insert("processes", { departmentId, name: "Returns", sortOrder: 1, clerkOrgId: orgId });
  await ctx.db.insert("conversations", { processId, contributorName: "Ana", status: "done", clerkOrgId: orgId, title: "Walkthrough", summary: "s" });
  const tokenIdentifier = `${ISSUER}|${name}`;
  const userId = await ctx.db.insert("users", { tokenIdentifier, name, email: `${name}@example.test`, profileComplete: true });
  const membershipId = await ctx.db.insert("memberships", { tokenIdentifier, userId, clerkOrgId: orgId, role: "viewer", createdAt: 0 });
  return { processId, userId, membershipId, tokenIdentifier };
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => ({
    a: await seed(ctx, ORG_A, "ana"),
    b: await seed(ctx, ORG_B, "bob"),
    other: await (async () => {
      const tokenIdentifier = `${ISSUER}|olga`;
      const userId = await ctx.db.insert("users", { tokenIdentifier, name: "olga", email: "olga@example.test", profileComplete: true });
      await ctx.db.insert("memberships", { tokenIdentifier, userId, clerkOrgId: ORG_A, role: "admin", createdAt: 0 });
      return { tokenIdentifier };
    })(),
  }));
  const as = (tokenIdentifier: string, orgId = ORG_A) =>
    t.withIdentity({ tokenIdentifier, subject: tokenIdentifier, issuer: ISSUER, orgId, orgSlug: orgId });
  return { t, ids, ana: as(ids.a.tokenIdentifier), olga: as(ids.other.tokenIdentifier) };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/**
 * Seeds a question and its streaming answer, as `sendMessage` would, without
 * scheduling: convex-test runs everything through one transaction manager, so
 * a scheduled turn running in the background collides with the test's own
 * reads. Turns run with `runTurn` directly instead.
 */
async function startTurn(s: Setup, text: string, threadId?: Id<"askThreads">) {
  return await s.t.run(async (ctx) => {
    const userId = s.ids.a.userId;
    const id =
      threadId ??
      (await ctx.db.insert("askThreads", { clerkOrgId: ORG_A, userId, title: text.slice(0, 60), status: "active", lastMessageAt: 0 }));
    await ctx.db.insert("askMessages", { threadId: id, clerkOrgId: ORG_A, userId, role: "user", parts: [{ type: "text", text }] });
    const assistantMessageId = await ctx.db.insert("askMessages", {
      threadId: id,
      clerkOrgId: ORG_A,
      userId,
      role: "assistant",
      parts: [],
      status: "streaming",
    });
    return { threadId: id, assistantMessageId };
  });
}

async function runTurn(s: Setup, ids: { threadId: Id<"askThreads">; assistantMessageId: Id<"askMessages"> }) {
  await s.t.action(internal.ask.runTurn, {
    ...ids,
    viewer: { tokenIdentifier: s.ids.a.tokenIdentifier, orgId: ORG_A },
  });
  return await s.t.run((ctx) => ctx.db.get("askMessages", ids.assistantMessageId));
}

beforeEach(() => {
  Object.assign(process.env, ENV);
});

afterEach(() => {
  setAskModelClientFactory(null);
  vi.useRealTimers();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("sendMessage (FR-2.1, FR-2.2, FR-4.2)", () => {
  beforeEach(() => {
    // Keep the scheduled turn from firing: these tests check what is scheduled.
    vi.useFakeTimers({ toFake: ["setTimeout"] });
  });

  test("creates the thread, the question and a streaming answer, and schedules the turn", async () => {
    const s = await setup();
    const { threadId, assistantMessageId } = await s.ana.mutation(api.ask.sendMessage, { text: "  How much have we covered?  " });
    const rows = await s.t.run(async (ctx) => ({
      thread: await ctx.db.get("askThreads", threadId),
      messages: await ctx.db.query("askMessages").collect(),
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
    }));
    expect(rows.thread).toMatchObject({ title: "How much have we covered?", status: "active", userId: s.ids.a.userId });
    expect(rows.messages.map((m) => [m.role, m.status ?? null])).toEqual([["user", null], ["assistant", "streaming"]]);
    expect(rows.messages[1]).toMatchObject({ promptVersion: expect.stringMatching(/^askfabric-/), model: "foundry:claude-sonnet-5-5@2" });
    expect(rows.scheduled).toHaveLength(1);
    expect(rows.scheduled[0].name).toBe("ask:runTurn");
    expect(rows.scheduled[0].args[0]).toMatchObject({
      assistantMessageId,
      viewer: { tokenIdentifier: s.ids.a.tokenIdentifier, orgId: ORG_A },
    });
  });

  test("rejects a question while the thread's answer is streaming", async () => {
    const s = await setup();
    const { threadId } = await s.ana.mutation(api.ask.sendMessage, { text: "First" });
    const error = await s.ana.mutation(api.ask.sendMessage, { threadId, text: "Another?" }).catch((e) => e);
    expect(userErrorMessageOf(error)).toMatch(/Wait for the current answer/);
  });

  test("drops a crafted reference to another org's entity", async () => {
    const s = await setup();
    const { threadId } = await s.ana.mutation(api.ask.sendMessage, {
      text: "Tell me about this",
      contextRef: { kind: "process", id: s.ids.b.processId },
      mentions: [{ kind: "process", id: s.ids.b.processId }],
    });
    const rows = await s.t.run(async (ctx) => ({
      thread: await ctx.db.get("askThreads", threadId),
      question: (await ctx.db.query("askMessages").collect())[0],
    }));
    expect(rows.thread?.contextRef).toBeUndefined();
    expect(rows.question.contextRef).toBeUndefined();
    expect(rows.question.mentions).toBeUndefined();
  });

  test("keeps a valid reference from the viewer's own org", async () => {
    const s = await setup();
    const { threadId } = await s.ana.mutation(api.ask.sendMessage, {
      text: "Tell me about this",
      contextRef: { kind: "process", id: s.ids.a.processId },
    });
    const thread = await s.t.run((ctx) => ctx.db.get("askThreads", threadId));
    expect(thread?.contextRef).toEqual({ kind: "process", id: s.ids.a.processId });
  });

  test("threads and Stop are for their owner only (FR-3.1)", async () => {
    const s = await setup();
    const { threadId, assistantMessageId } = await s.ana.mutation(api.ask.sendMessage, { text: "Hi" });
    expect(await s.ana.query(api.ask.getThread, { threadId })).not.toBeNull();
    expect(await s.olga.query(api.ask.getThread, { threadId })).toBeNull();
    await expect(s.olga.mutation(api.ask.stopTurn, { messageId: assistantMessageId })).rejects.toThrow();
    await s.ana.mutation(api.ask.stopTurn, { messageId: assistantMessageId });
    expect(await s.t.run((ctx) => ctx.db.get("askMessages", assistantMessageId))).toMatchObject({ cancelRequested: true });
  });

  test("fails closed when AskFabric is off for the org (FR-9.6)", async () => {
    process.env.ASKFABRIC = "false";
    const s = await setup();
    const error = await s.ana.mutation(api.ask.sendMessage, { text: "Hi" }).catch((e) => e);
    expect(userErrorMessageOf(error)).toBe("AskFabric is unavailable.");
    expect(await s.t.run((ctx) => ctx.db.query("askThreads").collect())).toEqual([]);
  });
});

describe("beta limits (D51)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    vi.setSystemTime(Date.parse("2026-11-03T08:00:00Z"));
  });

  /** Seeds finished answers for a member, as earlier questions today would leave. */
  async function answered(s: Setup, userId: Id<"users">, statuses: ("complete" | "stopped" | "error")[]) {
    await s.t.run(async (ctx) => {
      const threadId = await ctx.db.insert("askThreads", { clerkOrgId: ORG_A, userId, title: "Earlier", status: "active", lastMessageAt: 0 });
      for (const status of statuses) {
        await ctx.db.insert("askMessages", { threadId, clerkOrgId: ORG_A, userId, role: "assistant", parts: [], status });
      }
    });
  }

  test("a member over the daily limit is refused, and failed answers don't count", async () => {
    process.env.ASKFABRIC_DAILY_USER_LIMIT = "2";
    const s = await setup();
    await answered(s, s.ids.a.userId, ["complete", "error", "error"]);
    expect(await s.ana.query(api.ask.getDailyAllowance, {})).toMatchObject({ limit: 2, remaining: 1, orgLimitReached: false });
    const { assistantMessageId } = await s.ana.mutation(api.ask.sendMessage, { text: "One more" });
    await s.t.run((ctx) => ctx.db.patch("askMessages", assistantMessageId, { status: "stopped" }));

    const error = await s.ana.mutation(api.ask.sendMessage, { text: "And another" }).catch((e) => e);
    expect(userErrorMessageOf(error)).toMatch(/2 questions per person per day/);
    expect(await s.ana.query(api.ask.getDailyAllowance, {})).toMatchObject({ remaining: 0 });
  });

  test("the limit resets at midnight Gulf time", async () => {
    process.env.ASKFABRIC_DAILY_USER_LIMIT = "1";
    const s = await setup();
    await answered(s, s.ids.a.userId, ["complete"]);
    await expect(s.ana.mutation(api.ask.sendMessage, { text: "Today" })).rejects.toThrow();
    vi.setSystemTime(Date.parse("2026-11-03T20:00:01Z"));
    await expect(s.ana.mutation(api.ask.sendMessage, { text: "Tomorrow" })).resolves.toBeDefined();
  });

  test("the org's daily total refuses every member once reached", async () => {
    process.env.ASKFABRIC_DAILY_ORG_LIMIT = "2";
    const s = await setup();
    const olgaId = await s.t.run(async (ctx) => (await ctx.db.query("users").collect()).find((u) => u.name === "olga")!._id);
    await answered(s, olgaId, ["complete", "stopped"]);
    const error = await s.ana.mutation(api.ask.sendMessage, { text: "Hi" }).catch((e) => e);
    expect(userErrorMessageOf(error)).toMatch(/Your workspace has used today's 2/);
    expect(await s.ana.query(api.ask.getDailyAllowance, {})).toMatchObject({ orgLimitReached: true });
  });

  test("one answer at a time per member, across threads", async () => {
    const s = await setup();
    await s.ana.mutation(api.ask.sendMessage, { text: "First" });
    const error = await s.ana.mutation(api.ask.sendMessage, { text: "In a new thread" }).catch((e) => e);
    expect(userErrorMessageOf(error)).toMatch(/Wait for your other answer/);
  });

  test("off removes a limit", async () => {
    process.env.ASKFABRIC_DAILY_USER_LIMIT = "off";
    const s = await setup();
    await answered(s, s.ids.a.userId, Array(12).fill("complete"));
    await expect(s.ana.mutation(api.ask.sendMessage, { text: "Still here" })).resolves.toBeDefined();
    expect(await s.ana.query(api.ask.getDailyAllowance, {})).toMatchObject({ limit: null, remaining: null });
  });

  test("the admin page counts members who reached the limit", async () => {
    process.env.ASKFABRIC_DAILY_USER_LIMIT = "2";
    const s = await setup();
    await answered(s, s.ids.a.userId, ["complete", "stopped"]);
    const usage = await s.olga.query(api.askUsage.getOrgUsage, {});
    expect(usage).toMatchObject({ limits: { user: 2, org: 100 }, membersAtLimit: 1, orgDaysAtLimit: 0 });
    expect(usage.members.find((m) => m.userId === s.ids.a.userId)).toMatchObject({ daysAtLimit: 1 });
  });
});

describe("runTurn", () => {
  test("runs a cited, metered turn and titles the thread", async () => {
    const scripted = useScript(ANSWER);
    const s = await setup();
    const ids = await startTurn(s, "How much have we covered?");
    const message = await runTurn(s, ids);

    expect(message?.status).toBe("complete");
    expect(message?.parts.map((p) => p.type)).toEqual(["reasoning", "tool", "text"]);
    expect(message?.parts.at(-1)).toEqual({ type: "text", text: "Half the processes have contributions.[[cite:1]]" });
    expect(message?.quality).toMatchObject({ modelCalls: 2, toolCalls: 1, citations: 1 });

    // The tool really ran as the viewer against org A's data.
    const toolResult = (scripted.requests[1].messages.at(-1) as { content: Array<{ content: Array<{ type: string; content?: Array<{ text: string }> }> }> }).content[0].content;
    const coverage = (toolResult as Array<{ source?: string; content?: Array<{ text: string }> }>).find((b) => b.source === "fabric:entity/org");
    expect(coverage?.content?.[0].text).toContain("1 of 2 processes");

    const thread = await s.ana.query(api.ask.getThread, { threadId: ids.threadId });
    expect(thread?.title).toBe("Scripted thread title");
    expect(thread?.messages[1].citations).toEqual([
      {
        ordinal: 1,
        source: "fabric:entity/org",
        sourceKind: "org",
        availability: "available",
        path: { fn: null, dept: null, proc: null },
        title: "Coverage — the organization",
        citedText: "1 of 2 processes",
      },
    ]);
    const stored = await s.t.run((ctx) => ctx.db.query("askCitations").collect());
    expect(stored[0]).toMatchObject({ sourceKind: "org", sourceEntityId: "org", threadId: ids.threadId, userId: s.ids.a.userId });

    const usage = await s.t.run((ctx) => ctx.db.query("aiUsageEvents").collect());
    expect(usage.map((row) => row.operation).sort()).toEqual(["askfabric.title", "askfabric.turn", "askfabric.turn"]);
    expect(usage.every((row) => row.runId === ids.assistantMessageId && row.clerkOrgId === ORG_A)).toBe(true);
    expect(usage.every((row) => row.model === "foundry:claude-sonnet-5-5@2" && row.costMicroUsd > 0)).toBe(true);

    // The system prompt carries the table of contents, cached.
    const system = scripted.requests[0].system;
    expect(system[1].text).toContain("Process: Scheduling");
    expect(system[1].cache_control).toEqual({ type: "ephemeral" });
  });

  test("a second turn replays the first as text history, without a new title", async () => {
    const scripted = useScript([...ANSWER, { content: [{ type: "text", text: "Two more." }] }]);
    const s = await setup();
    const first = await startTurn(s, "How much have we covered?");
    await runTurn(s, first);
    const second = await startTurn(s, "And since then?", first.threadId);
    expect((await runTurn(s, second))?.status).toBe("complete");

    const messages = scripted.requests[2].messages as Array<{ role: string; content: unknown }>;
    // The history question carries a cache breakpoint: it is the second-last user message.
    expect(messages[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: "How much have we covered?", cache_control: { type: "ephemeral" } }],
    });
    expect(messages[1]).toEqual({ role: "assistant", content: "Half the processes have contributions.[[cite:1]]" });
    expect(JSON.stringify(messages[2])).toContain("And since then?");
    const titles = (await s.t.run((ctx) => ctx.db.query("aiUsageEvents").collect())).filter((r) => r.operation === "askfabric.title");
    expect(titles).toHaveLength(1);
  });

  test("Stop ends a streaming answer and keeps its partial work (FR-2.4)", async () => {
    const s = await setup();
    const ids = await startTurn(s, "Long one");
    useScript([
      {
        events: [{ type: "thinking_start" }, { type: "thinking_delta", text: "Reading overviews" }],
        content: [],
        hangUntilAborted: true,
        during: async () => {
          await s.t.run((ctx) => ctx.db.patch("askMessages", ids.assistantMessageId, { cancelRequested: true }));
        },
      },
    ]);
    const message = await runTurn(s, ids);
    expect(message?.status).toBe("stopped");
    expect(message?.parts[0]).toMatchObject({ type: "reasoning", text: "Reading overviews" });
  });

  test("deleting the thread mid-turn stops all writes (FR-2.12)", async () => {
    const s = await setup();
    const ids = await startTurn(s, "Long one");
    useScript([
      { content: [{ type: "tool_use", id: "toolu_1", name: "getCoverage", input: { kind: "org", id: "" } }] },
      {
        content: [{ type: "text", text: "Never stored", citations: [{ type: "search_result_location", source: "fabric:entity/org", cited_text: "x" }] }],
        during: async () => {
          await s.t.run((ctx) => ctx.db.patch("askThreads", ids.threadId, { status: "deleting" }));
        },
      },
    ]);
    const message = await runTurn(s, ids);
    expect(message?.completedAt).toBeUndefined();
    expect(await s.t.run((ctx) => ctx.db.query("askCitations").collect())).toEqual([]);
  });

  test("a turn whose viewer lost access ends with the access error", async () => {
    useScript([]);
    const s = await setup();
    const ids = await startTurn(s, "q");
    await s.t.run((ctx) => ctx.db.patch("memberships", s.ids.a.membershipId, { removedAt: 1 }));
    expect(await runTurn(s, ids)).toMatchObject({ status: "error", errorReason: "accessLost" });
  });

  test("the watchdog marks answers still streaming after 5 minutes (FR-2.11)", async () => {
    useScript([]);
    const s = await setup();
    const { assistantMessageId } = await startTurn(s, "q");
    expect(await s.t.mutation(internal.ask.markStaleTurns, {})).toBe(0);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 6 * 60_000);
    expect(await s.t.mutation(internal.ask.markStaleTurns, {})).toBe(1);
    expect(await s.t.run((ctx) => ctx.db.get("askMessages", assistantMessageId))).toMatchObject({
      status: "error",
      errorReason: "unfinished",
    });
  });
});

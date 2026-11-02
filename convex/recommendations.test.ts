/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ORG = "org_recommendations";
const OTHER_ORG = "org_recommendations_other";
const ISSUER = "https://test.clerk";

const AI_ENV = [
  "AI_PROVIDER",
  "FOUNDRY_ENDPOINT",
  "FOUNDRY_API_KEY",
  "FOUNDRY_CLAUDE_DEPLOYMENT",
] as const;

type Role = "admin" | "contributor" | "viewer";

function identity(role: Role, orgId = ORG) {
  return {
    tokenIdentifier: `${ISSUER}|${role}_${orgId}`,
    subject: `${role}_${orgId}`,
    issuer: ISSUER,
    name: `${role} person`,
    email: `${role}@test.dev`,
    orgId,
    orgSlug: orgId,
  };
}

const ROUTE = {
  title: "Route tickets with a triage workflow",
  problem: "Every ticket is read and routed by hand.",
  cause: "No routing rules are written down.",
  causeBasis: "reported",
  intervention: "workflow",
  supportingInterventions: ["standardise"],
  proposedChange: "Write the rules down, then route automatically.",
  whyNotSimpler: "Applying the rules by hand is the bottleneck.",
  nodeIds: ["intake", "triage"],
  pilot: { what: "One queue for two weeks", measure: "Tickets waiting for triage" },
  openQuestions: ["Which queues have rules?"],
  risks: ["Urgent tickets misrouted"],
  frequency: "daily",
};

const CHECKLIST = {
  ...ROUTE,
  title: "Agree a triage checklist",
  problem: "Leads triage differently.",
  intervention: "standardise",
  supportingInterventions: [],
  proposedChange: "Write a one-page triage checklist.",
  whyNotSimpler: undefined,
  nodeIds: ["triage"],
  frequency: "weekly",
};

/** What the stubbed model answers next. `null` means an unusable response. */
let nextAnswer: unknown = { recommendations: [ROUTE] };
/** Answers to give before `nextAnswer`, one per call. */
let queuedAnswers: unknown[] = [];

function stubClaude() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const body = (await request.clone().json()) as { tools?: Array<{ name: string }> };
    const name = body.tools?.[0]?.name ?? "";
    const answer = queuedAnswers.length > 0 ? queuedAnswers.shift() : nextAnswer;
    const content =
      answer === null
        ? [{ type: "text", text: "I could not do that." }]
        : [{ type: "tool_use", id: "toolu_1", name, input: answer }];
    return new Response(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "fabric-claude-haiku-5-5",
        content,
        stop_reason: answer === null ? "end_turn" : "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 200 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function nodeDetail(actor: string) {
  return {
    description: "",
    actors: [actor],
    tools: ["Jira"],
    painPoints: ["Read by hand"],
    automationPotential: "high" as const,
    confidence: "medium" as const,
    isBottleneck: true,
    isTribalKnowledge: false,
    riskIndicators: [],
    sources: ["Alice, Conv. 1"],
  };
}

async function seedOrg(ctx: MutationCtx, orgId = ORG) {
  for (const role of ["admin", "contributor", "viewer"] as const) {
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: `${ISSUER}|${role}_${orgId}`,
      name: `${role} person`,
      email: `${role}@test.dev`,
      profileComplete: true,
    });
    await ctx.db.insert("memberships", {
      tokenIdentifier: `${ISSUER}|${role}_${orgId}`,
      userId,
      clerkOrgId: orgId,
      role,
      createdAt: Date.now(),
    });
  }
  const functionId = await ctx.db.insert("functions", {
    name: "Operations",
    sortOrder: 0,
    clerkOrgId: orgId,
  });
  const departmentId = await ctx.db.insert("departments", {
    functionId,
    name: "Support",
    sortOrder: 0,
    clerkOrgId: orgId,
  });
  const processId = await ctx.db.insert("processes", {
    departmentId,
    name: "Ticket triage",
    sortOrder: 0,
    clerkOrgId: orgId,
  });
  await ctx.db.insert("conversations", {
    processId,
    contributorName: "Alice",
    status: "done",
    clerkOrgId: orgId,
    summary: "Alice described triage",
    analysis: { data_collection: { frequency: "daily", volume: "about 40 tickets" } },
  });
  // A legacy single-call flow: details inline, so no detail stage is needed.
  const processFlowId = await ctx.db.insert("processFlows", {
    processId,
    clerkOrgId: orgId,
    status: "ready",
    stale: false,
    generatedAt: Date.now(),
    conversationCount: 1,
    nodes: [
      { id: "intake", label: "Intake", category: "start", ...nodeDetail("Agent") },
      { id: "triage", label: "Triage", category: "action", ...nodeDetail("Team lead") },
      { id: "resolve", label: "Resolve", category: "end", ...nodeDetail("Agent") },
    ],
    edges: [],
    insights: {
      criticalPath: [],
      handoffCount: 0,
      toolCount: 1,
      automationOpportunities: [],
      topBottlenecks: [],
    },
  });
  return { processId, processFlowId };
}

function harness() {
  return convexTest(schema, modules);
}
type Harness = ReturnType<typeof harness>;

/** Starts a run as a contributor and drives the stage, the way the scheduler would. */
async function runRecommendations(t: Harness, processId: Id<"processes">) {
  await t
    .withIdentity(identity("contributor"))
    .mutation(api.recommendations.regenerateRecommendations, { processId });
  const run = await t.run((ctx) =>
    ctx.db.query("recommendationRuns").order("desc").first(),
  );
  await t.action(internal.recommendations.generateRecommendationsInternal, {
    clerkOrgId: ORG,
    runId: run!.runId,
  });
  return run!.runId;
}

function readView(t: Harness, processId: Id<"processes">, role: Role = "viewer") {
  return t
    .withIdentity(identity(role))
    .query(api.recommendations.getProcessRecommendations, { processId });
}

describe("recommendation runs", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "foundry";
    process.env.FOUNDRY_ENDPOINT = "https://fabric-test.services.ai.azure.com";
    process.env.FOUNDRY_API_KEY = "foundry-test-key";
    process.env.FOUNDRY_CLAUDE_DEPLOYMENT = "fabric-claude-haiku-5-5";
    nextAnswer = { recommendations: [ROUTE] };
    queuedAnswers = [];
    stubClaude();
    // The harness would otherwise start the scheduled stage on its own,
    // racing the explicit call each test makes. Only timers are faked.
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const name of AI_ENV) delete process.env[name];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test("publishes ranked, scored recommendations a viewer can read", async () => {
    const t = harness();
    const { processId } = await t.run((ctx) => seedOrg(ctx));
    // Same steps and frequency as ROUTE, so the two tie on value.
    nextAnswer = {
      recommendations: [
        ROUTE,
        { ...CHECKLIST, nodeIds: ROUTE.nodeIds, frequency: "daily" },
      ],
    };

    await runRecommendations(t, processId);
    const view = await readView(t, processId);

    expect(view?.run?.status).toBe("ready");
    expect(view?.canDecide).toBe(false);
    // Tied on value, so the cheaper change ranks first.
    expect(view?.recommendations.map((rec) => rec.title)).toEqual([
      "Agree a triage checklist",
      "Route tickets with a triage workflow",
    ]);
    expect(view?.recommendations[0].scores?.effort.level).toBe("low");
  });

  test("nothing to change is a successful answer, not a failure", async () => {
    const t = harness();
    const { processId, processFlowId } = await t.run((ctx) => seedOrg(ctx));
    nextAnswer = { recommendations: [] };

    await runRecommendations(t, processId);
    const view = await readView(t, processId);
    const flow = await t.run((ctx) => ctx.db.get(processFlowId));

    expect(view?.run?.status).toBe("ready");
    expect(view?.recommendations).toEqual([]);
    // Analysed and empty — never "derived", which the tab read as "not analysed".
    expect(flow?.insights.automationOpportunitiesSource).toBe("ai");
    expect(flow?.insights.automationOpportunityDetails).toEqual([]);
  });

  test("a technical follow-on is published linked to the change it builds on", async () => {
    const t = harness();
    const { processId } = await t.run((ctx) => seedOrg(ctx));
    const withFollowOn = {
      ...CHECKLIST,
      followOn: {
        kind: "ai_assist",
        title: "Draft triage notes against the checklist",
        problem: "Applying the checklist is still done by hand on every ticket.",
        proposedChange: "An assistant drafts the triage note for the lead to check.",
        whyNotSimpler: "The checklist makes triage consistent, not faster.",
        nodeIds: ["triage"],
        pilot: { what: "Two weeks", measure: "Time to first triage note" },
        openQuestions: [],
        risks: [],
      },
    };
    nextAnswer = { recommendations: [withFollowOn] };
    await runRecommendations(t, processId);
    const first = (await readView(t, processId))!.recommendations;
    const parent = first.find((rec) => rec.title === CHECKLIST.title)!;
    const child = first.find((rec) => rec.title === "Draft triage notes against the checklist")!;

    expect(child.content?.intervention).toBe("ai_assist");
    expect(child.buildsOnId).toBe(parent._id);
    expect(parent.buildsOnId).toBeNull();

    // A re-run keeps both identities and the link between them.
    await runRecommendations(t, processId);
    const again = (await readView(t, processId))!.recommendations;
    expect(again.find((rec) => rec._id === child._id)?.buildsOnId).toBe(parent._id);
  });

  test("an answer in text instead of the tool is asked again, not failed", async () => {
    const t = harness();
    const { processId } = await t.run((ctx) => seedOrg(ctx));
    queuedAnswers = [null];

    await runRecommendations(t, processId);
    const view = await readView(t, processId);

    expect(view?.run?.status).toBe("ready");
    expect(view?.recommendations.map((rec) => rec.title)).toEqual([ROUTE.title]);
  });

  test("an unusable response fails the run and leaves the flow alone", async () => {
    const t = harness();
    const { processId, processFlowId } = await t.run((ctx) => seedOrg(ctx));
    nextAnswer = null;

    await runRecommendations(t, processId);
    const view = await readView(t, processId);
    const flow = await t.run((ctx) => ctx.db.get(processFlowId));

    expect(view?.run?.status).toBe("failed");
    expect(view?.run?.errorMessage).toContain("process flow is not affected");
    expect(flow?.status).toBe("ready");
  });

  test("decisions survive a re-run, and are recorded with who made them", async () => {
    const t = harness();
    const { processId } = await t.run((ctx) => seedOrg(ctx));
    await runRecommendations(t, processId);
    const [first] = (await readView(t, processId))!.recommendations;

    await t
      .withIdentity(identity("contributor"))
      .mutation(api.recommendations.setRecommendationDecision, {
        recommendationId: first._id,
        to: "shortlisted",
        note: "Worth a pilot",
      });

    // The model renamed it and pointed at the stored id.
    nextAnswer = {
      recommendations: [
        { ...ROUTE, title: "Route tickets automatically", previousRecommendationId: first._id },
      ],
    };
    await runRecommendations(t, processId);
    const [again] = (await readView(t, processId))!.recommendations;

    expect(again._id).toBe(first._id);
    expect(again.title).toBe("Route tickets automatically");
    expect(again.decisionStatus).toBe("shortlisted");

    const activity = await t
      .withIdentity(identity("viewer"))
      .query(api.recommendations.getRecommendationActivity, {
        recommendationId: first._id,
      });
    expect(activity?.history).toMatchObject([
      { from: "new", to: "shortlisted", note: "Worth a pilot", actorName: "contributor person" },
    ]);
  });

  test("a recommendation someone decided about stays visible when a re-run drops it", async () => {
    const t = harness();
    const { processId } = await t.run((ctx) => seedOrg(ctx));
    nextAnswer = { recommendations: [ROUTE, CHECKLIST] };
    await runRecommendations(t, processId);
    const view = (await readView(t, processId))!;
    const route = view.recommendations.find((rec) => rec.title === ROUTE.title)!;

    await t
      .withIdentity(identity("admin"))
      .mutation(api.recommendations.setRecommendationDecision, {
        recommendationId: route._id,
        to: "dismissed",
        reason: "too_costly",
      });

    nextAnswer = { recommendations: [] };
    await runRecommendations(t, processId);
    const after = (await readView(t, processId))!;

    expect(after.recommendations).toEqual([]);
    expect(after.earlier.map((rec) => rec.title)).toEqual([ROUTE.title]);
    expect(after.earlier[0].dismissReason).toBe("too_costly");
  });

  test("dismissing needs a reason, and viewers can rate but not decide", async () => {
    const t = harness();
    const { processId } = await t.run((ctx) => seedOrg(ctx));
    await runRecommendations(t, processId);
    const [rec] = (await readView(t, processId))!.recommendations;

    await expect(
      t
        .withIdentity(identity("contributor"))
        .mutation(api.recommendations.setRecommendationDecision, {
          recommendationId: rec._id,
          to: "dismissed",
        }),
    ).rejects.toThrow("reason");

    await expect(
      t
        .withIdentity(identity("viewer"))
        .mutation(api.recommendations.setRecommendationDecision, {
          recommendationId: rec._id,
          to: "shortlisted",
        }),
    ).rejects.toThrow();

    const viewer = t.withIdentity(identity("viewer"));
    await viewer.mutation(api.recommendations.rateRecommendation, {
      recommendationId: rec._id,
      useful: false,
    });
    await viewer.mutation(api.recommendations.rateRecommendation, {
      recommendationId: rec._id,
      useful: true,
    });
    const activity = await viewer.query(api.recommendations.getRecommendationActivity, {
      recommendationId: rec._id,
    });
    // One rating per person; changing it replaces it.
    expect(activity?.ratings).toEqual({ useful: 1, notUseful: 0, mine: true });
  });

  test("a run superseded by a newer one cannot publish over it", async () => {
    const t = harness();
    const { processId } = await t.run((ctx) => seedOrg(ctx));
    const contributor = t.withIdentity(identity("contributor"));
    await contributor.mutation(api.recommendations.regenerateRecommendations, {
      processId,
    });
    const older = await t.run((ctx) => ctx.db.query("recommendationRuns").first());
    // Push the older run out of the join window so a second request starts a
    // new run instead of joining it.
    await t.run((ctx) =>
      ctx.db.patch(older!._id, { lastProgressAt: Date.now() - 600_000 }),
    );
    await contributor.mutation(api.recommendations.regenerateRecommendations, {
      processId,
    });

    await t.action(internal.recommendations.generateRecommendationsInternal, {
      clerkOrgId: ORG,
      runId: older!.runId,
    });

    const rows = await t.run((ctx) => ctx.db.query("processRecommendations").collect());
    expect(rows).toEqual([]);
  });

  test("the reaper fails a run whose heartbeat stopped", async () => {
    const t = harness();
    const { processId } = await t.run((ctx) => seedOrg(ctx));
    await t
      .withIdentity(identity("contributor"))
      .mutation(api.recommendations.regenerateRecommendations, { processId });
    await t.run(async (ctx) => {
      const run = await ctx.db.query("recommendationRuns").first();
      await ctx.db.patch(run!._id, {
        status: "running",
        lastProgressAt: Date.now() - 700_000,
      });
    });

    await t.mutation(internal.recommendations.reapStuckRecommendationRuns, {});

    expect((await readView(t, processId))?.run?.status).toBe("failed");
  });

  test("deleting the flow takes recommendations, decisions, ratings and runs with it", async () => {
    const t = harness();
    const { processId } = await t.run((ctx) => seedOrg(ctx));
    await runRecommendations(t, processId);
    const [rec] = (await readView(t, processId))!.recommendations;
    await t
      .withIdentity(identity("contributor"))
      .mutation(api.recommendations.setRecommendationDecision, {
        recommendationId: rec._id,
        to: "in_progress",
      });
    await t
      .withIdentity(identity("viewer"))
      .mutation(api.recommendations.rateRecommendation, {
        recommendationId: rec._id,
        useful: true,
      });

    await t.mutation(internal.recommendations.deleteForProcess, {
      processId,
      clerkOrgId: ORG,
    });

    const counts = await t.run(async (ctx) => ({
      recommendations: (await ctx.db.query("processRecommendations").collect()).length,
      decisions: (await ctx.db.query("recommendationDecisions").collect()).length,
      reviews: (await ctx.db.query("recommendationReviews").collect()).length,
      runs: (await ctx.db.query("recommendationRuns").collect()).length,
    }));
    expect(counts).toEqual({ recommendations: 0, decisions: 0, reviews: 0, runs: 0 });
  });

  test("a fresh backfill runs without showing the model the current recommendations", async () => {
    const t = harness();
    const { processId } = await t.run((ctx) => seedOrg(ctx));
    await runRecommendations(t, processId);
    // As on prod after a prompt change: the stored run is from the old prompt.
    await t.run(async (ctx) => {
      const previous = await ctx.db.query("recommendationRuns").first();
      await ctx.db.patch(previous!._id, { promptVersion: "recommendations-v9-2026-10-26" });
    });
    const fetchMock = stubClaude();

    const { backfillId } = await t.mutation(
      internal.recommendations.startRecommendationBackfill,
      { fresh: true },
    );
    await t.mutation(internal.recommendations.stepRecommendationBackfill, {
      backfillId,
    });
    const run = await t.run((ctx) =>
      ctx.db.query("recommendationRuns").order("desc").first(),
    );
    expect(run?.trigger).toBe("backfill");
    expect(run?.includeExisting).toBe(false);

    await t.action(internal.recommendations.generateRecommendationsInternal, {
      clerkOrgId: ORG,
      runId: run!.runId,
    });
    const [input, init] = fetchMock.mock.calls[0];
    const request = input instanceof Request ? input : new Request(input, init);
    const body = JSON.stringify(await request.clone().json());
    expect(body).not.toContain("## Current recommendations");

    // Same steps and kind of change, so the recommendation keeps its identity.
    const view = await readView(t, processId);
    expect(view?.run?.status).toBe("ready");
    expect(view?.recommendations.map((rec) => rec.title)).toEqual([ROUTE.title]);
  });

  test("a normal re-run still shows the model the current recommendations", async () => {
    const t = harness();
    const { processId } = await t.run((ctx) => seedOrg(ctx));
    await runRecommendations(t, processId);
    const fetchMock = stubClaude();
    await runRecommendations(t, processId);
    const [input, init] = fetchMock.mock.calls[0];
    const request = input instanceof Request ? input : new Request(input, init);
    expect(JSON.stringify(await request.clone().json())).toContain("## Current recommendations");
  });

  /** Starts a preview and drives each call, the way the scheduler would. */
  async function runPreview(
    t: Harness,
    processId: Id<"processes">,
    variants: string[],
  ) {
    const { batchId } = await t.mutation(
      internal.recommendationPreviews.startRecommendationPreview,
      { processes: [{ clerkOrgId: ORG, processId }], variants, runs: 1 },
    );
    const previews = await t.run((ctx) =>
      ctx.db.query("recommendationPreviews").collect(),
    );
    for (const preview of previews) {
      await t.action(internal.recommendationPreviews.runRecommendationPreview, {
        previewId: preview._id,
      });
    }
    return batchId;
  }

  test("a preview runs each prompt variant and publishes nothing", async () => {
    const t = harness();
    const { processId } = await t.run((ctx) => seedOrg(ctx));
    const fetchMock = stubClaude();
    nextAnswer = { recommendations: [CHECKLIST, ROUTE] };

    const batchId = await runPreview(t, processId, ["v9", "v10"]);

    // Each variant sent its own prompt and schema.
    const schemas = await Promise.all(
      fetchMock.mock.calls.map(async ([input, init]) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const body = (await request.clone().json()) as {
          tools: Array<{ input_schema: { properties: { recommendations: { items: { properties: object } } } } }>;
        };
        return Object.keys(body.tools[0].input_schema.properties.recommendations.items.properties);
      }),
    );
    expect(schemas.filter((keys) => keys.includes("whyThisChange"))).toHaveLength(1);
    expect(schemas.filter((keys) => keys.includes("whyNotSimpler"))).toHaveLength(1);

    // Nothing reaches the organisation.
    const published = await t.run(async (ctx) => ({
      recommendations: (await ctx.db.query("processRecommendations").collect()).length,
      runs: (await ctx.db.query("recommendationRuns").collect()).length,
    }));
    expect(published).toEqual({ recommendations: 0, runs: 0 });

    const report = await t.query(
      internal.recommendationPreviews.getRecommendationPreviewReport,
      { batchId, includeItems: true },
    );
    for (const variant of ["v9", "v10"]) {
      expect(report.totals[variant]).toMatchObject({
        runs: { ready: 1, failed: 0, pending: 0 },
        recommendations: 2,
        technicalTopLevel: 1,
        runsWithNoTechnical: 0,
      });
    }
    expect(report.technicalPerRunByProcess).toEqual([
      { processId, name: "Ticket triage", byVariant: { v9: [1], v10: [1] } },
    ]);
    expect(report.items?.[0].recommendations.map((rec) => rec.title).sort()).toEqual(
      [CHECKLIST.title, ROUTE.title].sort(),
    );

    // Deleting the process takes its previews with it.
    await t.mutation(internal.recommendations.deleteForProcess, {
      processId,
      clerkOrgId: ORG,
    });
    expect(
      await t.run(async (ctx) => (await ctx.db.query("recommendationPreviews").collect()).length),
    ).toBe(0);
  });

  test("the preview report counts the follow-ons the eight-item cap removed", async () => {
    const t = harness();
    const { processId } = await t.run((ctx) => seedOrg(ctx));
    const kinds = ["workflow", "integration", "agent", "ai_assist", "workflow"];
    const nodes = ["intake", "triage", "resolve"];
    nextAnswer = {
      recommendations: kinds.map((kind, i) => ({
        ...CHECKLIST,
        title: `Change ${i}`,
        followOn: {
          kind,
          title: `Next step ${i}`,
          problem: "Still done by hand.",
          proposedChange: "Automate what the change leaves.",
          whyNotSimpler: "",
          nodeIds: [nodes[i % 3]],
          pilotWhat: "",
          pilotMeasure: "",
          openQuestions: [],
          risks: [],
          previousRecommendationId: "",
        },
      })),
    };

    const batchId = await runPreview(t, processId, ["v9"]);
    const report = await t.query(
      internal.recommendationPreviews.getRecommendationPreviewReport,
      { batchId },
    );

    expect(report.totals.v9).toMatchObject({
      recommendations: 5,
      followOns: 3,
      followOnsCapped: 2,
      runsHittingCap: 1,
    });
  });

  test("a preview refuses a prompt variant that does not exist", async () => {
    const t = harness();
    const { processId } = await t.run((ctx) => seedOrg(ctx));
    await expect(
      t.mutation(internal.recommendationPreviews.startRecommendationPreview, {
        processes: [{ clerkOrgId: ORG, processId }],
        variants: ["v9", "v99"],
      }),
    ).rejects.toThrow(/Variants must be/);
  });
});

describe("recommendation backfill", () => {
  test("a backfill started ahead of time waits for its start time", async () => {
    const t = harness();
    const startAt = Date.now() + 6 * 60 * 60 * 1000;

    const result = await t.mutation(
      internal.recommendations.startRecommendationBackfill,
      { delayMs: 90_000, startAt },
    );

    expect(result).toMatchObject({ started: true, startsAt: startAt });
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const step = jobs.find((job) => job.name.includes("stepRecommendationBackfill"));
    expect(step?.scheduledTime).toBe(startAt);
    expect(
      await t.query(internal.recommendations.getRecommendationBackfillStatus, {}),
    ).toMatchObject({ status: "running", startsAt: startAt, scheduled: 0 });
  });

  test("pausing before the start time means the first step does nothing", async () => {
    const t = harness();
    const { backfillId } = await t.mutation(
      internal.recommendations.startRecommendationBackfill,
      { startAt: Date.now() + 60_000 },
    );
    await t.mutation(internal.recommendations.pauseRecommendationBackfill, {});
    await t.mutation(internal.recommendations.stepRecommendationBackfill, {
      backfillId,
    });
    expect(
      await t.query(internal.recommendations.getRecommendationBackfillStatus, {}),
    ).toMatchObject({ status: "paused", scheduled: 0, skipped: 0 });
  });
});

describe("tenant isolation for recommendations", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "foundry";
    process.env.FOUNDRY_ENDPOINT = "https://fabric-test.services.ai.azure.com";
    process.env.FOUNDRY_API_KEY = "foundry-test-key";
    process.env.FOUNDRY_CLAUDE_DEPLOYMENT = "fabric-claude-haiku-5-5";
    nextAnswer = { recommendations: [ROUTE] };
    stubClaude();
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const name of AI_ENV) delete process.env[name];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test("another org can neither read nor decide on a recommendation", async () => {
    const t = harness();
    const { processId } = await t.run(async (ctx) => {
      await seedOrg(ctx, OTHER_ORG);
      return await seedOrg(ctx);
    });
    await runRecommendations(t, processId);
    const [rec] = (await readView(t, processId))!.recommendations;

    const outsider = t.withIdentity(identity("admin", OTHER_ORG));
    expect(
      await outsider.query(api.recommendations.getProcessRecommendations, { processId }),
    ).toBeNull();
    expect(
      await outsider.query(api.recommendations.getRecommendationActivity, {
        recommendationId: rec._id,
      }),
    ).toBeNull();
    await expect(
      outsider.mutation(api.recommendations.setRecommendationDecision, {
        recommendationId: rec._id,
        to: "shortlisted",
      }),
    ).rejects.toThrow("not found");
    await expect(
      outsider.mutation(api.recommendations.regenerateRecommendations, { processId }),
    ).rejects.toThrow("not found");
  });
});

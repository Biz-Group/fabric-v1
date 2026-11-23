/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";

/**
 * Task 1.9: the backfill re-applies the Phase 1 rules to stored data with no
 * model call and no refresh, and its dry run writes nothing.
 */

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_backfill";

function detail(sources: string[], confidence: "high" | "medium" | "low" = "high") {
  return {
    description: "",
    actors: ["Support team"],
    tools: ["Zendesk"],
    painPoints: ["Time zone delays extend cycles", "Time zone delays extend investigation cycles"],
    automationPotential: "high" as const,
    confidence,
    isBottleneck: true,
    isTribalKnowledge: false,
    riskIndicators: [],
    sources,
  };
}

async function seed(ctx: MutationCtx) {
  const userId = await ctx.db.insert("users", {
    tokenIdentifier: "https://test|alice",
    name: "Alice Smith",
    email: "alice@test.dev",
    profileComplete: true,
  });
  // A member who never contributed, named inside a recommendation.
  const eleanorId = await ctx.db.insert("users", {
    tokenIdentifier: "https://test|eleanor",
    name: "Eleanor Price",
    email: "eleanor@test.dev",
    profileComplete: true,
  });
  for (const [id, name] of [
    [userId, "Alice Smith"],
    [eleanorId, "Eleanor Price"],
  ] as const) {
    await ctx.db.insert("memberships", {
      tokenIdentifier: `https://test|${name}`,
      userId: id,
      clerkOrgId: ORG,
      role: "contributor",
      createdAt: 0,
      name,
    });
  }
  const functionId = await ctx.db.insert("functions", { name: "Ops", sortOrder: 0, clerkOrgId: ORG });
  const departmentId = await ctx.db.insert("departments", { functionId, name: "Support", sortOrder: 0, clerkOrgId: ORG });
  const processId = await ctx.db.insert("processes", { departmentId, name: "Ticketing", sortOrder: 0, clerkOrgId: ORG });

  // One person, interviewed twice.
  const conversationIds: Id<"conversations">[] = [];
  for (let i = 0; i < 2; i += 1) {
    conversationIds.push(
      await ctx.db.insert("conversations", {
        processId,
        contributorName: "Alice Smith",
        userId,
        status: "done",
        clerkOrgId: ORG,
        analysis: { data_collection: { frequency: "" } },
      }),
    );
  }
  const source = (id: Id<"conversations">) => ({ kind: "conversation" as const, conversationId: id, label: "Alice Smith" });
  const finding = (id: string, title: string) => ({
    id,
    title,
    body: `${title} is described.`,
    evidenceLevel: "corroborated" as const,
    supportCount: 2,
    sources: conversationIds.map(source),
  });
  await ctx.db.patch(processId, {
    summaryV2: {
      schemaVersion: "v2",
      sourceMode: "interview_evidence",
      headline: "Tickets are triaged",
      executiveBrief: "Support triages tickets.",
      scope: [finding("scope-1", "Tickets arrive in Zendesk")],
      consensus: [finding("consensus-1", "Open tickets come first")],
      variations: [],
      gaps: [],
      notable: [],
      coverage: { includedSources: 2, totalEligibleSources: 2, uniqueContributors: 2, complete: true },
      provenance: { sourceSnapshotHash: "h", generatedAt: 1, promptVersion: "p", provider: "x", model: "m" },
    },
    summaryV2SourceRevision: 3,
  });

  const flowId = await ctx.db.insert("processFlows", {
    processId,
    clerkOrgId: ORG,
    status: "ready",
    stale: false,
    generatedAt: 1,
    conversationCount: 2,
    nodes: [
      { id: "triage", label: "Triage", category: "action", ...detail(["Alice, Conv. 1", "Alice, Conv. 2"]) },
      { id: "guess", label: "Guess", category: "action", ...detail(["Somebody"], "medium") },
    ],
    edges: [],
    insights: {
      criticalPath: [],
      handoffCount: 0,
      toolCount: 1,
      automationOpportunities: ["Route tickets: Route them."],
      automationOpportunitiesSource: "ai",
      automationOpportunityDetails: [
        { title: "Route tickets", kind: "workflow", nodeIds: ["triage"], rationale: "Route them.", prerequisites: [], confidence: "high" },
      ],
      topBottlenecks: [],
    },
  });

  const recId = await ctx.db.insert("processRecommendations", {
    clerkOrgId: ORG,
    processId,
    source: "v2",
    lifecycle: "active",
    title: "Route tickets",
    nodeIds: ["triage"],
    content: {
      problem: "Eleanor Price routes every ticket by hand.",
      cause: "No rule.",
      causeBasis: "inferred",
      intervention: "workflow",
      supportingInterventions: [],
      proposedChange: "Route them.",
      pilot: { what: "Try it", measure: "Fewer waits" },
      openQuestions: [],
      risks: [],
      frequency: "daily",
    },
    scores: {
      value: { level: "high", reasons: [] },
      effort: { level: "medium", reasons: [] },
      evidence: { interviews: 2, contributors: 2 },
      peopleAffected: ["Support team"],
    },
    matchKey: "triage|workflow",
    decisionStatus: "shortlisted",
    createdAt: 1,
    updatedAt: 1,
  });
  return { processId, flowId, recId };
}

describe("evidence backfill", () => {
  test("dry run reports every change and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const { processId, flowId, recId } = await t.run(seed);
    const before = await t.run(async (ctx) => ({
      process: await ctx.db.get(processId),
      flow: await ctx.db.get(flowId),
      rec: await ctx.db.get(recId),
    }));

    const report = await t.mutation(internal.evidenceBackfill.backfillProcessEvidence, {
      processId,
      dryRun: true,
    });
    expect(report!.overview.join("\n")).toContain("corroborated -> single_source");
    expect(report!.overview.join("\n")).toContain("moved to notable");
    expect(report!.steps).toEqual(['"Triage": high -> medium', '"Guess": medium -> low']);
    expect(report!.recommendations.join("\n")).toContain("value high -> medium");
    expect(report!.recommendations.join("\n")).toContain("a colleague routes every ticket");
    expect(report!.totals).toMatchObject({
      findingLevelChanges: { "corroborated -> single_source": 1 },
      findingsMovedToNotable: 1,
      stepConfidenceChanges: { "high -> medium": 1, "medium -> low": 1 },
      valueChanges: { "high -> medium": 1 },
      recommendationsWithNamesReplaced: 1,
      flowOpportunitiesChanged: 1,
    });

    const after = await t.run(async (ctx) => ({
      process: await ctx.db.get(processId),
      flow: await ctx.db.get(flowId),
      rec: await ctx.db.get(recId),
    }));
    expect(after).toEqual(before);
  });

  test("the write applies the rules, keeps decisions and revisions, schedules nothing, and is idempotent", async () => {
    const t = convexTest(schema, modules);
    const { processId, flowId, recId } = await t.run(seed);

    await t.mutation(internal.evidenceBackfill.backfillProcessEvidence, { processId, dryRun: false });

    const { process, flow, rec, scheduled } = await t.run(async (ctx) => ({
      process: await ctx.db.get(processId),
      flow: await ctx.db.get(flowId),
      rec: await ctx.db.get(recId),
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
    }));
    const overview = process!.summaryV2!;
    expect(overview.consensus).toEqual([]);
    expect(overview.notable[0]).toMatchObject({ title: "Open tickets come first", evidenceLevel: "single_source", contributorCount: 1 });
    expect(overview.scope[0].evidenceLevel).toBe("single_source");
    expect(overview.provenance.sourceSnapshotHash).toBe("h");
    expect(process!.summaryV2SourceRevision).toBe(3);
    expect(process!.rollingSummary).toContain("Open tickets come first");

    expect(flow!.stale).toBe(false);
    expect(flow!.nodes.map((n) => n.confidence)).toEqual(["medium", "low"]);
    expect(flow!.insights.automationOpportunityDetails![0].confidence).toBe("medium");

    expect(rec!.decisionStatus).toBe("shortlisted");
    expect(rec!.scores!.value.level).toBe("medium");
    expect(rec!.scores!.evidence).toEqual({ interviews: 2, contributors: 1 });
    expect(rec!.content!.problem).toBe("a colleague routes every ticket by hand.");

    expect(scheduled).toEqual([]);

    const again = await t.mutation(internal.evidenceBackfill.backfillProcessEvidence, { processId, dryRun: false });
    expect({
      overview: again!.overview,
      steps: again!.steps,
      recommendations: again!.recommendations,
      skipped: again!.skipped,
    }).toEqual({ overview: [], steps: [], recommendations: [], skipped: [] });
  });

  test("a flow whose contributions changed keeps its step values", async () => {
    const t = convexTest(schema, modules);
    const { processId, flowId } = await t.run(seed);
    await t.run(async (ctx) => {
      await ctx.db.patch(flowId, { conversationCount: 3 });
    });
    const report = await t.mutation(internal.evidenceBackfill.backfillProcessEvidence, { processId, dryRun: false });
    expect(report!.steps).toEqual([]);
    expect(report!.skipped).toHaveLength(1);
    const flow = await t.run((ctx) => ctx.db.get(flowId));
    expect(flow!.nodes[0].confidence).toBe("high");
  });
});

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { citationChecker } from "../askfabric/citationAccess";
import { citationTarget } from "../lib/citationLinks";
import { getMcpTool, toolListEntries } from "../mcp/tools";
import { MAX_BUDGET_TOKENS, parseFabricSource, sources, type AskToolResult } from "./results";

const modules = import.meta.glob("/convex/**/*.ts");
const ORG_A = "org_recs_a";
const ORG_B = "org_recs_b";
const NOW = Date.UTC(2026, 10, 10);

const NODE = {
  description: "Step",
  actors: ["Clerk"],
  tools: [],
  painPoints: [],
  automationPotential: "none" as const,
  confidence: "high" as const,
  isBottleneck: false,
  isTribalKnowledge: false,
  riskIndicators: [],
  sources: [],
};

const score = (level: "high" | "medium" | "low") => ({ level, reasons: [`${level} reason`] });

function content(intervention: "standardise" | "integration" | "training", problem: string) {
  return {
    problem,
    cause: "Nobody owns the template.",
    causeBasis: "reported" as const,
    intervention,
    supportingInterventions: [],
    proposedChange: `Change for: ${problem}`,
    pilot: { what: "Try it for two weeks.", measure: "Hours of re-keying." },
    openQuestions: ["Who signs off?"],
    risks: ["Teams keep the old sheet."],
    frequency: "daily" as const,
  };
}

async function seedOrg(ctx: MutationCtx, orgId: string, label: string) {
  const functionId = await ctx.db.insert("functions", { name: `Ops ${label}`, sortOrder: 0, clerkOrgId: orgId });
  const departmentId = await ctx.db.insert("departments", { functionId, name: `Dispatch ${label}`, sortOrder: 0, clerkOrgId: orgId });
  const processId = await ctx.db.insert("processes", { departmentId, name: `Scheduling ${label}`, sortOrder: 0, clerkOrgId: orgId });
  await ctx.db.insert("processFlows", {
    processId,
    status: "ready",
    stale: false,
    generatedAt: NOW,
    conversationCount: 1,
    nodes: [
      { id: "plan", label: "Build schedule", category: "start", ...NODE },
      { id: "rekey", label: "Re-key into ERP", category: "action", ...NODE },
    ],
    edges: [],
    insights: { criticalPath: [], handoffCount: 0, toolCount: 0, automationOpportunities: [], topBottlenecks: [] },
    clerkOrgId: orgId,
  });
  await ctx.db.insert("recommendationRuns", {
    clerkOrgId: orgId,
    processId,
    processFlowId: (await ctx.db.query("processFlows").withIndex("by_clerkOrgId_and_processId", (q) => q.eq("clerkOrgId", orgId).eq("processId", processId)).first())!._id,
    flowGenerationId: "g1",
    runId: `run-${label}`,
    status: "ready",
    trigger: "flow",
    attempts: 1,
    promptVersion: "v10",
    resultCount: 3,
    conversationCount: 1,
    createdAt: NOW,
    lastProgressAt: NOW,
    completedAt: NOW,
  });
  const row = (
    title: string,
    extra: {
      intervention?: "standardise" | "integration" | "training";
      value?: "high" | "medium" | "low";
      lifecycle?: "active" | "absent_from_latest" | "superseded";
      decisionStatus?: "new" | "shortlisted" | "dismissed" | "in_progress" | "done";
      source?: "v2" | "legacy";
    } = {},
  ) =>
    ctx.db.insert("processRecommendations", {
      clerkOrgId: orgId,
      processId,
      source: extra.source ?? "v2",
      lifecycle: extra.lifecycle ?? "active",
      title: `${title} ${label}`,
      nodeIds: ["rekey"],
      content: content(extra.intervention ?? "standardise", `${title} problem`),
      scores: { value: score(extra.value ?? "medium"), effort: score("low"), evidence: { interviews: 1, contributors: 1 }, peopleAffected: ["Clerk"] },
      matchKey: `rekey|${title}`,
      decisionStatus: extra.decisionStatus ?? "new",
      createdAt: NOW,
      updatedAt: NOW,
    });
  const standardise = await row("Standardise the sheet", { value: "medium", decisionStatus: "shortlisted" });
  const integrate = await row("Import the schedule", { intervention: "integration", value: "high" });
  const dismissed = await row("Retrain planners", { intervention: "training", value: "high", decisionStatus: "dismissed" });
  const earlier = await row("Old idea", { lifecycle: "absent_from_latest", decisionStatus: "in_progress" });
  const superseded = await row("Replaced idea", { lifecycle: "superseded" });
  return { functionId, departmentId, processId, standardise, integrate, dismissed, earlier, superseded };
}

async function setup() {
  const t = convexTest(schema, modules);
  const seeded = await t.run(async (ctx) => {
    const a = await seedOrg(ctx, ORG_A, "A");
    const b = await seedOrg(ctx, ORG_B, "B");
    const tokenIdentifier = "https://recs.test|vera";
    const userId = await ctx.db.insert("users", { tokenIdentifier, name: "vera", email: "vera@example.test", profileComplete: true });
    await ctx.db.insert("memberships", { tokenIdentifier, userId, clerkOrgId: ORG_A, role: "viewer", createdAt: NOW });
    return { a, b, viewer: { tokenIdentifier, orgId: ORG_A } };
  });
  return { t, ...seeded };
}

function text(result: AskToolResult): string {
  if (!result.found) return "";
  return result.content.map((block) => (block.type === "text" ? block.text : block.content.map((c) => c.text).join(" "))).join("\n");
}

function sourcesOf(result: AskToolResult): string[] {
  if (!result.found) return [];
  return result.content.flatMap((block) => (block.type === "search_result" ? [block.source] : []));
}

describe("getRecommendations", () => {
  test("one process: current ones in full, ranked, dismissed last, decided earlier ones kept", async () => {
    const { t, a, viewer } = await setup();
    const result = await t.query(internal.askTools.recommendations.getRecommendations, { viewer, kind: "process", id: a.processId });
    expect(result.found).toBe(true);
    const cited = sourcesOf(result).filter((source) => source.startsWith("fabric:recommendation/"));
    expect(cited).toEqual([
      sources.recommendation(a.processId, a.integrate),
      sources.recommendation(a.processId, a.standardise),
      sources.recommendation(a.processId, a.dismissed),
      sources.recommendation(a.processId, a.earlier),
    ]);
    const body = text(result);
    expect(body).toContain("3 recommendations: 2 non-technical, 1 technical.");
    expect(body).toContain("Proposed change: Change for: Import the schedule problem");
    expect(body).toContain("Steps: Re-key into ERP.");
    expect(body).toContain("Status: Shortlisted.");
    expect(body).toContain("From an earlier run");
    expect(body).not.toContain("Replaced idea");
    expect(body).not.toContain("Scheduling B");
  });

  test("the whole organization: totals, dismissed left out of the list, other orgs never read", async () => {
    const { t, a, viewer } = await setup();
    const result = await t.query(internal.askTools.recommendations.getRecommendations, { viewer, kind: "org", id: "" });
    const body = text(result);
    expect(body).toContain("1 of 1 processes have recommendations.");
    expect(body).toContain("3 recommendations: 2 non-technical, 1 technical.");
    expect(body).toMatch(/Import the schedule A — Ops A › Dispatch A › Scheduling A\..*\(recommendation #1,/);
    expect(body).not.toContain("Retrain planners A —");
    expect(body).not.toContain("Scheduling B");
    expect(sourcesOf(result)).toContain(sources.recommendation(a.processId, a.standardise));
  });

  test("a department scopes to its processes", async () => {
    const { t, a, viewer } = await setup();
    const result = await t.query(internal.askTools.recommendations.getRecommendations, { viewer, kind: "department", id: a.departmentId });
    expect(text(result)).toContain("Recommendations across this department");
  });

  test("another org's entity is not found", async () => {
    const { t, b, viewer } = await setup();
    for (const [kind, id] of [["process", b.processId], ["function", b.functionId]] as const) {
      const result = await t.query(internal.askTools.recommendations.getRecommendations, { viewer, kind, id });
      expect(result).toEqual({ found: false });
    }
  });
});

describe("rankSignals recommendation signal", () => {
  test("alone for one process, it returns that process's recommendations in full", async () => {
    const { t, a, viewer } = await setup();
    const viaSignals = await t.query(internal.askTools.signals.rankSignals, { viewer, signals: ["recommendation"], kind: "process", id: a.processId, limit: 0 });
    const direct = await t.query(internal.askTools.recommendations.getRecommendations, { viewer, kind: "process", id: a.processId });
    expect(viaSignals).toEqual(direct);
  });

  test("mixed with evidence signals across the org, it adds ranked recommendations and their totals", async () => {
    const { t, a, viewer } = await setup();
    const result = await t.query(internal.askTools.signals.rankSignals, { viewer, signals: ["bottleneck", "recommendation"], kind: "org", id: "", limit: 0 });
    const body = text(result);
    expect(body).toContain("3 recommendations: 2 non-technical, 1 technical.");
    expect(body).toContain("2 not dismissed; up to 8 are listed.");
    expect(body).toContain("Fabric's ranking: value, then lower effort");
    expect(sourcesOf(result)).toEqual(expect.arrayContaining([sources.recommendation(a.processId, a.integrate), sources.recommendation(a.processId, a.standardise)]));
    expect(sourcesOf(result)).not.toContain(sources.recommendation(a.processId, a.dismissed));
  });

  test("every signal plus many long recommendations stays within the result budget", async () => {
    const { t, a, viewer } = await setup();
    await t.run(async (ctx) => {
      const long = "Words about the problem that go on for a while. ".repeat(12);
      for (let i = 0; i < 30; i++) {
        await ctx.db.insert("processRecommendations", {
          clerkOrgId: ORG_A,
          processId: a.processId,
          source: "v2",
          lifecycle: "active",
          title: `Long recommendation number ${i} with a fairly descriptive title`,
          nodeIds: ["plan", "rekey"],
          content: { ...content("integration", long), proposedChange: long },
          scores: { value: score("high"), effort: score("medium"), evidence: { interviews: 3, contributors: 2 }, peopleAffected: [] },
          matchKey: `long-${i}`,
          decisionStatus: "new",
          createdAt: NOW,
          updatedAt: NOW,
        });
      }
    });
    const all = ["bottleneck", "friction", "gap", "handoff", "tribalKnowledge", "automationOpportunity", "manualRework", "recommendation"] as const;
    const mixed = await t.query(internal.askTools.signals.rankSignals, { viewer, signals: [...all], kind: "org", id: "", limit: 25 });
    const alone = await t.query(internal.askTools.signals.rankSignals, { viewer, signals: ["recommendation"], kind: "process", id: a.processId, limit: 0 });
    for (const result of [mixed, alone]) {
      expect(result.found && result.resultTokens).toBeLessThanOrEqual(MAX_BUDGET_TOKENS);
    }
    // The mixed list is cut at its budget; one process lists every one, briefly.
    expect(mixed.found && mixed.truncated).toBe(true);
    expect(alone.found && alone.resultCount).toBeGreaterThanOrEqual(25);
  });

  test("evidence signals alone are unchanged: no recommendations read", async () => {
    const { t, viewer } = await setup();
    const result = await t.query(internal.askTools.signals.rankSignals, { viewer, signals: ["bottleneck"], kind: "org", id: "", limit: 0 });
    expect(sourcesOf(result).some((source) => source.startsWith("fabric:recommendation/"))).toBe(false);
    expect(text(result)).not.toContain("Recommendations across");
  });
});

describe("recommendation citations", () => {
  test("parse to their process and open the Recommendations tab", () => {
    const source = sources.recommendation("p1", "r1");
    expect(parseFabricSource(source)).toEqual({ type: "recommendation", sourceKind: "process", sourceEntityId: "p1" });
    expect(
      citationTarget({ source, availability: "available", path: { fn: "f1", dept: "d1", proc: "p1" } }, { appHref: "/acme", adminUsersHref: "/acme/admin/users" }),
    ).toEqual({ kind: "link", href: "/acme?fn=f1&dept=d1&proc=p1&tab=recommendations" });
  });

  test("a superseded recommendation is updated; another org's is unavailable", async () => {
    const { t, a, b } = await setup();
    const states = await t.run(async (ctx) => {
      const check = citationChecker(ctx, ORG_A, "viewer");
      return [
        await check(sources.recommendation(a.processId, a.standardise)),
        await check(sources.recommendation(a.processId, a.superseded)),
        await check(sources.recommendation(a.processId, b.standardise as Id<"processRecommendations">)),
        await check(sources.recommendation(b.processId, b.standardise)),
      ];
    });
    expect(states).toEqual(["available", "updated", "updated", "unavailable"]);
  });
});

describe("MCP", () => {
  test("lists getRecommendations with both scope fields optional", () => {
    const entry = toolListEntries({ conversationTools: false }).find((tool) => tool.name === "getRecommendations");
    expect(entry?.inputSchema.required).toEqual([]);
    expect(getMcpTool("getRecommendations", { conversationTools: false })?.defaults).toEqual({ kind: "org", id: "" });
  });
});

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { computeChart, MAX_BARS, weekStart } from "../askCharts";
import { loadScopeEvidence } from "../askTools/evidence";
import { loadHierarchy } from "../askTools/scope";
import { collectSignals } from "../askTools/signals";

const modules = import.meta.glob("/convex/**/*.ts");
const ORG = "org_ask_charts";
const OTHER = "org_ask_charts_other";
const ISSUER = "https://ask-charts.test";

const NODE = {
  description: "d",
  actors: ["Planner"],
  tools: [] as string[],
  painPoints: [] as string[],
  automationPotential: "none" as const,
  confidence: "high" as const,
  isBottleneck: false,
  isTribalKnowledge: false,
  riskIndicators: [],
  sources: [],
};

/** Ops › (Dispatch: Scheduling with a flow and contributions, Routing without) and (Billing: Invoicing without). */
async function seed(ctx: MutationCtx, orgId: string) {
  const functionId = await ctx.db.insert("functions", { name: "Ops", sortOrder: 0, clerkOrgId: orgId });
  const dispatch = await ctx.db.insert("departments", { functionId, name: "Dispatch", sortOrder: 0, clerkOrgId: orgId });
  const billing = await ctx.db.insert("departments", { functionId, name: "Billing", sortOrder: 1, clerkOrgId: orgId });
  const scheduling = await ctx.db.insert("processes", { departmentId: dispatch, name: "Scheduling", sortOrder: 0, clerkOrgId: orgId });
  const routing = await ctx.db.insert("processes", { departmentId: dispatch, name: "Routing", sortOrder: 1, clerkOrgId: orgId });
  await ctx.db.insert("processes", { departmentId: billing, name: "Invoicing", sortOrder: 0, clerkOrgId: orgId });
  for (const status of ["done", "done", "processing"] as const) {
    await ctx.db.insert("conversations", { processId: scheduling, contributorName: "Ana", status, clerkOrgId: orgId, title: "t", summary: "s" });
  }
  await ctx.db.insert("processFlows", {
    processId: scheduling,
    status: "ready",
    stale: false,
    generatedAt: 1_700_000_000_000,
    conversationCount: 2,
    nodes: [
      { id: "plan", label: "Build schedule", category: "start", ...NODE, tools: ["ERP"], painPoints: ["Re-keying the schedule into the ERP", "Waits on sign-off"], isBottleneck: true },
      { id: "ship", label: "Dispatch", category: "end", ...NODE, actors: ["Driver"], tools: ["ERP"] },
    ],
    edges: [{ id: "e1", source: "plan", target: "ship", type: "sequential", isHappyPath: true }],
    insights: { criticalPath: [], handoffCount: 1, toolCount: 1, automationOpportunities: [], topBottlenecks: [] },
    clerkOrgId: orgId,
  });
  return { functionId, dispatch, billing, scheduling, routing };
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tokenIdentifier = `${ISSUER}|ana`;
    const userId = await ctx.db.insert("users", { tokenIdentifier, name: "ana", email: "ana@example.test", profileComplete: true });
    await ctx.db.insert("memberships", { tokenIdentifier, userId, clerkOrgId: ORG, role: "viewer", createdAt: 0 });
    return { tokenIdentifier, own: await seed(ctx, ORG), other: await seed(ctx, OTHER) };
  });
  const ana = t.withIdentity({ tokenIdentifier: ids.tokenIdentifier, subject: ids.tokenIdentifier, issuer: ISSUER, orgId: ORG, orgSlug: ORG });
  return { t, ids, ana, viewer: { tokenIdentifier: ids.tokenIdentifier, orgId: ORG } };
}

describe("charts (FR-11.2, Phase 2E)", () => {
  test("coverage by department counts processes with and without completed contributions, as getCoverage does", async () => {
    const { ids, ana } = await setup();
    const org = await ana.query(api.askCharts.getChart, { chartId: "coverageByDepartment", scope: null });
    expect(org?.rows.map((row) => [row.label, row.values])).toEqual([
      ["Dispatch", [1, 1]],
      ["Billing", [0, 1]],
    ]);
    expect(org?.rows[0].link).toMatchObject({ fn: ids.own.functionId, dept: ids.own.dispatch, proc: null });
    expect(org?.scopeName).toBe("the organization");

    const dept = await ana.query(api.askCharts.getChart, { chartId: "coverageByDepartment", scope: { kind: "department", id: ids.own.billing } });
    expect(dept?.rows.map((row) => row.label)).toEqual(["Billing"]);
  });

  test("signals by process equal T15's signal pass, per process", async () => {
    const { t, ids, ana } = await setup();
    const chart = await ana.query(api.askCharts.getChart, { chartId: "signalsByProcess", scope: null });
    const expected = await t.run(async (ctx) => {
      const hierarchy = await loadHierarchy(ctx, ORG);
      const ranked = collectSignals(new Set(["friction", "bottleneck", "handoff"] as const), await loadScopeEvidence(ctx, ORG, hierarchy.processes), []);
      return (["friction", "bottleneck", "handoff"] as const).map((signal) => ranked.get(signal)?.length ?? 0);
    });
    expect(chart?.rows).toHaveLength(1);
    expect(chart?.rows[0]).toMatchObject({ label: "Scheduling", values: expected, link: { proc: ids.own.scheduling, tab: "insights" } });
    // Two pain points, one bottleneck, one handoff (Planner → Driver).
    expect(expected).toEqual([2, 1, 1]);
  });

  test("system friction ranks systems by evidenced pain points, re-keying apart", async () => {
    const { ids, ana } = await setup();
    const chart = await ana.query(api.askCharts.getChart, { chartId: "systemFriction", scope: { kind: "process", id: ids.own.scheduling } });
    expect(chart?.rows).toEqual([
      { label: "ERP", values: [1, 1], link: expect.objectContaining({ proc: ids.own.scheduling, tab: "flow", node: "plan" }) },
    ]);
  });

  test("the contributions timeline counts completed contributions by recorded week", async () => {
    const { ana } = await setup();
    const chart = await ana.query(api.askCharts.getChart, { chartId: "contributionsOverTime", scope: null });
    expect(chart?.rows.reduce((sum, row) => sum + row.values[0], 0)).toBe(2);
    expect(chart?.type).toBe("timeline");
    expect(new Date(weekStart(Date.UTC(2026, 10, 6, 15))).toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(new Date(weekStart(Date.UTC(2026, 10, 2))).toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  test("bars stop at the cap and count the rest", async () => {
    const { t } = await setup();
    const chart = await t.run(async (ctx) => {
      const functionId = await ctx.db.insert("functions", { name: "Big", sortOrder: 5, clerkOrgId: ORG });
      for (let i = 0; i < MAX_BARS + 3; i++) {
        const departmentId = await ctx.db.insert("departments", { functionId, name: `D${i}`, sortOrder: i, clerkOrgId: ORG });
        await ctx.db.insert("processes", { departmentId, name: `P${i}`, sortOrder: 0, clerkOrgId: ORG });
      }
      return await computeChart(ctx, ORG, "coverageByDepartment", { kind: "function", id: functionId });
    });
    expect(chart?.rows).toHaveLength(MAX_BARS);
    expect(chart?.more).toBe(3);
  });

  test("another org's scope, or a stranger, gets nothing", async () => {
    const { t, ids, ana } = await setup();
    expect(await ana.query(api.askCharts.getChart, { chartId: "coverageByDepartment", scope: { kind: "function", id: ids.other.functionId } })).toBeNull();
    const stranger = t.withIdentity({ tokenIdentifier: `${ISSUER}|x`, subject: "x", issuer: ISSUER, orgId: ORG, orgSlug: ORG });
    await expect(stranger.query(api.askCharts.getChart, { chartId: "coverageByDepartment", scope: null })).rejects.toThrow();
  });

  test("show places a chart for a grounded scope or the whole org, and nothing without data", async () => {
    const { t, ids, viewer } = await setup();
    const show = (kind: "coverageByDepartment" | "systemFriction", refs: string[], allowed: string[] = refs) =>
      t.query(internal.askTools.display.show, { kind, viewer, allowed, refs, nodeId: "" });

    const org = await show("coverageByDepartment", []);
    expect(org.part).toEqual({ type: "display", display: "chart", chartId: "coverageByDepartment", refs: [] });
    expect(org.note).toContain("the whole organization");
    expect(org.note).not.toMatch(/\d/);

    const scoped = await show("coverageByDepartment", [ids.own.functionId]);
    expect(scoped.part).toMatchObject({ chartId: "coverageByDepartment", refs: [{ kind: "function", id: ids.own.functionId }] });

    // Not grounded, another org's, or a scope with no data.
    expect((await show("coverageByDepartment", [ids.own.functionId], [])).part).toBeNull();
    expect((await show("coverageByDepartment", [ids.other.functionId])).part).toBeNull();
    expect((await show("systemFriction", [ids.own.routing])).part).toBeNull();
  });
});

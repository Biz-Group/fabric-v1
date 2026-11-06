/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { SUMMARY_V2_PROMPT_VERSIONS, type ProcessOverviewArtifactV2 } from "../summaryV2";
import { flowNeighbourhood, MAX_NEIGHBOURS } from "../lib/flowNeighbourhood";

const modules = import.meta.glob("/convex/**/*.ts");
const ORG = "org_ask_display";
const OTHER = "org_ask_display_other";
const ISSUER = "https://ask-display.test";
const saved = process.env.SUMMARY_V2;

const overview: ProcessOverviewArtifactV2 = {
  schemaVersion: "v2",
  sourceMode: "interview_evidence",
  headline: "Scheduling waits on manual sign-off",
  executiveBrief: "b",
  scope: [],
  consensus: [],
  variations: [],
  gaps: [],
  notable: [],
  coverage: { includedSources: 2, totalEligibleSources: 2, complete: true },
  provenance: { sourceSnapshotHash: "x", generatedAt: 1, promptVersion: SUMMARY_V2_PROMPT_VERSIONS.processOverview, provider: "p", model: "m" },
};

const NODE = {
  description: "d",
  actors: [],
  tools: [],
  painPoints: [],
  automationPotential: "none" as const,
  confidence: "high" as const,
  isBottleneck: false,
  isTribalKnowledge: false,
  riskIndicators: [],
  sources: [],
};

/** start → check (a decision) → approve (Yes, the happy path) or reject (No); lone stands apart. */
const FLOW = {
  nodes: [
    { id: "start", label: "Request arrives", category: "start" as const, ...NODE },
    { id: "check", label: "Check the slot", category: "decision" as const, ...NODE },
    { id: "reject", label: "Send it back", category: "end" as const, ...NODE },
    { id: "approve", label: "Book the slot", category: "end" as const, ...NODE },
    { id: "lone", label: "Ad hoc call", category: "action" as const, ...NODE },
  ],
  edges: [
    { id: "e1", source: "start", target: "check", type: "sequential" as const, isHappyPath: true },
    { id: "e2", source: "check", target: "reject", type: "conditional" as const, label: "No", isHappyPath: false },
    { id: "e3", source: "check", target: "approve", type: "conditional" as const, label: "Yes", isHappyPath: true },
  ],
};

async function hierarchy(ctx: MutationCtx, orgId: string) {
  const functionId = await ctx.db.insert("functions", { name: "Ops", sortOrder: 0, clerkOrgId: orgId });
  const departmentId = await ctx.db.insert("departments", { functionId, name: "Dispatch", sortOrder: 0, clerkOrgId: orgId });
  const processId = await ctx.db.insert("processes", { departmentId, name: "Scheduling", sortOrder: 0, clerkOrgId: orgId, summaryV2: overview });
  await ctx.db.insert("processes", { departmentId, name: "Routing", sortOrder: 1, clerkOrgId: orgId });
  for (const status of ["done", "done", "processing"] as const) {
    await ctx.db.insert("conversations", { processId, contributorName: "Ana", status, clerkOrgId: orgId, title: "t", summary: "s" });
  }
  await ctx.db.insert("processFlows", {
    processId,
    status: "ready",
    stale: true,
    generatedAt: 1_700_000_000_000,
    conversationCount: 2,
    ...FLOW,
    insights: { criticalPath: [], handoffCount: 0, toolCount: 0, automationOpportunities: [], topBottlenecks: [] },
    clerkOrgId: orgId,
  });
  return { functionId, departmentId, processId };
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const tokenIdentifier = `${ISSUER}|ana`;
    const userId = await ctx.db.insert("users", { tokenIdentifier, name: "ana", email: "ana@example.test", profileComplete: true });
    await ctx.db.insert("memberships", { tokenIdentifier, userId, clerkOrgId: ORG, role: "viewer", createdAt: 0 });
    return { tokenIdentifier, own: await hierarchy(ctx, ORG), other: await hierarchy(ctx, OTHER) };
  });
  const ana = t.withIdentity({ tokenIdentifier: ids.tokenIdentifier, subject: ids.tokenIdentifier, issuer: ISSUER, orgId: ORG, orgSlug: ORG });
  return { t, ids, ana };
}

beforeEach(() => {
  process.env.SUMMARY_V2 = ORG;
});

afterEach(() => {
  if (saved === undefined) delete process.env.SUMMARY_V2;
  else process.env.SUMMARY_V2 = saved;
});

describe("entity cards (D56, Phase 2D.1)", () => {
  test("show each entity's live counts, path and headline, in the order given", async () => {
    const { ids, ana } = await setup();
    const { functionId, departmentId, processId } = ids.own;
    const cards = await ana.query(api.askDisplay.getEntityCards, {
      refs: [
        { kind: "process", id: processId },
        { kind: "department", id: departmentId },
        { kind: "function", id: functionId },
      ],
    });
    expect(cards.map((card) => card.kind)).toEqual(["process", "department", "function"]);
    expect(cards[0]).toMatchObject({
      name: "Scheduling",
      trail: ["Ops", "Dispatch"],
      path: { fn: functionId, dept: departmentId, proc: processId },
      headline: "Scheduling waits on manual sign-off",
      // Completed contributions only, as the workbench counts them.
      contributions: 2,
    });
    expect(cards[1]).toMatchObject({ trail: ["Ops"], processes: 2, contributions: null });
    expect(cards[2]).toMatchObject({ trail: [], departments: 1, processes: 2 });
  });

  test("leave out another org's entities, deleted ones and repeats, silently", async () => {
    const { t, ids, ana } = await setup();
    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert("processes", { departmentId: ids.own.departmentId, name: "Gone", sortOrder: 2, clerkOrgId: ORG });
      await ctx.db.delete(id);
      return id;
    });
    const cards = await ana.query(api.askDisplay.getEntityCards, {
      refs: [
        { kind: "process", id: ids.other.processId },
        { kind: "process", id: ids.own.processId },
        { kind: "process", id: ids.own.processId },
        { kind: "process", id: gone },
      ],
    });
    expect(cards.map((card) => card.id)).toEqual([ids.own.processId]);
  });

  test("withhold the overview headline where SUMMARY_V2 is off for the org", async () => {
    const { ids, ana } = await setup();
    process.env.SUMMARY_V2 = "off";
    const [card] = await ana.query(api.askDisplay.getEntityCards, { refs: [{ kind: "process", id: ids.own.processId }] });
    expect(card.headline).toBeNull();
  });

  test("show entities keeps only grounded, readable entities, as the viewer (FR-9.1)", async () => {
    const { t, ids } = await setup();
    const viewer = { tokenIdentifier: ids.tokenIdentifier, orgId: ORG };
    const { processId, departmentId } = ids.own;
    const result = await t.query(internal.askTools.display.show, { kind: "entities", nodeId: "",
      viewer,
      allowed: [processId, departmentId, ids.other.processId],
      // Bare ids: each one's kind comes from its table.
      refs: [
        processId,
        // Grounded, but another org's: still dropped.
        ids.other.processId,
        // Readable, but no tool returned it.
        ids.own.functionId,
        ` ${departmentId} `,
        "not-an-id",
      ],
    });
    expect(result.part).toEqual({
      type: "display",
      display: "entities",
      refs: [
        { kind: "process", id: processId },
        { kind: "department", id: departmentId },
      ],
    });
    expect(result.note).toContain("2 cards (Scheduling, Dispatch)");
    expect(result.note).toContain("3 left out");

    const none = await t.query(internal.askTools.display.show, { kind: "entities", nodeId: "", viewer, allowed: [], refs: [processId] });
    expect(none.part).toBeNull();

    await expect(
      t.query(internal.askTools.display.show, { kind: "entities", nodeId: "",
        viewer: { tokenIdentifier: `${ISSUER}|x`, orgId: ORG },
        allowed: [processId],
        refs: [processId],
      }),
    ).rejects.toThrow();
  });

  test("show choices offers 2 to 5 grounded options, and nothing for fewer (FR-11.4)", async () => {
    const { t, ids } = await setup();
    const viewer = { tokenIdentifier: ids.tokenIdentifier, orgId: ORG };
    const extra = await t.run(async (ctx) =>
      Promise.all(
        ["A", "B", "C", "D", "E"].map((name, i) =>
          ctx.db.insert("processes", { departmentId: ids.own.departmentId, name: `Scheduling ${name}`, sortOrder: 10 + i, clerkOrgId: ORG }),
        ),
      ),
    );
    const refs: string[] = [ids.own.processId, ...extra];
    const many = await t.query(internal.askTools.display.show, { kind: "choices", nodeId: "", viewer, allowed: refs, refs });
    expect(many.part).toMatchObject({ display: "choices" });
    expect(many.part!.refs).toHaveLength(5);
    expect(many.note).toContain("don't answer for them");

    const one = await t.query(internal.askTools.display.show, { kind: "choices", nodeId: "",
      viewer,
      allowed: [ids.own.processId, ids.other.processId],
      refs: [ids.own.processId, ids.other.processId],
    });
    expect(one.part).toBeNull();
  });

  test("show contribute shows only to contributors and admins, for a grounded process (FR-11.5)", async () => {
    const { t, ids } = await setup();
    const args = { allowed: [ids.own.processId], refs: [ids.own.processId] };
    const asViewer = await t.query(internal.askTools.display.show, { kind: "contribute", nodeId: "", ...args, viewer: { tokenIdentifier: ids.tokenIdentifier, orgId: ORG } });
    expect(asViewer.part).toBeNull();
    expect(asViewer.note).toContain("can't add contributions");

    for (const role of ["contributor", "admin"] as const) {
      const tokenIdentifier = `${ISSUER}|${role}`;
      await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { tokenIdentifier, name: role, email: `${role}@example.test`, profileComplete: true });
        await ctx.db.insert("memberships", { tokenIdentifier, userId, clerkOrgId: ORG, role, createdAt: 0 });
      });
      const viewer = { tokenIdentifier, orgId: ORG };
      const shown = await t.query(internal.askTools.display.show, { kind: "contribute", nodeId: "", ...args, viewer });
      expect(shown.part, role).toEqual({ type: "display", display: "contribute", refs: [{ kind: "process", id: ids.own.processId }] });
      // Not grounded, or another org's: nothing.
      const contribute = (allowed: string[], id: string) =>
        t.query(internal.askTools.display.show, { kind: "contribute", nodeId: "", viewer, allowed, refs: [id] });
      expect((await contribute([], ids.own.processId)).part).toBeNull();
      expect((await contribute([ids.other.processId], ids.other.processId)).part).toBeNull();
      // A department isn't something to contribute to.
      const dept = await t.query(internal.askTools.display.show, {
        kind: "contribute", nodeId: "",
        viewer,
        allowed: [ids.own.departmentId],
        refs: [ids.own.departmentId],
      });
      expect(dept.part).toBeNull();
    }
  });

  test("show flow keeps a grounded process's step that is in its current flow (FR-11.3)", async () => {
    const { t, ids } = await setup();
    const viewer = { tokenIdentifier: ids.tokenIdentifier, orgId: ORG };
    const { processId } = ids.own;
    const flow = (nodeId: string, allowed: string[] = [processId], id: string = processId) =>
      t.query(internal.askTools.display.show, { kind: "flow", viewer, allowed, nodeId, refs: [id] });

    const shown = await flow(" check ");
    expect(shown.part).toEqual({ type: "display", display: "flow", refs: [{ kind: "process", id: processId }], nodeId: "check" });
    expect(shown.note).toContain('"Check the slot"');

    // No step, a step the flow doesn't have, a process no tool returned, another org's.
    expect((await flow("")).part).toBeNull();
    const missing = await flow("gone");
    expect(missing.part).toBeNull();
    expect(missing.note).toContain("no step with that id");
    expect((await flow("check", [])).part).toBeNull();
    expect((await flow("check", [ids.other.processId], ids.other.processId)).part).toBeNull();
  });

  test("the flow neighbourhood gives the steps either side, happy path first, as the viewer", async () => {
    const { t, ids, ana } = await setup();
    const { functionId, departmentId, processId } = ids.own;
    const around = await ana.query(api.processFlows.getFlowNeighbourhood, { processId, nodeId: "check" });
    expect(around).toMatchObject({
      processName: "Scheduling",
      path: { fn: functionId, dept: departmentId, proc: processId },
      step: { id: "check", label: "Check the slot", category: "decision" },
      before: [{ id: "start", edgeLabel: null }],
      after: [
        { id: "approve", edgeLabel: "Yes" },
        { id: "reject", edgeLabel: "No" },
      ],
      moreBefore: 0,
      moreAfter: 0,
      stale: true,
    });

    // A step with no neighbours still shows; one the flow no longer has, or another org's flow, gives nothing.
    expect(await ana.query(api.processFlows.getFlowNeighbourhood, { processId, nodeId: "lone" })).toMatchObject({ before: [], after: [] });
    expect(await ana.query(api.processFlows.getFlowNeighbourhood, { processId, nodeId: "gone" })).toBeNull();
    expect(await ana.query(api.processFlows.getFlowNeighbourhood, { processId: ids.other.processId, nodeId: "check" })).toBeNull();
    await t.run(async (ctx) => {
      const row = await ctx.db.query("processFlows").withIndex("by_clerkOrgId_and_processId", (q) => q.eq("clerkOrgId", ORG).eq("processId", processId)).first();
      await ctx.db.delete(row!._id);
    });
    expect(await ana.query(api.processFlows.getFlowNeighbourhood, { processId, nodeId: "check" })).toBeNull();
  });

  test("the flow neighbourhood caps each side and counts the rest", () => {
    const fan = Array.from({ length: MAX_NEIGHBOURS + 2 }, (_, i) => `n${i}`);
    const around = flowNeighbourhood(
      {
        nodes: [
          { id: "hub", label: "Hub", category: "action", ...NODE },
          ...fan.map((id) => ({ id, label: id, category: "action" as const, ...NODE })),
        ],
        edges: [
          ...fan.map((id) => ({ id: `e-${id}`, source: "hub", target: id, type: "parallel" as const, isHappyPath: false })),
          // A repeat and a self-loop add nothing.
          { id: "dup", source: "hub", target: "n0", type: "sequential" as const, isHappyPath: false },
          { id: "self", source: "hub", target: "hub", type: "sequential" as const, isHappyPath: false },
        ],
      },
      "hub",
    );
    expect(around?.after).toHaveLength(MAX_NEIGHBOURS);
    expect(around?.moreAfter).toBe(2);
    expect(around?.before).toEqual([]);
  });

  test("refuse a caller who isn't a member", async () => {
    const { t, ids } = await setup();
    const stranger = t.withIdentity({ tokenIdentifier: `${ISSUER}|x`, subject: "x", issuer: ISSUER, orgId: ORG, orgSlug: ORG });
    await expect(
      stranger.query(api.askDisplay.getEntityCards, { refs: [{ kind: "process", id: ids.own.processId }] }),
    ).rejects.toThrow();
  });
});

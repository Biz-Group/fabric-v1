/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { SUMMARY_V2_PROMPT_VERSIONS, type ProcessOverviewArtifactV2 } from "../summaryV2";

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

async function hierarchy(ctx: MutationCtx, orgId: string) {
  const functionId = await ctx.db.insert("functions", { name: "Ops", sortOrder: 0, clerkOrgId: orgId });
  const departmentId = await ctx.db.insert("departments", { functionId, name: "Dispatch", sortOrder: 0, clerkOrgId: orgId });
  const processId = await ctx.db.insert("processes", { departmentId, name: "Scheduling", sortOrder: 0, clerkOrgId: orgId, summaryV2: overview });
  await ctx.db.insert("processes", { departmentId, name: "Routing", sortOrder: 1, clerkOrgId: orgId });
  for (const status of ["done", "done", "processing"] as const) {
    await ctx.db.insert("conversations", { processId, contributorName: "Ana", status, clerkOrgId: orgId, title: "t", summary: "s" });
  }
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

  test("refuse a caller who isn't a member", async () => {
    const { t, ids } = await setup();
    const stranger = t.withIdentity({ tokenIdentifier: `${ISSUER}|x`, subject: "x", issuer: ISSUER, orgId: ORG, orgSlug: ORG });
    await expect(
      stranger.query(api.askDisplay.getEntityCards, { refs: [{ kind: "process", id: ids.own.processId }] }),
    ).rejects.toThrow();
  });
});

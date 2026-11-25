/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx } from "./_generated/server";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_flow_stale_cleanup";

const FLOW_READ_OVERVIEW_AT = 1_786_000_000_000;
const FLOW_BUILT_AT = FLOW_READ_OVERVIEW_AT + 60_000;

function overview(hash: string): NonNullable<Doc<"processes">["summaryV2"]> {
  return {
    schemaVersion: "v2",
    sourceMode: "interview_evidence",
    headline: "Synthetic overview",
    executiveBrief: "A synthetic overview used only by this test.",
    scope: [],
    consensus: [],
    variations: [],
    gaps: [],
    notable: [],
    coverage: { includedSources: 2, totalEligibleSources: 2, complete: true },
    provenance: {
      sourceSnapshotHash: hash,
      generatedAt: FLOW_BUILT_AT + 5_000,
      promptVersion: "summary-v2-process-overview-v1",
      provider: "fabric-foundry",
      model: "test-model",
    },
  };
}

/**
 * The shape the old rule produced: a flow holding both contributions, built
 * from overview "read", flagged once overview "current" published.
 */
async function seedFlaggedFlow(
  ctx: MutationCtx,
  options: {
    flowCount?: number;
    snapshot?: boolean;
    currentHash?: string;
  } = {},
): Promise<{ processId: Id<"processes">; conversationIds: Id<"conversations">[] }> {
  const functionId = await ctx.db.insert("functions", {
    name: "Function",
    sortOrder: 0,
    clerkOrgId: ORG,
  });
  const departmentId = await ctx.db.insert("departments", {
    functionId,
    name: "Department",
    sortOrder: 0,
    clerkOrgId: ORG,
  });
  const processId = await ctx.db.insert("processes", {
    departmentId,
    name: "Process",
    sortOrder: 0,
    clerkOrgId: ORG,
    summaryV2: overview(options.currentHash ?? "current"),
  });
  const conversationIds: Id<"conversations">[] = [];
  for (const name of ["Alice", "Bob"]) {
    conversationIds.push(
      await ctx.db.insert("conversations", {
        processId,
        contributorName: name,
        status: "done",
        clerkOrgId: ORG,
      }),
    );
  }
  await ctx.db.insert("processFlows", {
    processId,
    clerkOrgId: ORG,
    status: "ready",
    stale: true,
    generatedAt: FLOW_BUILT_AT,
    conversationCount: options.flowCount ?? 2,
    ...(options.snapshot === false
      ? {}
      : {
          summarySourceSnapshot: {
            sourceSnapshotHash: "read",
            summaryGeneratedAt: FLOW_READ_OVERVIEW_AT,
            summaryPromptVersion: "summary-v2-process-overview-v1",
          },
        }),
    nodes: [],
    edges: [],
    insights: {
      criticalPath: [],
      handoffCount: 0,
      toolCount: 0,
      automationOpportunities: [],
      topBottlenecks: [],
    },
  });
  return { processId, conversationIds };
}

async function clearable(t: ReturnType<typeof convexTest>) {
  const result = await t.query(internal.migrations.listFalseFlowStaleFlags, {
    cursor: null,
  });
  return result.clearable.map((row) => row.processId);
}

async function seedActor(ctx: MutationCtx): Promise<Id<"users">> {
  return await ctx.db.insert("users", {
    tokenIdentifier: "test|actor",
    name: "Admin",
    email: "admin@example.test",
    profileComplete: true,
  });
}

describe("clearing false flow stale flags", () => {
  test("a flag the old overview rule raised on a complete flow is cleared", async () => {
    const t = convexTest(schema, modules);
    const { processId } = await t.run((ctx) => seedFlaggedFlow(ctx));
    expect(await clearable(t)).toEqual([processId]);
  });

  test("a flow missing a contribution keeps its flag", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => seedFlaggedFlow(ctx, { flowCount: 1 }));
    expect(await clearable(t)).toEqual([]);
  });

  test("a legacy flow with no overview snapshot keeps its flag", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => seedFlaggedFlow(ctx, { snapshot: false }));
    expect(await clearable(t)).toEqual([]);
  });

  test("a flow whose overview has not changed keeps its flag", async () => {
    // Flagged for some other reason, such as removed evidence.
    const t = convexTest(schema, modules);
    await t.run((ctx) => seedFlaggedFlow(ctx, { currentHash: "read" }));
    expect(await clearable(t)).toEqual([]);
  });

  test("a deletion since the overview the flow read keeps the flag", async () => {
    // Delete one and add one: counts agree, but the flow may still carry the
    // deleted contribution through the overview it read.
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { processId, conversationIds } = await seedFlaggedFlow(ctx);
      await ctx.db.insert("conversationDeletions", {
        clerkOrgId: ORG,
        conversationId: conversationIds[0],
        processId,
        processLabel: "Process",
        contributorName: "Carol",
        inputMode: "agent",
        status: "done",
        recordedAt: FLOW_READ_OVERVIEW_AT - 1_000,
        reason: "Test recording",
        actorUserId: await seedActor(ctx),
        actorName: "Admin",
        createdAt: FLOW_READ_OVERVIEW_AT + 1_000,
      });
    });
    expect(await clearable(t)).toEqual([]);
  });

  test("a move out of the process since then keeps the flag", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { processId, conversationIds } = await seedFlaggedFlow(ctx);
      const other = await ctx.db.insert("processes", {
        departmentId: (await ctx.db.get(processId))!.departmentId,
        name: "Other",
        sortOrder: 1,
        clerkOrgId: ORG,
      });
      await ctx.db.insert("conversationMoves", {
        clerkOrgId: ORG,
        conversationId: conversationIds[0],
        fromProcessId: processId,
        toProcessId: other,
        fromLabel: "Process",
        toLabel: "Other",
        actorUserId: await seedActor(ctx),
        actorName: "Admin",
        createdAt: FLOW_READ_OVERVIEW_AT + 1_000,
      });
    });
    expect(await clearable(t)).toEqual([]);
  });

  test("a deletion before the overview the flow read does not block clearing", async () => {
    // That overview was already rebuilt without the deleted contribution.
    const t = convexTest(schema, modules);
    const processId = await t.run(async (ctx) => {
      const { processId, conversationIds } = await seedFlaggedFlow(ctx);
      await ctx.db.insert("conversationDeletions", {
        clerkOrgId: ORG,
        conversationId: conversationIds[0],
        processId,
        processLabel: "Process",
        contributorName: "Carol",
        inputMode: "agent",
        status: "done",
        recordedAt: FLOW_READ_OVERVIEW_AT - 10_000,
        reason: "Test recording",
        actorUserId: await seedActor(ctx),
        actorName: "Admin",
        createdAt: FLOW_READ_OVERVIEW_AT - 5_000,
      });
      return processId;
    });
    expect(await clearable(t)).toEqual([processId]);
  });
});

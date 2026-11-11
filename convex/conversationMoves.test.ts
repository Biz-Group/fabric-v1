/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ORG_A = "org_move_a";
const ORG_B = "org_move_b";
const ISSUER = "https://test.clerk";

type Harness = ReturnType<typeof convexTest>;
type Role = "admin" | "contributor" | "viewer";

function identityFor(user: Role, orgId = ORG_A) {
  return {
    tokenIdentifier: `${ISSUER}|${user}`,
    subject: user,
    issuer: ISSUER,
    name: user,
    email: `${user}@example.test`,
    orgId,
    orgSlug: orgId === ORG_A ? "move-a" : "move-b",
  };
}

/**
 * Two functions, each with one department and one process, so a move between
 * them crosses both department and function boundaries.
 */
async function seedOrg(t: Harness) {
  return await t.run(async (ctx) => {
    const users = {} as Record<Role, Id<"users">>;
    for (const role of ["admin", "contributor", "viewer"] as const) {
      users[role] = await ctx.db.insert("users", {
        tokenIdentifier: `${ISSUER}|${role}`,
        name: role === "admin" ? "Ada Admin" : role,
        email: `${role}@example.test`,
        profileComplete: true,
      });
      await ctx.db.insert("memberships", {
        tokenIdentifier: `${ISSUER}|${role}`,
        userId: users[role],
        clerkOrgId: ORG_A,
        role,
        createdAt: Date.now(),
      });
    }

    const opsId = await ctx.db.insert("functions", {
      name: "Operations",
      sortOrder: 0,
      clerkOrgId: ORG_A,
    });
    const payrollId = await ctx.db.insert("departments", {
      functionId: opsId,
      name: "Payroll",
      sortOrder: 0,
      clerkOrgId: ORG_A,
    });
    const sourceId = await ctx.db.insert("processes", {
      departmentId: payrollId,
      name: "Monthly payroll",
      sortOrder: 0,
      clerkOrgId: ORG_A,
    });

    const financeId = await ctx.db.insert("functions", {
      name: "Finance",
      sortOrder: 1,
      clerkOrgId: ORG_A,
    });
    const apId = await ctx.db.insert("departments", {
      functionId: financeId,
      name: "Payables",
      sortOrder: 0,
      clerkOrgId: ORG_A,
    });
    const targetId = await ctx.db.insert("processes", {
      departmentId: apId,
      name: "Supplier payments",
      sortOrder: 0,
      clerkOrgId: ORG_A,
    });

    // Another tenant's process, for isolation checks.
    const otherFn = await ctx.db.insert("functions", {
      name: "Other",
      sortOrder: 0,
      clerkOrgId: ORG_B,
    });
    const otherDept = await ctx.db.insert("departments", {
      functionId: otherFn,
      name: "Other",
      sortOrder: 0,
      clerkOrgId: ORG_B,
    });
    const otherOrgProcessId = await ctx.db.insert("processes", {
      departmentId: otherDept,
      name: "Other org process",
      sortOrder: 0,
      clerkOrgId: ORG_B,
    });

    return {
      users,
      opsId,
      payrollId,
      sourceId,
      financeId,
      apId,
      targetId,
      otherOrgProcessId,
    };
  });
}

async function insertConversation(
  t: Harness,
  processId: Id<"processes">,
  overrides: Partial<Doc<"conversations">> = {},
): Promise<Id<"conversations">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("conversations", {
      processId,
      clerkOrgId: ORG_A,
      contributorName: "Contributor",
      status: "done",
      summary: "Done conversation summary.",
      ...overrides,
    }),
  );
}

async function insertReadyFlow(
  t: Harness,
  processId: Id<"processes">,
  conversationCount: number,
): Promise<Id<"processFlows">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("processFlows", {
      processId,
      clerkOrgId: ORG_A,
      status: "ready",
      stale: false,
      generatedAt: Date.now(),
      conversationCount,
      nodes: [],
      edges: [],
      insights: {
        criticalPath: [],
        handoffCount: 0,
        toolCount: 0,
        automationOpportunities: [],
        topBottlenecks: [],
      },
    }),
  );
}

async function scheduledNames(t: Harness): Promise<string[]> {
  return await t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).map(
      (job) => job.name,
    ),
  );
}

/** The `userError` code a rejected call carried. */
async function rejectionCode(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
  } catch (error) {
    let data = (error as { data?: unknown }).data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return null;
      }
    }
    return (data as { code?: string } | undefined)?.code ?? null;
  }
  throw new Error("Expected the call to be rejected");
}

describe("conversations.moveForAdmin", () => {
  test("is admin-only", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrg(t);
    const conversationId = await insertConversation(t, ids.sourceId);

    for (const role of ["contributor", "viewer"] as const) {
      await expect(
        t.withIdentity(identityFor(role)).mutation(api.conversations.moveForAdmin, {
          conversationId,
          targetProcessId: ids.targetId,
        }),
      ).rejects.toThrow();
    }
    const row = await t.run((ctx) => ctx.db.get(conversationId));
    expect(row?.processId).toBe(ids.sourceId);
  });

  test("refuses another org's process, the same process, and unfinished rows", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrg(t);
    const admin = t.withIdentity(identityFor("admin"));
    const doneId = await insertConversation(t, ids.sourceId);

    expect(
      await rejectionCode(
        admin.mutation(api.conversations.moveForAdmin, {
          conversationId: doneId,
          targetProcessId: ids.otherOrgProcessId,
        }),
      ),
    ).toBe("NOT_FOUND");
    expect(
      await rejectionCode(
        admin.mutation(api.conversations.moveForAdmin, {
          conversationId: doneId,
          targetProcessId: ids.sourceId,
        }),
      ),
    ).toBe("SAME_PROCESS");

    for (const status of ["processing", "needs_speaker_labels", "failed"] as const) {
      const id = await insertConversation(t, ids.sourceId, { status });
      expect(
        await rejectionCode(
          admin.mutation(api.conversations.moveForAdmin, {
            conversationId: id,
            targetProcessId: ids.targetId,
          }),
        ),
      ).toBe("NOT_MOVABLE");
      const row = await t.run((ctx) => ctx.db.get(id));
      expect(row?.processId).toBe(ids.sourceId);
    }

    const moves = await t.run((ctx) => ctx.db.query("conversationMoves").collect());
    expect(moves).toHaveLength(0);
  });

  test("an admin of another org cannot move this org's contribution", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrg(t);
    const conversationId = await insertConversation(t, ids.sourceId);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: `${ISSUER}|admin-b`,
        name: "Admin B",
        email: "admin-b@example.test",
        profileComplete: true,
      });
      await ctx.db.insert("memberships", {
        tokenIdentifier: `${ISSUER}|admin-b`,
        userId,
        clerkOrgId: ORG_B,
        role: "admin",
        createdAt: Date.now(),
      });
    });

    const code = await rejectionCode(
      t
        .withIdentity({
          ...identityFor("admin", ORG_B),
          tokenIdentifier: `${ISSUER}|admin-b`,
          subject: "admin-b",
        })
        .mutation(api.conversations.moveForAdmin, {
          conversationId,
          targetProcessId: ids.otherOrgProcessId,
        }),
    );
    expect(code).toBe("NOT_FOUND");
    const row = await t.run((ctx) => ctx.db.get(conversationId));
    expect(row?.processId).toBe(ids.sourceId);
  });

  test("moving the only finished contribution clears the source and starts the empty target", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrg(t);
    const conversationId = await insertConversation(t, ids.sourceId);
    const sourceFlowId = await insertReadyFlow(t, ids.sourceId, 1);
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.sourceId, { rollingSummary: "Source summary" });
      await ctx.db.patch(ids.payrollId, {
        summary: "Payroll summary",
        summaryStale: false,
      });
      await ctx.db.patch(ids.apId, { summaryStale: false });
      await ctx.db.patch(ids.financeId, { summaryStale: false });
    });

    const result = await t
      .withIdentity(identityFor("admin"))
      .mutation(api.conversations.moveForAdmin, {
        conversationId,
        targetProcessId: ids.targetId,
      });
    expect(result).toEqual({
      processId: ids.targetId,
      departmentId: ids.apId,
      functionId: ids.financeId,
    });

    const rows = await t.run(async (ctx) => ({
      conversation: await ctx.db.get(conversationId),
      source: await ctx.db.get(ids.sourceId),
      sourceFlow: await ctx.db.get(sourceFlowId),
      payroll: await ctx.db.get(ids.payrollId),
      ops: await ctx.db.get(ids.opsId),
      ap: await ctx.db.get(ids.apId),
      finance: await ctx.db.get(ids.financeId),
    }));
    expect(rows.conversation?.processId).toBe(ids.targetId);
    // Source: no evidence left, so cleared like a delete.
    expect(rows.source?.rollingSummary).toBeUndefined();
    expect(rows.sourceFlow).toBeNull();
    expect(rows.payroll?.summary).toBeUndefined();
    expect(rows.ops?.summaryStale).toBe(true);
    // Target: both parents go stale.
    expect(rows.ap?.summaryStale).toBe(true);
    expect(rows.finance?.summaryStale).toBe(true);

    // The target had nothing, so both of its pipelines start (D2).
    const names = await scheduledNames(t);
    expect(names.some((n) => n.includes("requestProcessSummaryRebuild"))).toBe(true);
    expect(names.some((n) => n.includes("requestFlowGeneration"))).toBe(true);
  });

  test("moving one of several marks both processes stale and rebuilds nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrg(t);
    const movedId = await insertConversation(t, ids.sourceId, {
      processSummaryInput: "## Steps\n1. Cached record",
      processSummaryInputHash: "cached-hash",
    });
    await insertConversation(t, ids.sourceId);
    await insertConversation(t, ids.targetId);
    // Moving out lowers the count, which the read-side heuristic alone
    // would never flag, so the source flow must be marked explicitly.
    const sourceFlowId = await insertReadyFlow(t, ids.sourceId, 2);
    const targetFlowId = await insertReadyFlow(t, ids.targetId, 1);
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.sourceId, {
        rollingSummary: "Source summary",
        summaryEvidenceRevision: 4,
      });
      await ctx.db.patch(ids.targetId, { rollingSummary: "Target summary" });
      await ctx.db.patch(ids.payrollId, { summaryStale: false });
      await ctx.db.patch(ids.apId, { summaryStale: false });
    });

    await t
      .withIdentity(identityFor("admin"))
      .mutation(api.conversations.moveForAdmin, {
        conversationId: movedId,
        targetProcessId: ids.targetId,
      });

    const rows = await t.run(async (ctx) => ({
      moved: await ctx.db.get(movedId),
      source: await ctx.db.get(ids.sourceId),
      target: await ctx.db.get(ids.targetId),
      sourceFlow: await ctx.db.get(sourceFlowId),
      targetFlow: await ctx.db.get(targetFlowId),
      payroll: await ctx.db.get(ids.payrollId),
      ap: await ctx.db.get(ids.apId),
    }));
    expect(rows.sourceFlow?.stale).toBe(true);
    expect(rows.targetFlow?.stale).toBe(true);
    expect(rows.source?.summaryStale).toBe(true);
    expect(rows.target?.summaryStale).toBe(true);
    // Content stays readable behind Rebuild.
    expect(rows.source?.rollingSummary).toBe("Source summary");
    expect(rows.target?.rollingSummary).toBe("Target summary");
    // The revision bump stops an in-flight overview run on the source from
    // publishing with the departed contribution in it.
    expect(rows.source?.summaryEvidenceRevision).toBe(5);
    expect(rows.payroll?.summaryStale).toBe(true);
    expect(rows.ap?.summaryStale).toBe(true);
    // Per-contribution evidence is process-independent and kept as-is.
    expect(rows.moved?.processSummaryInput).toBe("## Steps\n1. Cached record");
    expect(rows.moved?.processSummaryInputHash).toBe("cached-hash");

    expect(await scheduledNames(t)).toEqual([]);
  });

  test("records who moved it, and the history goes with a deleted contribution", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrg(t);
    const conversationId = await insertConversation(t, ids.sourceId);
    await insertConversation(t, ids.sourceId);
    const admin = t.withIdentity(identityFor("admin"));

    await admin.mutation(api.conversations.moveForAdmin, {
      conversationId,
      targetProcessId: ids.targetId,
      note: "  Filed under the wrong process  ",
    });

    const history = await admin.query(api.conversations.moveHistoryForAdmin, {
      conversationId,
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromLabel: "Operations › Payroll › Monthly payroll",
      toLabel: "Finance › Payables › Supplier payments",
      note: "Filed under the wrong process",
      actorName: "Ada Admin",
    });

    await admin.mutation(api.conversations.deleteForAdmin, { conversationId, reason: "Duplicate" });
    const remaining = await t.run((ctx) =>
      ctx.db.query("conversationMoves").collect(),
    );
    expect(remaining).toHaveLength(0);
  });

  test("rejects an over-long note", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrg(t);
    const conversationId = await insertConversation(t, ids.sourceId);
    const code = await rejectionCode(
      t.withIdentity(identityFor("admin")).mutation(api.conversations.moveForAdmin, {
        conversationId,
        targetProcessId: ids.targetId,
        note: "x".repeat(501),
      }),
    );
    expect(code).toBe("NOTE_TOO_LONG");
  });
});

describe("conversations.locateForMember", () => {
  test("an old link finds where a moved contribution lives now", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrg(t);
    const conversationId = await insertConversation(t, ids.sourceId);
    await insertConversation(t, ids.sourceId);
    await t
      .withIdentity(identityFor("admin"))
      .mutation(api.conversations.moveForAdmin, {
        conversationId,
        targetProcessId: ids.targetId,
      });

    const viewer = t.withIdentity(identityFor("viewer"));
    await expect(
      viewer.query(api.conversations.getInProcess, {
        processId: ids.sourceId,
        conversationId,
      }),
    ).resolves.toBeNull();
    await expect(
      viewer.query(api.conversations.locateForMember, { conversationId }),
    ).resolves.toEqual({
      processId: ids.targetId,
      processName: "Supplier payments",
      departmentId: ids.apId,
      functionId: ids.financeId,
    });
  });

  test("never locates another org's contribution", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrg(t);
    const otherOrgConversation = await t.run((ctx) =>
      ctx.db.insert("conversations", {
        processId: ids.otherOrgProcessId,
        clerkOrgId: ORG_B,
        contributorName: "Elsewhere",
        status: "done",
      }),
    );
    await expect(
      t
        .withIdentity(identityFor("viewer"))
        .query(api.conversations.locateForMember, {
          conversationId: otherOrgConversation,
        }),
    ).resolves.toBeNull();
  });
});

describe("conversations.moveImpactForAdmin", () => {
  test("describes what each side will do", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrg(t);
    const onlyId = await insertConversation(t, ids.sourceId, {
      inputMode: "voiceRecord",
    });
    const admin = t.withIdentity(identityFor("admin"));

    const lonely = await admin.query(api.conversations.moveImpactForAdmin, {
      conversationId: onlyId,
      targetProcessId: ids.targetId,
    });
    expect(lonely).toMatchObject({
      blocker: null,
      isAgentInterview: false,
      source: {
        processName: "Monthly payroll",
        label: "Operations › Payroll › Monthly payroll",
        outcome: "cleared",
      },
      target: {
        label: "Finance › Payables › Supplier payments",
        outcome: "generates",
      },
    });

    await insertConversation(t, ids.sourceId);
    await insertConversation(t, ids.targetId);
    // Legacy rows without an input mode were AI interviews.
    const agentId = await insertConversation(t, ids.sourceId);
    const busy = await admin.query(api.conversations.moveImpactForAdmin, {
      conversationId: agentId,
      targetProcessId: ids.targetId,
    });
    expect(busy).toMatchObject({
      blocker: null,
      isAgentInterview: true,
      source: { outcome: "stale" },
      target: { outcome: "stale" },
    });
  });

  test("says why a move is refused instead of throwing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrg(t);
    const admin = t.withIdentity(identityFor("admin"));
    const failedId = await insertConversation(t, ids.sourceId, {
      status: "failed",
    });
    const doneId = await insertConversation(t, ids.sourceId);

    expect(
      (
        await admin.query(api.conversations.moveImpactForAdmin, {
          conversationId: failedId,
          targetProcessId: ids.targetId,
        })
      ).blocker,
    ).toBe("not_done");
    expect(
      (
        await admin.query(api.conversations.moveImpactForAdmin, {
          conversationId: doneId,
          targetProcessId: ids.sourceId,
        })
      ).blocker,
    ).toBe("same_process");
  });

  test("is admin-only", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrg(t);
    const conversationId = await insertConversation(t, ids.sourceId);
    await expect(
      t
        .withIdentity(identityFor("contributor"))
        .query(api.conversations.moveImpactForAdmin, {
          conversationId,
          targetProcessId: ids.targetId,
        }),
    ).rejects.toThrow();
  });
});

describe("conversations.deleteForAdmin reason (D6)", () => {
  test("refuses a blank or over-long reason and keeps the row", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrg(t);
    const conversationId = await insertConversation(t, ids.sourceId);
    const admin = t.withIdentity(identityFor("admin"));

    expect(
      await rejectionCode(
        admin.mutation(api.conversations.deleteForAdmin, { conversationId }),
      ),
    ).toBe("REASON_REQUIRED");
    expect(
      await rejectionCode(
        admin.mutation(api.conversations.deleteForAdmin, {
          conversationId,
          reason: "   ",
        }),
      ),
    ).toBe("REASON_REQUIRED");
    expect(
      await rejectionCode(
        admin.mutation(api.conversations.deleteForAdmin, {
          conversationId,
          reason: "x".repeat(501),
        }),
      ),
    ).toBe("REASON_TOO_LONG");

    expect(await t.run((ctx) => ctx.db.get(conversationId))).not.toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("conversationDeletions").collect()),
    ).toHaveLength(0);
  });

  test("logs what was deleted, by whom and why", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrg(t);
    const conversationId = await insertConversation(t, ids.sourceId, {
      status: "failed",
      inputMode: "voiceRecord",
      title: "Payroll cut-off walkthrough",
      contributorName: "Priya",
    });
    const admin = t.withIdentity(identityFor("admin"));

    await admin.mutation(api.conversations.deleteForAdmin, {
      conversationId,
      reason: "  Recorded twice  ",
    });

    expect(await t.run((ctx) => ctx.db.get(conversationId))).toBeNull();
    const log = await admin.query(api.conversations.deletionLogForAdmin, {});
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      title: "Payroll cut-off walkthrough",
      contributorName: "Priya",
      inputMode: "voiceRecord",
      status: "failed",
      processLabel: "Operations › Payroll › Monthly payroll",
      reason: "Recorded twice",
      actorName: "Ada Admin",
    });
  });

  test("the log is admin-only and scoped to the caller's org", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrg(t);
    const otherOrgConversation = await t.run((ctx) =>
      ctx.db.insert("conversations", {
        processId: ids.otherOrgProcessId,
        clerkOrgId: ORG_B,
        contributorName: "Elsewhere",
        status: "done",
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("conversationDeletions", {
        clerkOrgId: ORG_B,
        conversationId: otherOrgConversation,
        processId: ids.otherOrgProcessId,
        processLabel: "Other",
        contributorName: "Elsewhere",
        inputMode: "agent",
        status: "done",
        recordedAt: 0,
        reason: "Other org",
        actorUserId: ids.users.admin,
        actorName: "Admin B",
        createdAt: 0,
      }),
    );

    await expect(
      t
        .withIdentity(identityFor("contributor"))
        .query(api.conversations.deletionLogForAdmin, {}),
    ).rejects.toThrow();
    await expect(
      t
        .withIdentity(identityFor("admin"))
        .query(api.conversations.deletionLogForAdmin, {}),
    ).resolves.toEqual([]);
  });
});

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ORG_A = "org_read_models_a";
const ORG_B = "org_read_models_b";
const ISSUER = "https://test.clerk";

type OrgAUser = "admin_a" | "contributor_a" | "viewer_a";

type SeededReadModels = {
  processA: Id<"processes">;
  processB: Id<"processes">;
  currentProcess: Id<"processes">;
  processingProcess: Id<"processes">;
  failedProcess: Id<"processes">;
  labelsProcess: Id<"processes">;
};

function identityForOrgA(user: OrgAUser) {
  return {
    tokenIdentifier: `${ISSUER}|${user}`,
    subject: user,
    issuer: ISSUER,
    name: user,
    email: `${user}@a.test`,
    orgId: ORG_A,
    orgSlug: "read-a",
  };
}

function identityForOrgB() {
  return {
    tokenIdentifier: `${ISSUER}|admin_b`,
    subject: "admin_b",
    issuer: ISSUER,
    name: "admin_b",
    email: "admin_b@b.test",
    orgId: ORG_B,
    orgSlug: "read-b",
  };
}

function flowFixture(
  processId: Id<"processes">,
  clerkOrgId: string,
  overrides: Partial<{
    stale: boolean;
    generatedAt: number;
    conversationCount: number;
  }> = {},
) {
  return {
    processId,
    clerkOrgId,
    status: "ready" as const,
    stale: overrides.stale ?? false,
    generatedAt: overrides.generatedAt ?? 1000,
    conversationCount: overrides.conversationCount ?? 1,
    nodes: [
      {
        id: "start",
        label: "Start",
        description: "Start",
        category: "start" as const,
        actors: ["Ops"],
        tools: [],
        painPoints: [],
        automationPotential: "none" as const,
        confidence: "high" as const,
        isBottleneck: false,
        isTribalKnowledge: false,
        riskIndicators: [],
        sources: ["Conversation"],
      },
      {
        id: "approve",
        label: "Approve",
        description: "Approve the request",
        category: "decision" as const,
        actors: ["Manager"],
        tools: ["ERP"],
        painPoints: ["Approval delays"],
        automationPotential: "medium" as const,
        confidence: "medium" as const,
        isBottleneck: true,
        isTribalKnowledge: false,
        riskIndicators: ["Late approvals"],
        sources: ["Conversation"],
      },
    ],
    edges: [
      {
        id: "start-approve",
        source: "start",
        target: "approve",
        type: "sequential" as const,
        isHappyPath: true,
      },
    ],
    insights: {
      criticalPath: ["start", "approve"],
      handoffCount: 1,
      toolCount: 1,
      automationOpportunities: ["Automate approval reminders."],
      topBottlenecks: ["Approve"],
    },
  };
}

async function seedReadModels(
  t: ReturnType<typeof convexTest>,
): Promise<SeededReadModels> {
  return await t.run(async (ctx) => {
    const users: Record<OrgAUser | "admin_b", Id<"users">> = {
      admin_a: await ctx.db.insert("users", {
        tokenIdentifier: `${ISSUER}|admin_a`,
        name: "Admin A",
        email: "admin@a.test",
        profileComplete: true,
      }),
      contributor_a: await ctx.db.insert("users", {
        tokenIdentifier: `${ISSUER}|contributor_a`,
        name: "Contributor A",
        email: "contributor@a.test",
        profileComplete: true,
      }),
      viewer_a: await ctx.db.insert("users", {
        tokenIdentifier: `${ISSUER}|viewer_a`,
        name: "Viewer A",
        email: "viewer@a.test",
        profileComplete: true,
      }),
      admin_b: await ctx.db.insert("users", {
        tokenIdentifier: `${ISSUER}|admin_b`,
        name: "Admin B",
        email: "admin@b.test",
        profileComplete: true,
      }),
    };

    await ctx.db.insert("memberships", {
      tokenIdentifier: `${ISSUER}|admin_a`,
      userId: users.admin_a,
      clerkOrgId: ORG_A,
      role: "admin",
      createdAt: Date.now(),
    });
    await ctx.db.insert("memberships", {
      tokenIdentifier: `${ISSUER}|contributor_a`,
      userId: users.contributor_a,
      clerkOrgId: ORG_A,
      role: "contributor",
      createdAt: Date.now(),
    });
    await ctx.db.insert("memberships", {
      tokenIdentifier: `${ISSUER}|viewer_a`,
      userId: users.viewer_a,
      clerkOrgId: ORG_A,
      role: "viewer",
      createdAt: Date.now(),
    });
    await ctx.db.insert("memberships", {
      tokenIdentifier: `${ISSUER}|admin_b`,
      userId: users.admin_b,
      clerkOrgId: ORG_B,
      role: "admin",
      createdAt: Date.now(),
    });

    const fnA = await ctx.db.insert("functions", {
      name: "Operations",
      sortOrder: 0,
      summary: "Function summary",
      summaryUpdatedAt: 123,
      clerkOrgId: ORG_A,
    });
    const deptA = await ctx.db.insert("departments", {
      functionId: fnA,
      name: "Payroll",
      sortOrder: 0,
      summaryStale: true,
      clerkOrgId: ORG_A,
    });
    const processA = await ctx.db.insert("processes", {
      departmentId: deptA,
      name: "Monthly payroll",
      sortOrder: 0,
      rollingSummary: "Payroll summary",
      clerkOrgId: ORG_A,
    });
    const currentProcess = await ctx.db.insert("processes", {
      departmentId: deptA,
      name: "Current process",
      sortOrder: 1,
      clerkOrgId: ORG_A,
    });
    const processingProcess = await ctx.db.insert("processes", {
      departmentId: deptA,
      name: "Processing process",
      sortOrder: 2,
      clerkOrgId: ORG_A,
    });
    const failedProcess = await ctx.db.insert("processes", {
      departmentId: deptA,
      name: "Failed process",
      sortOrder: 3,
      clerkOrgId: ORG_A,
    });
    const labelsProcess = await ctx.db.insert("processes", {
      departmentId: deptA,
      name: "Labels process",
      sortOrder: 4,
      clerkOrgId: ORG_A,
    });

    const fnB = await ctx.db.insert("functions", {
      name: "Operations B",
      sortOrder: 0,
      clerkOrgId: ORG_B,
    });
    const deptB = await ctx.db.insert("departments", {
      functionId: fnB,
      name: "Payroll B",
      sortOrder: 0,
      clerkOrgId: ORG_B,
    });
    const processB = await ctx.db.insert("processes", {
      departmentId: deptB,
      name: "Monthly payroll B",
      sortOrder: 0,
      clerkOrgId: ORG_B,
    });

    await ctx.db.insert("conversations", {
      processId: processA,
      contributorName: "Alice",
      userId: users.contributor_a,
      inputMode: "agent",
      elevenlabsConversationId: "el_a_done",
      status: "done",
      durationSeconds: 120,
      summary: "Done summary",
      transcript: [
        { role: "user", content: "Done", time_in_call_secs: 0 },
      ],
      clerkOrgId: ORG_A,
    });
    await ctx.db.insert("conversations", {
      processId: processA,
      contributorName: "Blake",
      inputMode: "voiceRecord",
      status: "needs_speaker_labels",
      durationSeconds: 60,
      transcript: [
        {
          role: "user",
          content: "Needs labels",
          time_in_call_secs: 0,
          speakerId: "speaker_0",
        },
      ],
      clerkOrgId: ORG_A,
    });
    await ctx.db.insert("conversations", {
      processId: currentProcess,
      contributorName: "Current Contributor",
      status: "done",
      clerkOrgId: ORG_A,
    });
    await ctx.db.insert("conversations", {
      processId: processingProcess,
      contributorName: "Processing Contributor",
      status: "processing",
      clerkOrgId: ORG_A,
    });
    await ctx.db.insert("conversations", {
      processId: failedProcess,
      contributorName: "Failed Contributor",
      status: "failed",
      clerkOrgId: ORG_A,
    });
    await ctx.db.insert("conversations", {
      processId: labelsProcess,
      contributorName: "Failed First",
      status: "failed",
      clerkOrgId: ORG_A,
    });
    await ctx.db.insert("conversations", {
      processId: labelsProcess,
      contributorName: "Labels Win",
      status: "needs_speaker_labels",
      clerkOrgId: ORG_A,
    });
    await ctx.db.insert("conversations", {
      processId: processB,
      contributorName: "Org B",
      status: "done",
      clerkOrgId: ORG_B,
    });

    await ctx.db.insert("processFlows", {
      ...flowFixture(processA, ORG_A, {
        stale: true,
        generatedAt: 9999999999999,
        conversationCount: 1,
      }),
    });
    await ctx.db.insert("processFlows", {
      ...flowFixture(processB, ORG_B),
    });

    return {
      processA,
      processB,
      currentProcess,
      processingProcess,
      failedProcess,
      labelsProcess,
    };
  });
}

describe("redesign read models", () => {
  test("hierarchy.getTree returns an org-scoped tree with counts and indicators", async () => {
    const t = convexTest(schema, modules);
    await seedReadModels(t);

    const tree = await t
      .withIdentity(identityForOrgA("viewer_a"))
      .query(api.hierarchy.getTree);

    expect(tree.functions).toHaveLength(1);
    expect(tree.functions[0].name).toBe("Operations");
    expect(tree.functions[0].departmentCount).toBe(1);
    expect(tree.functions[0].departments[0].name).toBe("Payroll");
    expect(tree.functions[0].departments[0].summaryStale).toBe(true);

    const payroll = tree.functions[0].departments[0].processes[0];
    expect(payroll.name).toBe("Monthly payroll");
    expect(payroll.conversationCounts).toMatchObject({
      total: 2,
      done: 1,
      needsSpeakerLabels: 1,
    });
    expect(payroll.pendingWorkStatus).toBe("needs_labels");
    expect(payroll.needsAttention).toBe(true);
    expect(payroll.stale).toBe(true);
    expect(payroll.flow?.decisionCount).toBe(1);

    expect(JSON.stringify(tree)).not.toContain("Monthly payroll B");
  });

  test("read models are available to viewer, contributor, and admin members", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedReadModels(t);

    for (const user of ["viewer_a", "contributor_a", "admin_a"] as const) {
      const scoped = t.withIdentity(identityForOrgA(user));
      await expect(scoped.query(api.hierarchy.getTree)).resolves.toBeTruthy();
      await expect(
        scoped.query(api.processes.getWorkbench, { processId: ids.processA }),
      ).resolves.toBeTruthy();
      await expect(
        scoped.query(api.conversations.listCompactByProcess, {
          processId: ids.processA,
        }),
      ).resolves.toBeTruthy();
    }
  });

  test("processes.getWorkbench derives status priority and latest contributor", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedReadModels(t);
    const viewer = t.withIdentity(identityForOrgA("viewer_a"));

    const labelsWorkbench = await viewer.query(api.processes.getWorkbench, {
      processId: ids.labelsProcess,
    });
    expect(labelsWorkbench?.pendingWork).toEqual({
      status: "needs_labels",
      label: "Needs labels",
    });
    expect(labelsWorkbench?.latestContributor?.name).toBe("Labels Win");

    const failedWorkbench = await viewer.query(api.processes.getWorkbench, {
      processId: ids.failedProcess,
    });
    expect(failedWorkbench?.pendingWork.status).toBe("failed");

    const processingWorkbench = await viewer.query(api.processes.getWorkbench, {
      processId: ids.processingProcess,
    });
    expect(processingWorkbench?.pendingWork.status).toBe("processing");

    const currentWorkbench = await viewer.query(api.processes.getWorkbench, {
      processId: ids.currentProcess,
    });
    expect(currentWorkbench?.pendingWork.status).toBe("current");
  });

  test("processes.getWorkbench returns compact parent and flow metadata", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedReadModels(t);

    const workbench = await t
      .withIdentity(identityForOrgA("viewer_a"))
      .query(api.processes.getWorkbench, { processId: ids.processA });

    expect(workbench?.process.name).toBe("Monthly payroll");
    expect(workbench?.department.name).toBe("Payroll");
    expect(workbench?.function.name).toBe("Operations");
    expect(workbench?.conversationCounts.total).toBe(2);
    expect(workbench?.flow).toMatchObject({
      stale: true,
      nodeCount: 2,
      edgeCount: 1,
      decisionCount: 1,
      painPointCount: 1,
      handoffCount: 1,
      toolCount: 1,
    });
    expect(workbench?.lastUpdatedAt).toBe(9999999999999);
  });

  test("processes.getWorkbench returns null for cross-org process ids", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedReadModels(t);

    const result = await t
      .withIdentity(identityForOrgA("viewer_a"))
      .query(api.processes.getWorkbench, { processId: ids.processB });

    expect(result).toBeNull();
  });

  test("conversations.listCompactByProcess omits heavy transcript and summary fields", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedReadModels(t);

    const rows = await t
      .withIdentity(identityForOrgA("viewer_a"))
      .query(api.conversations.listCompactByProcess, {
        processId: ids.processA,
      });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      contributorName: "Blake",
      inputMode: "voiceRecord",
      status: "needs_speaker_labels",
      hasTranscript: true,
      hasSummary: false,
      needsSpeakerLabels: true,
    });
    expect(rows[0]).not.toHaveProperty("transcript");
    expect(rows[0]).not.toHaveProperty("summary");
  });

  test("conversations.listCompactByProcess is org-scoped", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedReadModels(t);

    const orgAResult = await t
      .withIdentity(identityForOrgA("viewer_a"))
      .query(api.conversations.listCompactByProcess, {
        processId: ids.processB,
      });
    expect(orgAResult).toEqual([]);

    const orgBResult = await t
      .withIdentity(identityForOrgB())
      .query(api.conversations.listCompactByProcess, {
        processId: ids.processB,
      });
    expect(orgBResult).toHaveLength(1);
    expect(orgBResult[0].contributorName).toBe("Org B");
  });
});

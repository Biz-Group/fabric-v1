/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx } from "./_generated/server";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ORG = "org_summary_reads";

/**
 * Guards the bounded-read work in the v3 upstream batch: every one of these
 * queries used to `.collect()` whole conversation rows — transcripts included
 * — and filter in memory. The point of each assertion is that rows the caller
 * does not need are never read.
 */
async function seedProcess(
  ctx: MutationCtx,
  name: string,
): Promise<Id<"processes">> {
  const functionId = await ctx.db.insert("functions", {
    name: `${name} function`,
    sortOrder: 0,
    clerkOrgId: ORG,
  });
  const departmentId = await ctx.db.insert("departments", {
    functionId,
    name: `${name} department`,
    sortOrder: 0,
    clerkOrgId: ORG,
  });
  return await ctx.db.insert("processes", {
    departmentId,
    name,
    sortOrder: 0,
    clerkOrgId: ORG,
  });
}

type ConversationFixture = Omit<
  Doc<"conversations">,
  "_id" | "_creationTime"
>;

function conversation(
  processId: Id<"processes">,
  overrides: Partial<ConversationFixture> = {},
): ConversationFixture {
  return {
    processId,
    contributorName: "Contributor",
    status: "done",
    summary: "A summary",
    transcript: [{ role: "user", content: "Hello", time_in_call_secs: 0 }],
    clerkOrgId: ORG,
    ...overrides,
  };
}

describe("bounded process-summary reads", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  test("getFlowGenerationData skips conversations that are not done", async () => {
    const t = convexTest(schema, modules);
    const processId = await t.run(async (ctx) => {
      const id = await seedProcess(ctx, "Flow process");
      await ctx.db.patch(id, { rollingSummary: "Rolling summary" });
      await ctx.db.insert(
        "conversations",
        conversation(id, { contributorName: "Done one" }),
      );
      await ctx.db.insert(
        "conversations",
        conversation(id, { contributorName: "Failed one", status: "failed" }),
      );
      return id;
    });

    const data = await t.query(internal.processFlows.getFlowGenerationData, {
      processId,
      clerkOrgId: ORG,
    });

    expect(data.rollingSummary).toBe("Rolling summary");
    expect(data.conversations.map((c) => c.contributorName)).toEqual([
      "Done one",
    ]);
    expect(data.summarySourceSnapshot).toBeNull();
  });

  test("getFlowGenerationData carries optional V2 summary provenance", async () => {
    const t = convexTest(schema, modules);
    const processId = await t.run(async (ctx) => {
      const id = await seedProcess(ctx, "V2 provenance process");
      await ctx.db.patch(id, {
        summaryV2: {
          schemaVersion: "v2",
          sourceMode: "interview_evidence",
          headline: "Synthetic overview",
          executiveBrief: "A synthetic overview used only by this test.",
          scope: [],
          consensus: [],
          variations: [],
          gaps: [],
          notable: [],
          coverage: {
            includedSources: 0,
            totalEligibleSources: 0,
            complete: true,
          },
          provenance: {
            sourceSnapshotHash: "sha256:flow-source",
            generatedAt: 1_786_000_000_000,
            promptVersion: "summary-v2-process-overview-v1",
            provider: "fabric-foundry",
            model: "test-model",
          },
        },
      });
      return id;
    });

    const data = await t.query(internal.processFlows.getFlowGenerationData, {
      processId,
      clerkOrgId: ORG,
    });

    expect(data.summarySourceSnapshot).toEqual({
      sourceSnapshotHash: "sha256:flow-source",
      summaryGeneratedAt: 1_786_000_000_000,
      summaryPromptVersion: "summary-v2-process-overview-v1",
    });
  });

  test("getFlowGenerationData caps the conversations it reads and says so", async () => {
    const warn = vi.spyOn(console, "warn");
    const t = convexTest(schema, modules);
    const processId = await t.run(async (ctx) => {
      const id = await seedProcess(ctx, "Busy process");
      for (let i = 0; i < 55; i++) {
        await ctx.db.insert(
          "conversations",
          conversation(id, { contributorName: `Contributor ${i}` }),
        );
      }
      return id;
    });

    const data = await t.query(internal.processFlows.getFlowGenerationData, {
      processId,
      clerkOrgId: ORG,
    });

    expect(data.conversations).toHaveLength(50);
    expect(
      warn.mock.calls.some(
        ([message]) =>
          message === "Process exceeds the flow-generation conversation cap",
      ),
    ).toBe(true);
  });
});

/** A process overview citing `cited`, built from `includedSources` contributions. */
function overviewCiting(
  cited: Id<"conversations">[],
  includedSources: number,
): NonNullable<Doc<"processes">["summaryV2"]> {
  return {
    schemaVersion: "v2",
    sourceMode: "interview_evidence",
    headline: "Synthetic overview",
    executiveBrief: "A synthetic overview used only by this test.",
    scope: [],
    consensus: cited.map((conversationId, index) => ({
      id: `consensus-${index}`,
      title: "A finding",
      body: "What the contributor said.",
      evidenceLevel: "single_source" as const,
      supportCount: 1,
      sources: [
        { kind: "conversation" as const, conversationId, label: `Conv. ${index + 1}` },
      ],
    })),
    variations: [],
    gaps: [],
    notable: [],
    coverage: { includedSources, totalEligibleSources: includedSources, complete: true },
    provenance: {
      sourceSnapshotHash: "sha256:overview",
      generatedAt: 1_786_000_000_000,
      promptVersion: "summary-v2-process-overview-v1",
      provider: "fabric-foundry",
      model: "test-model",
    },
  };
}

describe("the overview background the flow reads", () => {
  test("an overview that has not absorbed a new contribution yet is kept", async () => {
    // The everyday case: a contribution finishes, and the flow starts before
    // the overview has been rebuilt to include it.
    const t = convexTest(schema, modules);
    const processId = await t.run(async (ctx) => {
      const id = await seedProcess(ctx, "Behind process");
      const first = await ctx.db.insert("conversations", conversation(id));
      await ctx.db.insert("conversations", conversation(id));
      await ctx.db.patch(id, {
        rollingSummary: "Overview of the first contribution",
        summaryV2: overviewCiting([first], 1),
      });
      return id;
    });

    const data = await t.query(internal.processFlows.getFlowGenerationData, {
      processId,
      clerkOrgId: ORG,
    });

    expect(data.rollingSummary).toBe("Overview of the first contribution");
    expect(data.summarySourceSnapshot?.sourceSnapshotHash).toBe("sha256:overview");
  });

  test("an overview citing a deleted contribution is left out", async () => {
    const t = convexTest(schema, modules);
    const processId = await t.run(async (ctx) => {
      const id = await seedProcess(ctx, "Deleted process");
      const kept = await ctx.db.insert("conversations", conversation(id));
      const deleted = await ctx.db.insert("conversations", conversation(id));
      // A contribution added since keeps the counts level, so only the
      // citation shows the overview is out of date.
      await ctx.db.insert("conversations", conversation(id));
      await ctx.db.patch(id, {
        rollingSummary: "Overview that quotes the deleted interview",
        summaryV2: overviewCiting([kept, deleted], 2),
      });
      await ctx.db.delete(deleted);
      return id;
    });

    const data = await t.query(internal.processFlows.getFlowGenerationData, {
      processId,
      clerkOrgId: ORG,
    });

    expect(data.rollingSummary).toBeNull();
    expect(data.summarySourceSnapshot).toBeNull();
    expect(data.conversations).toHaveLength(2);
  });

  test("an overview citing a contribution moved to another process is left out", async () => {
    const t = convexTest(schema, modules);
    const processId = await t.run(async (ctx) => {
      const id = await seedProcess(ctx, "Source process");
      const elsewhere = await seedProcess(ctx, "Destination process");
      const kept = await ctx.db.insert("conversations", conversation(id));
      const moved = await ctx.db.insert("conversations", conversation(id));
      await ctx.db.patch(id, {
        rollingSummary: "Overview that quotes the moved interview",
        summaryV2: overviewCiting([kept, moved], 2),
      });
      await ctx.db.patch(moved, { processId: elsewhere });
      return id;
    });

    const data = await t.query(internal.processFlows.getFlowGenerationData, {
      processId,
      clerkOrgId: ORG,
    });

    expect(data.rollingSummary).toBeNull();
  });

  test("an overview built from more contributions than remain is left out", async () => {
    // The removed contribution was never cited by a finding, but it still
    // shaped the overview's text.
    const t = convexTest(schema, modules);
    const processId = await t.run(async (ctx) => {
      const id = await seedProcess(ctx, "Shrunk process");
      const kept = await ctx.db.insert("conversations", conversation(id));
      await ctx.db.patch(id, {
        rollingSummary: "Overview of two contributions",
        summaryV2: overviewCiting([kept], 2),
      });
      return id;
    });

    const data = await t.query(internal.processFlows.getFlowGenerationData, {
      processId,
      clerkOrgId: ORG,
    });

    expect(data.rollingSummary).toBeNull();
  });
});

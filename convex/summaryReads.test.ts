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

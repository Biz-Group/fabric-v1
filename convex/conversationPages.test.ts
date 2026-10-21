/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { FunctionReturnType } from "convex/server";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ORG_A = "org_pages_a";
const ORG_B = "org_pages_b";
const ISSUER = "https://test.clerk";
const CONTRIBUTION_COUNT = 120;

function identity(user: "viewer_a" | "admin_b") {
  const orgId = user === "viewer_a" ? ORG_A : ORG_B;
  return {
    tokenIdentifier: `${ISSUER}|${user}`,
    subject: user,
    issuer: ISSUER,
    name: user,
    email: `${user}@pages.test`,
    orgId,
    orgSlug: orgId,
  };
}

type Seeded = {
  processA: Id<"processes">;
  otherProcessA: Id<"processes">;
  processB: Id<"processes">;
  // Oldest first, as inserted.
  contributions: Id<"conversations">[];
  otherProcessContribution: Id<"conversations">;
  orgBContribution: Id<"conversations">;
};

/**
 * 120 contributions in one process. Every tenth is failed and every 25th
 * awaits labels, so both reach back past the first 100; every third is a
 * voice note and the rest are legacy rows with no input mode.
 */
async function seed(t: ReturnType<typeof convexTest>): Promise<Seeded> {
  return await t.run(async (ctx) => {
    const viewer = await ctx.db.insert("users", {
      tokenIdentifier: `${ISSUER}|viewer_a`,
      name: "Viewer A",
      email: "viewer_a@pages.test",
      profileComplete: true,
    });
    const adminB = await ctx.db.insert("users", {
      tokenIdentifier: `${ISSUER}|admin_b`,
      name: "Admin B",
      email: "admin_b@pages.test",
      profileComplete: true,
    });
    await ctx.db.insert("memberships", {
      tokenIdentifier: `${ISSUER}|viewer_a`,
      userId: viewer,
      clerkOrgId: ORG_A,
      role: "viewer",
      createdAt: Date.now(),
    });
    await ctx.db.insert("memberships", {
      tokenIdentifier: `${ISSUER}|admin_b`,
      userId: adminB,
      clerkOrgId: ORG_B,
      role: "admin",
      createdAt: Date.now(),
    });

    const fnA = await ctx.db.insert("functions", {
      name: "Finance",
      sortOrder: 0,
      clerkOrgId: ORG_A,
    });
    const deptA = await ctx.db.insert("departments", {
      functionId: fnA,
      name: "Payables",
      sortOrder: 0,
      clerkOrgId: ORG_A,
    });
    const processA = await ctx.db.insert("processes", {
      departmentId: deptA,
      name: "Invoice approvals",
      sortOrder: 0,
      clerkOrgId: ORG_A,
    });
    const otherProcessA = await ctx.db.insert("processes", {
      departmentId: deptA,
      name: "Vendor onboarding",
      sortOrder: 1,
      clerkOrgId: ORG_A,
    });
    const fnB = await ctx.db.insert("functions", {
      name: "Finance",
      sortOrder: 0,
      clerkOrgId: ORG_B,
    });
    const deptB = await ctx.db.insert("departments", {
      functionId: fnB,
      name: "Payables",
      sortOrder: 0,
      clerkOrgId: ORG_B,
    });
    const processB = await ctx.db.insert("processes", {
      departmentId: deptB,
      name: "Invoice approvals",
      sortOrder: 0,
      clerkOrgId: ORG_B,
    });

    const contributions: Id<"conversations">[] = [];
    for (let index = 1; index <= CONTRIBUTION_COUNT; index += 1) {
      contributions.push(
        await ctx.db.insert("conversations", {
          processId: processA,
          contributorName: `Contributor ${index}`,
          ...(index % 3 === 0 ? { inputMode: "voiceRecord" as const } : {}),
          status:
            index % 25 === 0
              ? "needs_speaker_labels"
              : index % 10 === 0
                ? "failed"
                : "done",
          transcript: [
            { role: "user", content: `Contribution ${index}`, time_in_call_secs: 0 },
          ],
          clerkOrgId: ORG_A,
        }),
      );
    }
    const otherProcessContribution = await ctx.db.insert("conversations", {
      processId: otherProcessA,
      contributorName: "Elsewhere",
      status: "done",
      clerkOrgId: ORG_A,
    });
    const orgBContribution = await ctx.db.insert("conversations", {
      processId: processB,
      contributorName: "Org B",
      status: "done",
      clerkOrgId: ORG_B,
    });

    return {
      processA,
      otherProcessA,
      processB,
      contributions,
      otherProcessContribution,
      orgBContribution,
    };
  });
}

type PageArgs = {
  status?: "processing" | "needs_speaker_labels" | "done" | "failed";
  inputMode?: "agent" | "voiceRecord" | "audioUpload";
  order: "newest" | "oldest";
};

/** Follows the cursor to the end, as "Load more" would. */
async function readAllPages(
  t: ReturnType<typeof convexTest>,
  processId: Id<"processes">,
  args: PageArgs,
  numItems = 20,
) {
  const viewer = t.withIdentity(identity("viewer_a"));
  const rows = [];
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    const result: FunctionReturnType<
      typeof api.conversations.listPageByProcess
    > = await viewer.query(api.conversations.listPageByProcess, {
      processId,
      paginationOpts: { numItems, cursor },
      ...args,
    });
    rows.push(...result.page);
    pages += 1;
    if (result.isDone) return { rows, pages };
    cursor = result.continueCursor;
  }
}

describe("conversations.listPageByProcess", () => {
  test("pages newest first through every contribution, past the old 100 cap", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    const { rows, pages } = await readAllPages(t, ids.processA, {
      order: "newest",
    });

    expect(pages).toBeGreaterThan(1);
    expect(rows).toHaveLength(CONTRIBUTION_COUNT);
    expect(rows[0]._id).toBe(ids.contributions[CONTRIBUTION_COUNT - 1]);
    expect(rows.at(-1)?._id).toBe(ids.contributions[0]);
    expect(rows[0]).not.toHaveProperty("transcript");
  });

  test("oldest first starts at the first contribution", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    const firstPage = await t
      .withIdentity(identity("viewer_a"))
      .query(api.conversations.listPageByProcess, {
        processId: ids.processA,
        paginationOpts: { numItems: 10, cursor: null },
        order: "oldest",
      });

    expect(firstPage.page[0]._id).toBe(ids.contributions[0]);
    expect(firstPage.isDone).toBe(false);
  });

  test("the status filter runs on the index and reaches older rows", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    const failed = await readAllPages(t, ids.processA, {
      status: "failed",
      order: "newest",
    });
    // Multiples of 10 that aren't multiples of 25: 10, 20, 30, 40, 60, ...
    expect(failed.rows).toHaveLength(10);
    expect(failed.rows.every((row) => row.status === "failed")).toBe(true);
    expect(failed.rows.at(-1)?._id).toBe(ids.contributions[9]);

    const labels = await readAllPages(t, ids.processA, {
      status: "needs_speaker_labels",
      order: "oldest",
    });
    expect(labels.rows.map((row) => row._id)).toEqual(
      [25, 50, 75, 100].map((n) => ids.contributions[n - 1]),
    );
  });

  test("the type filter treats rows with no input mode as AI interviews", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    const voiceNotes = await readAllPages(t, ids.processA, {
      inputMode: "voiceRecord",
      order: "newest",
    });
    expect(voiceNotes.rows).toHaveLength(CONTRIBUTION_COUNT / 3);
    expect(
      voiceNotes.rows.every((row) => row.inputMode === "voiceRecord"),
    ).toBe(true);

    const interviews = await readAllPages(t, ids.processA, {
      inputMode: "agent",
      order: "newest",
    });
    expect(interviews.rows).toHaveLength(
      CONTRIBUTION_COUNT - CONTRIBUTION_COUNT / 3,
    );
  });

  test("caps the page size", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    const page = await t
      .withIdentity(identity("viewer_a"))
      .query(api.conversations.listPageByProcess, {
        processId: ids.processA,
        paginationOpts: { numItems: 1000, cursor: null },
        order: "newest",
      });

    expect(page.page).toHaveLength(50);
    expect(page.isDone).toBe(false);
  });

  test("is org-scoped", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    const result = await t
      .withIdentity(identity("viewer_a"))
      .query(api.conversations.listPageByProcess, {
        processId: ids.processB,
        paginationOpts: { numItems: 10, cursor: null },
        order: "newest",
      });

    expect(result).toEqual({ page: [], isDone: true, continueCursor: "" });
  });
});

describe("conversations.getInProcess", () => {
  test("lets a viewer open contribution 110 directly", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    const row = await t
      .withIdentity(identity("viewer_a"))
      .query(api.conversations.getInProcess, {
        processId: ids.processA,
        conversationId: ids.contributions[109],
      });

    expect(row?._id).toBe(ids.contributions[109]);
    expect(row?.transcript?.[0]?.content).toBe("Contribution 110");
  });

  test("returns null for another process, another org, or a deleted row", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const viewer = t.withIdentity(identity("viewer_a"));

    await expect(
      viewer.query(api.conversations.getInProcess, {
        processId: ids.processA,
        conversationId: ids.otherProcessContribution,
      }),
    ).resolves.toBeNull();

    await expect(
      viewer.query(api.conversations.getInProcess, {
        processId: ids.processB,
        conversationId: ids.orgBContribution,
      }),
    ).resolves.toBeNull();

    await t.run(async (ctx) => {
      await ctx.db.delete(ids.contributions[0]);
    });
    await expect(
      viewer.query(api.conversations.getInProcess, {
        processId: ids.processA,
        conversationId: ids.contributions[0],
      }),
    ).resolves.toBeNull();
  });
});

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ORG_A = "org_A_admin_conversations";
const ORG_B = "org_B_admin_conversations";
const ISSUER = "https://test.clerk";

function who(subject: string, orgId = ORG_A) {
  return {
    tokenIdentifier: `${ISSUER}|${subject}`,
    subject,
    issuer: ISSUER,
    name: subject,
    email: `${subject}@example.test`,
    orgId,
    orgSlug: orgId,
  };
}

type Seeded = {
  functionA: Id<"functions">;
  departmentA: Id<"departments">;
  intake: Id<"processes">;
  payroll: Id<"processes">;
  oldOnboarding: Id<"conversations">;
  zaraIntake: Id<"conversations">;
  invoiceTitle: Id<"conversations">;
  failedUpload: Id<"conversations">;
  foreign: Id<"conversations">;
};

// Ada is an admin and Cy a contributor in org A. Org B has a matching
// contribution that must never show up in org A's search. convex-test
// tokenizes every row in a search, so every row carries a title and summary.
async function seed(t: ReturnType<typeof convexTest>): Promise<Seeded> {
  return await t.run(async (ctx) => {
    async function member(
      subject: string,
      role: "admin" | "contributor",
      orgId: string,
      existingUserId?: Id<"users">,
    ) {
      const userId =
        existingUserId ??
        (await ctx.db.insert("users", {
          tokenIdentifier: `${ISSUER}|${subject}`,
          name: subject,
          email: `${subject}@example.test`,
          profileComplete: true,
        }));
      await ctx.db.insert("memberships", {
        tokenIdentifier: `${ISSUER}|${subject}`,
        userId,
        clerkOrgId: orgId,
        role,
        createdAt: 1_700_000_000_000,
      });
      return userId;
    }

    async function hierarchy(orgId: string) {
      const functionId = await ctx.db.insert("functions", {
        name: "Finance",
        sortOrder: 0,
        clerkOrgId: orgId,
      });
      const departmentId = await ctx.db.insert("departments", {
        functionId,
        name: "Accounts",
        sortOrder: 0,
        clerkOrgId: orgId,
      });
      const intake = await ctx.db.insert("processes", {
        departmentId,
        name: "Supplier intake",
        sortOrder: 0,
        clerkOrgId: orgId,
      });
      const payroll = await ctx.db.insert("processes", {
        departmentId,
        name: "Payroll run",
        sortOrder: 1,
        clerkOrgId: orgId,
      });
      return { functionId, departmentId, intake, payroll };
    }

    const adaId = await member("ada", "admin", ORG_A);
    await member("cy", "contributor", ORG_A);
    await member("ada", "admin", ORG_B, adaId);
    const a = await hierarchy(ORG_A);
    const b = await hierarchy(ORG_B);

    const row = (
      processId: Id<"processes">,
      contributorName: string,
      title: string,
      summary: string,
      orgId = ORG_A,
    ) => ({
      processId,
      contributorName,
      title,
      summary,
      status: "done" as const,
      clerkOrgId: orgId,
    });

    // Oldest first, so _creationTime follows this order.
    const oldOnboarding = await ctx.db.insert(
      "conversations",
      row(a.payroll, "Mona Patel", "Monthly close", "How payroll closes."),
    );
    const zaraIntake = await ctx.db.insert(
      "conversations",
      row(a.intake, "Zara Khan", "Vendor checks", "Checks run on new vendors."),
    );
    const invoiceTitle = await ctx.db.insert(
      "conversations",
      row(a.payroll, "Omar Ali", "Invoice approvals", "Approvals before payment."),
    );
    const failedUpload = await ctx.db.insert("conversations", {
      ...row(a.payroll, "Zara Khan", "Upload", "Nothing yet."),
      status: "failed",
      inputMode: "audioUpload",
    });
    const foreign = await ctx.db.insert(
      "conversations",
      row(b.intake, "Zara Khan", "Vendor checks", "Checks run.", ORG_B),
    );

    return {
      functionA: a.functionId,
      departmentA: a.departmentId,
      intake: a.intake,
      payroll: a.payroll,
      oldOnboarding,
      zaraIntake,
      invoiceTitle,
      failedUpload,
      foreign,
    };
  });
}

describe("conversations.searchForOrg", () => {
  test("finds contributions by contributor, title, summary and process name", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const ada = t.withIdentity(who("ada"));
    const search = async (text: string) =>
      (await ada.query(api.conversations.searchForOrg, { search: text })).page.map(
        (row) => row._id,
      );

    // Newest first across every source.
    expect(await search("zara")).toEqual([ids.failedUpload, ids.zaraIntake]);
    expect(await search("invoice")).toEqual([ids.invoiceTitle]);
    expect(await search("vendors")).toEqual([ids.zaraIntake]);
    expect(await search("payroll")).toEqual([
      ids.failedUpload,
      ids.invoiceTitle,
      ids.oldOnboarding,
    ]);
  });

  test("finds rows beyond the first page of the listing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const ada = t.withIdentity(who("ada"));

    const firstPage = await ada.query(api.conversations.listAllForOrg, {
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(firstPage.page.map((row) => row._id)).not.toContain(
      ids.oldOnboarding,
    );

    const result = await ada.query(api.conversations.searchForOrg, {
      search: "mona",
    });
    expect(result.page.map((row) => row._id)).toEqual([ids.oldOnboarding]);
  });

  test("honours the status and process filters", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const ada = t.withIdentity(who("ada"));

    const failed = await ada.query(api.conversations.searchForOrg, {
      search: "zara",
      status: "failed",
    });
    expect(failed.page.map((row) => row._id)).toEqual([ids.failedUpload]);

    const inIntake = await ada.query(api.conversations.searchForOrg, {
      search: "zara",
      processId: ids.intake,
    });
    expect(inIntake.page.map((row) => row._id)).toEqual([ids.zaraIntake]);
  });

  test("caps the result and says so", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    const result = await t
      .withIdentity(who("ada"))
      .query(api.conversations.searchForOrg, { search: "payroll", limit: 2 });
    expect(result.page.map((row) => row._id)).toEqual([
      ids.failedUpload,
      ids.invoiceTitle,
    ]);
    expect(result.truncated).toBe(true);
  });

  test("rows carry the hierarchy ids for linking into the process", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    const result = await t
      .withIdentity(who("ada"))
      .query(api.conversations.searchForOrg, { search: "invoice" });
    expect(result.page[0]).toMatchObject({
      processId: ids.payroll,
      processName: "Payroll run",
      departmentId: ids.departmentA,
      functionId: ids.functionA,
    });
  });

  test("never returns another org's rows", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    const inA = await t
      .withIdentity(who("ada"))
      .query(api.conversations.searchForOrg, { search: "vendor" });
    expect(inA.page.map((row) => row._id)).not.toContain(ids.foreign);

    const foreignProcess = await t.run(async (ctx) =>
      (await ctx.db.get(ids.foreign))!.processId,
    );
    const filtered = await t
      .withIdentity(who("ada"))
      .query(api.conversations.searchForOrg, {
        search: "zara",
        processId: foreignProcess,
      });
    expect(filtered).toEqual({ page: [], truncated: false });
  });

  test("is admin-only", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await expect(
      t
        .withIdentity(who("cy"))
        .query(api.conversations.searchForOrg, { search: "zara" }),
    ).rejects.toThrow("INSUFFICIENT_ROLE");
  });
});

describe("conversations.getForAdmin", () => {
  test("includes the hierarchy ids the transcript dialog links with", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    const row = await t
      .withIdentity(who("ada"))
      .query(api.conversations.getForAdmin, { conversationId: ids.zaraIntake });
    expect(row).toMatchObject({
      _id: ids.zaraIntake,
      processName: "Supplier intake",
      departmentId: ids.departmentA,
      functionId: ids.functionA,
    });
  });
});

describe("failure reasons", () => {
  test("a failed recording records why, and a retry clears it", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    await t.run((ctx) =>
      ctx.db.patch(ids.failedUpload, {
        status: "processing",
        transcript: [{ role: "user", content: "Hello", time_in_call_secs: 0 }],
      }),
    );

    await t.mutation(internal.voiceRecordings.markVoiceRecordingFailed, {
      conversationId: ids.failedUpload,
      clerkOrgId: ORG_A,
      reason: "analysis",
    });
    const failed = await t.run((ctx) => ctx.db.get(ids.failedUpload));
    expect(failed).toMatchObject({ status: "failed", failureReason: "analysis" });

    await t
      .withIdentity(who("ada"))
      .mutation(api.voiceRecordings.retryAudioProcessing, {
        conversationId: ids.failedUpload,
      });
    const retried = await t.run((ctx) => ctx.db.get(ids.failedUpload));
    expect(retried?.status).toBe("processing");
    expect(retried?.failureReason).toBeUndefined();
  });

  test("a failed recording in another org is left alone", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    await t.mutation(internal.voiceRecordings.markVoiceRecordingFailed, {
      conversationId: ids.zaraIntake,
      clerkOrgId: ORG_B,
      reason: "transcription",
    });
    const row = await t.run((ctx) => ctx.db.get(ids.zaraIntake));
    expect(row?.status).toBe("done");
    expect(row?.failureReason).toBeUndefined();
  });
});

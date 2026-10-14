/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ORG_A = "org_A_mine";
const ORG_B = "org_B_mine";
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
  aliceId: Id<"users">;
  bobId: Id<"users">;
  processA: Id<"processes">;
  aliceSelf: Id<"conversations">;
  bobForAlice: Id<"conversations">;
  bobForExternal: Id<"conversations">;
  aliceLegacy: Id<"conversations">;
};

// Alice (contributor) and Bob (admin) share org A; Carol is a third member.
// Conversations are inserted oldest-first, so _creationTime follows the order.
async function seed(t: ReturnType<typeof convexTest>): Promise<Seeded> {
  return await t.run(async (ctx) => {
    async function member(
      subject: string,
      role: "admin" | "contributor",
      orgId: string,
      userId?: Id<"users">,
    ) {
      const id =
        userId ??
        (await ctx.db.insert("users", {
          tokenIdentifier: `${ISSUER}|${subject}`,
          name: subject,
          email: `${subject}@example.test`,
          profileComplete: true,
        }));
      await ctx.db.insert("memberships", {
        tokenIdentifier: `${ISSUER}|${subject}`,
        userId: id,
        clerkOrgId: orgId,
        role,
        createdAt: 1_700_000_000_000,
      });
      return id;
    }

    async function hierarchy(orgId: string) {
      const functionId = await ctx.db.insert("functions", {
        name: "Learning",
        sortOrder: 0,
        clerkOrgId: orgId,
      });
      const departmentId = await ctx.db.insert("departments", {
        functionId,
        name: "Instructional Design",
        sortOrder: 0,
        clerkOrgId: orgId,
      });
      return await ctx.db.insert("processes", {
        departmentId,
        name: "Course intake",
        sortOrder: 0,
        clerkOrgId: orgId,
      });
    }

    const aliceId = await member("alice", "contributor", ORG_A);
    const bobId = await member("bob", "admin", ORG_A);
    const carolId = await member("carol", "contributor", ORG_A);
    await member("alice", "contributor", ORG_B, aliceId);
    const processA = await hierarchy(ORG_A);
    const processB = await hierarchy(ORG_B);

    const aliceSelf = await ctx.db.insert("conversations", {
      processId: processA,
      contributorName: "alice",
      userId: aliceId,
      subjectUserId: aliceId,
      status: "done",
      clerkOrgId: ORG_A,
    });
    const bobForAlice = await ctx.db.insert("conversations", {
      processId: processA,
      contributorName: "alice",
      userId: bobId,
      subjectUserId: aliceId,
      submittedByName: "bob",
      status: "needs_speaker_labels",
      clerkOrgId: ORG_A,
    });
    const bobForExternal = await ctx.db.insert("conversations", {
      processId: processA,
      contributorName: "Erin External",
      userId: bobId,
      submittedByName: "bob",
      status: "processing",
      clerkOrgId: ORG_A,
    });
    // Written before subjectUserId existed: the submitter is the subject.
    const aliceLegacy = await ctx.db.insert("conversations", {
      processId: processA,
      contributorName: "alice",
      userId: aliceId,
      status: "done",
      clerkOrgId: ORG_A,
    });
    await ctx.db.insert("conversations", {
      processId: processA,
      contributorName: "carol",
      userId: carolId,
      subjectUserId: carolId,
      status: "done",
      clerkOrgId: ORG_A,
    });
    await ctx.db.insert("conversations", {
      processId: processB,
      contributorName: "alice",
      userId: aliceId,
      subjectUserId: aliceId,
      status: "done",
      clerkOrgId: ORG_B,
    });

    return {
      aliceId,
      bobId,
      processA,
      aliceSelf,
      bobForAlice,
      bobForExternal,
      aliceLegacy,
    };
  });
}

describe("conversations.listMine", () => {
  test("returns the caller's own and filed-for-them interviews, newest first", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    const rows = await t
      .withIdentity(who("alice"))
      .query(api.conversations.listMine, {});

    expect(rows.map((row) => row._id)).toEqual([
      ids.aliceLegacy,
      ids.bobForAlice,
      ids.aliceSelf,
    ]);
    expect(rows.map((row) => row.attribution)).toEqual([
      "self",
      "filedForCaller",
      "self",
    ]);
    expect(rows[1]).toMatchObject({
      processId: ids.processA,
      processName: "Course intake",
      departmentName: "Instructional Design",
      functionName: "Learning",
      status: "needs_speaker_labels",
      submittedByName: "bob",
    });
  });

  test("an admin sees what they filed on someone else's behalf", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    const rows = await t
      .withIdentity(who("bob"))
      .query(api.conversations.listMine, {});

    expect(rows.map((row) => row._id)).toEqual([
      ids.bobForExternal,
      ids.bobForAlice,
    ]);
    expect(rows.every((row) => row.attribution === "filedForOther")).toBe(
      true,
    );
  });

  test("is scoped to the active org", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const rows = await t
      .withIdentity(who("alice", ORG_B))
      .query(api.conversations.listMine, {});

    expect(rows).toHaveLength(1);
    expect(rows[0]?.attribution).toBe("self");
  });

  test("honours the limit", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    const rows = await t
      .withIdentity(who("alice"))
      .query(api.conversations.listMine, { limit: 2 });

    expect(rows.map((row) => row._id)).toEqual([
      ids.aliceLegacy,
      ids.bobForAlice,
    ]);
  });
});

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ORG_A = "org_A_placement";
const ORG_B = "org_B_placement";
const ISSUER = "https://test.clerk";

type Seeded = {
  aliceId: Id<"users">;
  aliceInA: Id<"memberships">;
  fnA: Id<"functions">;
  fnA2: Id<"functions">;
  deptA: Id<"departments">;
  emptyDeptA: Id<"departments">;
  fnB: Id<"functions">;
  deptB: Id<"departments">;
};

// Alice is a member of org A. Org A has two functions; org B has its own
// hierarchy and no members until a test adds one.
async function seed(t: ReturnType<typeof convexTest>): Promise<Seeded> {
  return await t.run(async (ctx) => {
    const aliceId = await ctx.db.insert("users", {
      tokenIdentifier: `${ISSUER}|alice`,
      name: "Alice",
      email: "alice@a.test",
      profileComplete: true,
    });
    const aliceInA = await ctx.db.insert("memberships", {
      tokenIdentifier: `${ISSUER}|alice`,
      userId: aliceId,
      clerkOrgId: ORG_A,
      role: "admin",
      createdAt: Date.now(),
    });
    const fnA = await ctx.db.insert("functions", {
      name: "Sales",
      sortOrder: 0,
      clerkOrgId: ORG_A,
    });
    const fnA2 = await ctx.db.insert("functions", {
      name: "Operations",
      sortOrder: 1,
      clerkOrgId: ORG_A,
    });
    const deptA = await ctx.db.insert("departments", {
      functionId: fnA,
      name: "Inside Sales",
      sortOrder: 0,
      clerkOrgId: ORG_A,
    });
    const emptyDeptA = await ctx.db.insert("departments", {
      functionId: fnA,
      name: "Field Sales",
      sortOrder: 1,
      clerkOrgId: ORG_A,
    });
    const fnB = await ctx.db.insert("functions", {
      name: "Sales",
      sortOrder: 0,
      clerkOrgId: ORG_B,
    });
    const deptB = await ctx.db.insert("departments", {
      functionId: fnB,
      name: "Inside Sales",
      sortOrder: 0,
      clerkOrgId: ORG_B,
    });
    return { aliceId, aliceInA, fnA, fnA2, deptA, emptyDeptA, fnB, deptB };
  });
}

function aliceIn(orgId: string) {
  return {
    tokenIdentifier: `${ISSUER}|alice`,
    subject: "alice",
    issuer: ISSUER,
    name: "Alice",
    email: "alice@a.test",
    orgId,
    orgSlug: orgId,
  };
}

async function addAliceToOrgB(
  t: ReturnType<typeof convexTest>,
  aliceId: Id<"users">,
) {
  return await t.run((ctx) =>
    ctx.db.insert("memberships", {
      tokenIdentifier: `${ISSUER}|alice`,
      userId: aliceId,
      clerkOrgId: ORG_B,
      role: "contributor",
      createdAt: Date.now(),
    }),
  );
}

describe("member placement", () => {
  test("setMyPlacement rejects a department from another org", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    await expect(
      t
        .withIdentity(aliceIn(ORG_A))
        .mutation(api.users.setMyPlacement, { departmentId: ids.deptB }),
    ).rejects.toThrow("Not found");

    const membership = await t.run((ctx) => ctx.db.get(ids.aliceInA));
    expect(membership?.departmentId).toBeUndefined();
  });

  test("placement is independent per org", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const aliceInB = await addAliceToOrgB(t, ids.aliceId);

    await t
      .withIdentity(aliceIn(ORG_A))
      .mutation(api.users.setMyPlacement, { departmentId: ids.deptA });
    await t
      .withIdentity(aliceIn(ORG_B))
      .mutation(api.users.setMyPlacement, { departmentId: ids.deptB });

    const [inA, inB] = await t.run(async (ctx) => [
      await ctx.db.get(ids.aliceInA),
      await ctx.db.get(aliceInB),
    ]);
    expect(inA?.departmentId).toBe(ids.deptA);
    expect(inB?.departmentId).toBe(ids.deptB);
  });

  test("completeProfile places the member in the active org", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    await t.run((ctx) => ctx.db.patch(ids.aliceId, { profileComplete: false }));

    await t.withIdentity(aliceIn(ORG_A)).mutation(api.users.completeProfile, {
      name: "Alice",
      jobTitle: "Account Executive",
      hireDate: "2024-01-15",
      departmentId: ids.deptA,
    });

    const [user, membership] = await t.run(async (ctx) => [
      await ctx.db.get(ids.aliceId),
      await ctx.db.get(ids.aliceInA),
    ]);
    expect(user?.profileComplete).toBe(true);
    expect(membership?.departmentId).toBe(ids.deptA);
  });

  test("completeProfile with a foreign department changes nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    await t.run((ctx) => ctx.db.patch(ids.aliceId, { profileComplete: false }));

    await expect(
      t.withIdentity(aliceIn(ORG_A)).mutation(api.users.completeProfile, {
        name: "Alice",
        jobTitle: "Account Executive",
        hireDate: "2024-01-15",
        departmentId: ids.deptB,
      }),
    ).rejects.toThrow("Not found");

    const user = await t.run((ctx) => ctx.db.get(ids.aliceId));
    expect(user?.profileComplete).toBe(false);
  });

  test("getMyPlacement reports an org with no hierarchy", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const ORG_EMPTY = "org_empty_placement";
    await t.run((ctx) =>
      ctx.db.insert("memberships", {
        tokenIdentifier: `${ISSUER}|alice`,
        userId: ids.aliceId,
        clerkOrgId: ORG_EMPTY,
        role: "viewer",
        createdAt: Date.now(),
      }),
    );

    const inEmpty = await t
      .withIdentity(aliceIn(ORG_EMPTY))
      .query(api.users.getMyPlacement);
    expect(inEmpty).toEqual({ placement: null, orgHasDepartments: false });

    const inA = await t
      .withIdentity(aliceIn(ORG_A))
      .query(api.users.getMyPlacement);
    expect(inA).toEqual({ placement: null, orgHasDepartments: true });
  });

  test("renames are reflected without writing to users or memberships", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const alice = t.withIdentity(aliceIn(ORG_A));
    await alice.mutation(api.users.setMyPlacement, { departmentId: ids.deptA });
    const before = await t.run(async (ctx) => ({
      user: await ctx.db.get(ids.aliceId),
      membership: await ctx.db.get(ids.aliceInA),
    }));

    await alice.mutation(api.functions.update, {
      functionId: ids.fnA,
      name: "Revenue",
    });
    await alice.action(api.departments.update, {
      departmentId: ids.deptA,
      name: "Inbound Sales",
    });

    const placement = await alice.query(api.users.getMyPlacement);
    expect(placement?.placement).toMatchObject({
      departmentId: ids.deptA,
      departmentName: "Inbound Sales",
      functionId: ids.fnA,
      functionName: "Revenue",
    });
    const after = await t.run(async (ctx) => ({
      user: await ctx.db.get(ids.aliceId),
      membership: await ctx.db.get(ids.aliceInA),
    }));
    expect(after).toEqual(before);
  });

  test("a department move is reflected in the derived function", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const alice = t.withIdentity(aliceIn(ORG_A));
    await alice.mutation(api.users.setMyPlacement, { departmentId: ids.deptA });

    await alice.action(api.departments.update, {
      departmentId: ids.deptA,
      name: "Inside Sales",
      functionId: ids.fnA2,
    });

    const placement = await alice.query(api.users.getMyPlacement);
    expect(placement?.placement).toMatchObject({
      departmentId: ids.deptA,
      functionId: ids.fnA2,
      functionName: "Operations",
    });
  });

  test("deleting a department clears only that org's placements on it", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const aliceInB = await addAliceToOrgB(t, ids.aliceId);
    const bobInA = await t.run(async (ctx) => {
      const bobId = await ctx.db.insert("users", {
        tokenIdentifier: `${ISSUER}|bob`,
        name: "Bob",
        email: "bob@a.test",
        profileComplete: true,
      });
      return await ctx.db.insert("memberships", {
        tokenIdentifier: `${ISSUER}|bob`,
        userId: bobId,
        clerkOrgId: ORG_A,
        role: "viewer",
        createdAt: Date.now(),
        departmentId: ids.deptA,
      });
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.aliceInA, { departmentId: ids.emptyDeptA });
      await ctx.db.patch(aliceInB, { departmentId: ids.deptB });
    });

    await t
      .withIdentity(aliceIn(ORG_A))
      .mutation(api.departments.remove, { departmentId: ids.emptyDeptA });

    const rows = await t.run(async (ctx) => ({
      aliceInA: await ctx.db.get(ids.aliceInA),
      aliceInB: await ctx.db.get(aliceInB),
      bobInA: await ctx.db.get(bobInA),
    }));
    expect(rows.aliceInA?.departmentId).toBeUndefined();
    expect(rows.aliceInB?.departmentId).toBe(ids.deptB);
    expect(rows.bobInA?.departmentId).toBe(ids.deptA);
  });

  test("admin member list shows placement names", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    await t.run((ctx) =>
      ctx.db.patch(ids.aliceInA, { departmentId: ids.deptA }),
    );

    const result = await t
      .withIdentity(aliceIn(ORG_A))
      .query(api.users.listOrgMembersPage, {
        paginationOpts: { numItems: 10, cursor: null },
      });
    expect(result.page).toHaveLength(1);
    expect(result.page[0]).toMatchObject({
      departmentName: "Inside Sales",
      functionName: "Sales",
    });
  });
});

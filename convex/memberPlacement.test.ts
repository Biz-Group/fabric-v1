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
    ).rejects.toThrow("DEPARTMENT_NOT_FOUND");

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
    ).rejects.toThrow("DEPARTMENT_NOT_FOUND");

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
    expect(inEmpty).toEqual({
      placement: null,
      orgHasDepartments: false,
      placementSkipped: false,
    });

    const inA = await t
      .withIdentity(aliceIn(ORG_A))
      .query(api.users.getMyPlacement);
    expect(inA).toEqual({
      placement: null,
      orgHasDepartments: true,
      placementSkipped: false,
    });
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

// Bob is a contributor in org A with his own job title, and a viewer in org
// B, so an org-A edit can be checked against what org B still sees.
async function addBob(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const bobId = await ctx.db.insert("users", {
      tokenIdentifier: `${ISSUER}|bob`,
      name: "Bob",
      email: "bob@a.test",
      jobTitle: "Analyst",
      profileComplete: true,
    });
    const bobInA = await ctx.db.insert("memberships", {
      tokenIdentifier: `${ISSUER}|bob`,
      userId: bobId,
      clerkOrgId: ORG_A,
      role: "contributor",
      createdAt: Date.now(),
      name: "Bob",
      email: "bob@a.test",
      jobTitle: "Analyst",
      profileComplete: true,
      searchText: "bob bob@a.test analyst",
    });
    const bobInB = await ctx.db.insert("memberships", {
      tokenIdentifier: `${ISSUER}|bob`,
      userId: bobId,
      clerkOrgId: ORG_B,
      role: "viewer",
      createdAt: Date.now(),
      name: "Bob",
      email: "bob@a.test",
      jobTitle: "Analyst",
      profileComplete: true,
      // convex-test tokenizes every row in a search, so each needs the field.
      searchText: "bob bob@a.test analyst",
    });
    return { bobId, bobInA, bobInB };
  });
}

function bobIn(orgId: string) {
  return {
    tokenIdentifier: `${ISSUER}|bob`,
    subject: "bob",
    issuer: ISSUER,
    name: "Bob",
    email: "bob@a.test",
    orgId,
    orgSlug: orgId,
  };
}

describe("skipping placement", () => {
  test("skipMyPlacement stops the prompt without placing the member", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const alice = t.withIdentity(aliceIn(ORG_A));

    await alice.mutation(api.users.skipMyPlacement, {});

    expect(await alice.query(api.users.getMyPlacement)).toEqual({
      placement: null,
      orgHasDepartments: true,
      placementSkipped: true,
    });
  });

  test("completeProfile can skip placement and still completes the profile", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    await t.run((ctx) => ctx.db.patch(ids.aliceId, { profileComplete: false }));

    await t.withIdentity(aliceIn(ORG_A)).mutation(api.users.completeProfile, {
      name: "Alice Smith",
      jobTitle: "Account Executive",
      hireDate: "2024-01-15",
      skipPlacement: true,
    });

    const [user, membership] = await t.run(async (ctx) => [
      await ctx.db.get(ids.aliceId),
      await ctx.db.get(ids.aliceInA),
    ]);
    expect(user).toMatchObject({ profileComplete: true, name: "Alice Smith" });
    expect(membership?.departmentId).toBeUndefined();
    expect(membership?.placementSkippedAt).toBeTypeOf("number");
  });

  test("a blank name is refused with a readable message", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    await t.run((ctx) => ctx.db.patch(ids.aliceId, { profileComplete: false }));

    await expect(
      t.withIdentity(aliceIn(ORG_A)).mutation(api.users.completeProfile, {
        name: "  ",
        jobTitle: "Account Executive",
        hireDate: "2024-01-15",
      }),
    ).rejects.toThrow("PROFILE_FIELD_REQUIRED");
  });
});

describe("admin placement edits", () => {
  test("an admin moves a member and sets a job title for this org only", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const bob = await addBob(t);

    await t
      .withIdentity(aliceIn(ORG_A))
      .mutation(api.users.updateMemberPlacement, {
        membershipId: bob.bobInA,
        departmentId: ids.deptA,
        jobTitle: "Senior Analyst",
      });

    const rows = await t.run(async (ctx) => ({
      user: await ctx.db.get(bob.bobId),
      inA: await ctx.db.get(bob.bobInA),
      inB: await ctx.db.get(bob.bobInB),
      audit: await ctx.db
        .query("authAuditEvents")
        .withIndex("by_targetUserId", (q) => q.eq("targetUserId", bob.bobId))
        .collect(),
    }));
    expect(rows.inA).toMatchObject({
      departmentId: ids.deptA,
      jobTitle: "Senior Analyst",
      jobTitleOverride: "Senior Analyst",
    });
    expect(rows.inA?.searchText).toContain("senior analyst");
    // The global profile and the other org are untouched.
    expect(rows.user?.jobTitle).toBe("Analyst");
    expect(rows.inB?.jobTitle).toBe("Analyst");
    expect(rows.audit.map((event) => event.action)).toEqual([
      "placementChanged",
    ]);

    // The member sees the new placement on Home.
    const placement = await t
      .withIdentity(bobIn(ORG_A))
      .query(api.users.getMyPlacement);
    expect(placement?.placement).toMatchObject({
      departmentId: ids.deptA,
      departmentName: "Inside Sales",
    });
  });

  test("the override survives the member's own profile sync", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const bob = await addBob(t);
    await t
      .withIdentity(aliceIn(ORG_A))
      .mutation(api.users.updateMemberPlacement, {
        membershipId: bob.bobInA,
        departmentId: null,
        jobTitle: "Team Lead",
      });

    await t
      .withIdentity(bobIn(ORG_A))
      .mutation(api.users.updateProfile, { jobTitle: "Principal Analyst" });

    const [inA, inB] = await t.run(async (ctx) => [
      await ctx.db.get(bob.bobInA),
      await ctx.db.get(bob.bobInB),
    ]);
    expect(inA?.jobTitle).toBe("Team Lead");
    expect(inB?.jobTitle).toBe("Principal Analyst");
  });

  test("a blank job title clears the override", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const bob = await addBob(t);
    const alice = t.withIdentity(aliceIn(ORG_A));
    await alice.mutation(api.users.updateMemberPlacement, {
      membershipId: bob.bobInA,
      departmentId: null,
      jobTitle: "Team Lead",
    });

    await alice.mutation(api.users.updateMemberPlacement, {
      membershipId: bob.bobInA,
      departmentId: null,
      jobTitle: "  ",
    });

    const inA = await t.run((ctx) => ctx.db.get(bob.bobInA));
    expect(inA?.jobTitleOverride).toBeUndefined();
    expect(inA?.jobTitle).toBe("Analyst");
  });

  test("a non-admin can't edit placement", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    await addBob(t);

    await expect(
      t.withIdentity(bobIn(ORG_A)).mutation(api.users.updateMemberPlacement, {
        membershipId: ids.aliceInA,
        departmentId: ids.deptA,
        jobTitle: "",
      }),
    ).rejects.toThrow("INSUFFICIENT_ROLE");
    const alice = await t.run((ctx) => ctx.db.get(ids.aliceInA));
    expect(alice?.departmentId).toBeUndefined();
  });

  test("another org's member or department is refused", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const bob = await addBob(t);
    const alice = t.withIdentity(aliceIn(ORG_A));

    await expect(
      alice.mutation(api.users.updateMemberPlacement, {
        membershipId: bob.bobInB,
        departmentId: ids.deptA,
        jobTitle: "",
      }),
    ).rejects.toThrow("MEMBER_NOT_FOUND");
    await expect(
      alice.mutation(api.users.updateMemberPlacement, {
        membershipId: bob.bobInA,
        departmentId: ids.deptB,
        jobTitle: "",
      }),
    ).rejects.toThrow("DEPARTMENT_NOT_FOUND");

    const [inA, inB] = await t.run(async (ctx) => [
      await ctx.db.get(bob.bobInA),
      await ctx.db.get(bob.bobInB),
    ]);
    expect(inA?.departmentId).toBeUndefined();
    expect(inB?.departmentId).toBeUndefined();
  });
});

describe("member list filters", () => {
  async function seedFiltered(t: ReturnType<typeof convexTest>) {
    const ids = await seed(t);
    const bob = await addBob(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.aliceInA, {
        departmentId: ids.deptA,
        name: "Alice",
        searchText: "alice alice@a.test",
      });
      await ctx.db.patch(bob.bobInA, { departmentId: ids.deptA });
    });
    return { ...ids, ...bob };
  }

  async function names(
    t: ReturnType<typeof convexTest>,
    args: {
      search?: string;
      role?: "admin" | "contributor" | "viewer";
      department?: Id<"departments"> | "unplaced";
    },
  ) {
    const result = await t
      .withIdentity(aliceIn(ORG_A))
      .query(api.users.listOrgMembersPage, {
        paginationOpts: { numItems: 10, cursor: null },
        ...args,
      });
    return result.page.map((row) => row.name).sort();
  }

  test("filters by role and department, alone and together", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedFiltered(t);

    expect(await names(t, { role: "contributor" })).toEqual(["Bob"]);
    expect(await names(t, { department: ids.deptA })).toEqual(["Alice", "Bob"]);
    expect(await names(t, { role: "admin", department: ids.deptA })).toEqual([
      "Alice",
    ]);
    expect(await names(t, { department: ids.emptyDeptA })).toEqual([]);
  });

  test("unplaced finds members with no department here", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedFiltered(t);
    await t.run((ctx) =>
      ctx.db.patch(ids.bobInA, { departmentId: undefined }),
    );

    expect(await names(t, { department: "unplaced" })).toEqual(["Bob"]);
    expect(
      await names(t, { role: "contributor", department: "unplaced" }),
    ).toEqual(["Bob"]);
  });

  test("search combines with the role and department filters", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedFiltered(t);

    expect(await names(t, { search: "bob" })).toEqual(["Bob"]);
    expect(await names(t, { search: "bob", role: "admin" })).toEqual([]);
    expect(
      await names(t, { search: "bob", department: ids.deptA }),
    ).toEqual(["Bob"]);
    expect(
      await names(t, { search: "bob", department: "unplaced" }),
    ).toEqual([]);
  });

  test("rows carry the override and the member's own title", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedFiltered(t);
    await t
      .withIdentity(aliceIn(ORG_A))
      .mutation(api.users.updateMemberPlacement, {
        membershipId: ids.bobInA,
        departmentId: ids.deptA,
        jobTitle: "Team Lead",
      });

    const result = await t
      .withIdentity(aliceIn(ORG_A))
      .query(api.users.listOrgMembersPage, {
        paginationOpts: { numItems: 10, cursor: null },
        role: "contributor",
      });
    expect(result.page[0]).toMatchObject({
      jobTitle: "Team Lead",
      jobTitleOverride: "Team Lead",
      profileJobTitle: "Analyst",
      departmentId: ids.deptA,
    });
  });
});

describe("bulk role changes", () => {
  async function addCarol(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const carolId = await ctx.db.insert("users", {
        tokenIdentifier: `${ISSUER}|carol`,
        name: "Carol",
        email: "carol@a.test",
        profileComplete: true,
      });
      return await ctx.db.insert("memberships", {
        tokenIdentifier: `${ISSUER}|carol`,
        userId: carolId,
        clerkOrgId: ORG_A,
        role: "viewer",
        createdAt: Date.now(),
      });
    });
  }

  test("changes every selected member, skipping those already in the role", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const bob = await addBob(t);
    const carolInA = await addCarol(t);

    const result = await t
      .withIdentity(aliceIn(ORG_A))
      .mutation(api.users.setMembershipRoles, {
        membershipIds: [bob.bobInA, carolInA],
        role: "contributor",
      });

    expect(result).toEqual({ changed: 1 });
    const carol = await t.run((ctx) => ctx.db.get(carolInA));
    expect(carol?.role).toBe("contributor");
  });

  test("refuses the caller's own row and changes nobody", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const carolInA = await addCarol(t);

    await expect(
      t.withIdentity(aliceIn(ORG_A)).mutation(api.users.setMembershipRoles, {
        membershipIds: [carolInA, ids.aliceInA],
        role: "contributor",
      }),
    ).rejects.toThrow("SELF_ROLE_CHANGE");
    const carol = await t.run((ctx) => ctx.db.get(carolInA));
    expect(carol?.role).toBe("viewer");
  });

  test("refuses another org's member and changes nobody", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const bob = await addBob(t);
    const carolInA = await addCarol(t);

    await expect(
      t.withIdentity(aliceIn(ORG_A)).mutation(api.users.setMembershipRoles, {
        membershipIds: [carolInA, bob.bobInB],
        role: "admin",
      }),
    ).rejects.toThrow("MEMBER_NOT_FOUND");
    const [carol, bobInB] = await t.run(async (ctx) => [
      await ctx.db.get(carolInA),
      await ctx.db.get(bob.bobInB),
    ]);
    expect(carol?.role).toBe("viewer");
    expect(bobInB?.role).toBe("viewer");
  });

  test("refuses non-admins", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await addBob(t);
    const carolInA = await addCarol(t);

    await expect(
      t.withIdentity(bobIn(ORG_A)).mutation(api.users.setMembershipRoles, {
        membershipIds: [carolInA],
        role: "admin",
      }),
    ).rejects.toThrow("INSUFFICIENT_ROLE");
  });
});

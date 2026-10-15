/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ORG_A = "org_A_onboarding";
const ORG_B = "org_B_onboarding";
const ISSUER = "https://test.clerk";

type Tester = ReturnType<typeof convexTest>;
type Role = Doc<"memberships">["role"];

// The cutoff sits a minute in the past, so rows created by a test count as
// new unless the test says otherwise.
let launchedAt: number;

beforeEach(() => {
  launchedAt = Date.now() - 60_000;
  process.env.ONBOARDING_LAUNCHED_AT = String(launchedAt);
});

afterEach(() => {
  delete process.env.ONBOARDING_LAUNCHED_AT;
});

function as(name: string, orgId = ORG_A) {
  return {
    tokenIdentifier: `${ISSUER}|${name}`,
    subject: name,
    issuer: ISSUER,
    name,
    email: `${name}@example.test`,
    orgId,
    orgSlug: orgId,
  };
}

async function addUser(
  t: Tester,
  name: string,
  extra: Partial<Doc<"users">> = {},
): Promise<Id<"users">> {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      tokenIdentifier: `${ISSUER}|${name}`,
      name,
      email: `${name}@example.test`,
      profileComplete: true,
      ...extra,
    }),
  );
}

async function addMember(
  t: Tester,
  name: string,
  role: Role,
  options: {
    orgId?: string;
    userId?: Id<"users">;
    extra?: Partial<Doc<"memberships">>;
  } = {},
): Promise<{ userId: Id<"users">; membershipId: Id<"memberships"> }> {
  const userId = options.userId ?? (await addUser(t, name));
  const membershipId = await t.run((ctx) =>
    ctx.db.insert("memberships", {
      tokenIdentifier: `${ISSUER}|${name}`,
      userId,
      clerkOrgId: options.orgId ?? ORG_A,
      role,
      status: "active",
      source: "adminInvite",
      createdAt: Date.now(),
      ...options.extra,
    }),
  );
  return { userId, membershipId };
}

/** "function" stops at a function with an empty department. */
async function addTree(
  t: Tester,
  depth: "function" | "process",
  orgId = ORG_A,
) {
  await t.run(async (ctx) => {
    const functionId = await ctx.db.insert("functions", {
      name: "Finance",
      sortOrder: 0,
      clerkOrgId: orgId,
    });
    const departmentId = await ctx.db.insert("departments", {
      functionId,
      name: "Payroll",
      sortOrder: 0,
      clerkOrgId: orgId,
    });
    if (depth === "process") {
      await ctx.db.insert("processes", {
        departmentId,
        name: "Monthly payroll",
        sortOrder: 0,
        clerkOrgId: orgId,
      });
    }
  });
}

async function addIntent(
  t: Tester,
  invitedBy: Id<"users">,
  status: Doc<"membershipIntents">["status"],
  orgId = ORG_A,
) {
  await t.run((ctx) =>
    ctx.db.insert("membershipIntents", {
      clerkOrgId: orgId,
      email: "new@example.test",
      emailLower: "new@example.test",
      requestedRole: "contributor",
      source: "adminInvite",
      status,
      invitedBy,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

function onboardingOf(t: Tester, name: string, orgId = ORG_A) {
  return t.withIdentity(as(name, orgId)).query(api.onboarding.getMyOnboarding, {});
}

describe("getMyOnboarding paths", () => {
  test.each([
    ["an empty workspace", null, { admin: "build", contributor: "waiting", viewer: "waiting" }],
    ["a function with no process", "function", { admin: "build", contributor: "waiting", viewer: "waiting" }],
    ["a workspace with a process", "process", { admin: "explore", contributor: "explore", viewer: "explore" }],
  ] as const)("in %s", async (_label, depth, expected) => {
    const t = convexTest(schema, modules);
    if (depth) await addTree(t, depth);
    for (const role of ["admin", "contributor", "viewer"] as const) {
      await addMember(t, role, role);
      const state = await onboardingOf(t, role);
      expect(state?.eligible).toBe(true);
      expect(state?.path).toBe(expected[role]);
    }
  });

  test("another org's tree never changes this org's path", async () => {
    const t = convexTest(schema, modules);
    await addTree(t, "process", ORG_B);
    await addMember(t, "alice", "admin");
    expect((await onboardingOf(t, "alice"))?.path).toBe("build");
  });
});

describe("getMyOnboarding eligibility", () => {
  test("is off for everyone while the cutoff is unset", async () => {
    delete process.env.ONBOARDING_LAUNCHED_AT;
    const t = convexTest(schema, modules);
    await addMember(t, "alice", "admin");
    expect(await onboardingOf(t, "alice")).toMatchObject({
      eligible: false,
      path: null,
      tour: { required: false },
      checklist: { visible: false, hidden: false, invited: false },
    });
  });

  test("leaves out memberships from before the cutoff", async () => {
    const t = convexTest(schema, modules);
    await addMember(t, "alice", "admin", {
      extra: { createdAt: launchedAt - 1 },
    });
    expect(await onboardingOf(t, "alice")).toMatchObject({
      eligible: false,
      path: null,
    });
  });

  test("leaves out super-admins and fan-out memberships", async () => {
    const t = convexTest(schema, modules);
    await addMember(t, "fanned", "admin", {
      extra: { source: "superAdminFanOut" },
    });
    const superAdminId = await addUser(t, "platform", {
      platformRole: "superAdmin",
    });
    await addMember(t, "platform", "admin", { userId: superAdminId });
    expect((await onboardingOf(t, "fanned"))?.eligible).toBe(false);
    expect((await onboardingOf(t, "platform"))?.eligible).toBe(false);
  });

  test("returns null for a removed member or a stranger", async () => {
    const t = convexTest(schema, modules);
    await addMember(t, "alice", "admin", {
      extra: { status: "removed", removedAt: Date.now() },
    });
    expect(await onboardingOf(t, "alice")).toBeNull();
    expect(await onboardingOf(t, "nobody")).toBeNull();
  });
});

describe("tour gate", () => {
  test("is required for a new builder until they watch it", async () => {
    const t = convexTest(schema, modules);
    await addMember(t, "alice", "admin");
    expect((await onboardingOf(t, "alice"))?.tour).toEqual({
      required: true,
      watched: false,
    });

    await t
      .withIdentity(as("alice"))
      .mutation(api.onboarding.markTourWatched, { via: "transcript" });
    expect((await onboardingOf(t, "alice"))?.tour).toEqual({
      required: false,
      watched: true,
    });
  });

  test("is waived for someone who existed before the cutoff", async () => {
    // The user row is created now; a cutoff in the future makes them "old",
    // and the membership is dated after it so it's still eligible.
    launchedAt = Date.now() + 60_000;
    process.env.ONBOARDING_LAUNCHED_AT = String(launchedAt);
    const t = convexTest(schema, modules);
    await addMember(t, "alice", "admin", {
      extra: { createdAt: launchedAt + 1 },
    });
    expect(await onboardingOf(t, "alice")).toMatchObject({
      eligible: true,
      path: "build",
      tour: { required: false, watched: false },
    });
  });

  test("isn't required on the explore path", async () => {
    const t = convexTest(schema, modules);
    await addTree(t, "process");
    await addMember(t, "alice", "admin");
    expect((await onboardingOf(t, "alice"))?.tour.required).toBe(false);
  });
});

describe("checklist invite step", () => {
  test("ignores the platform team's console invite", async () => {
    const t = convexTest(schema, modules);
    const superAdminId = await addUser(t, "platform", {
      platformRole: "superAdmin",
    });
    await addIntent(t, superAdminId, "accepted");
    await addMember(t, "fanned", "admin", {
      extra: { source: "superAdminFanOut" },
    });
    await addMember(t, "alice", "admin");
    expect((await onboardingOf(t, "alice"))?.checklist).toEqual({
      visible: true,
      hidden: false,
      invited: false,
    });
  });

  test("counts an admin's pending invite", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await addMember(t, "alice", "admin");
    await addIntent(t, userId, "pending");
    expect((await onboardingOf(t, "alice"))?.checklist.invited).toBe(true);
  });

  test("doesn't count the block left by removing someone", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await addMember(t, "alice", "admin");
    await addIntent(t, userId, "blocked");
    await addIntent(t, userId, "revoked");
    expect((await onboardingOf(t, "alice"))?.checklist.invited).toBe(false);
  });

  test("counts a second real member", async () => {
    const t = convexTest(schema, modules);
    await addMember(t, "alice", "admin");
    await addMember(t, "bob", "contributor");
    expect((await onboardingOf(t, "alice"))?.checklist.invited).toBe(true);
  });

  test("ignores invites and members in another org", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await addMember(t, "alice", "admin");
    await addIntent(t, userId, "pending", ORG_B);
    await addMember(t, "bob", "contributor", { orgId: ORG_B });
    expect((await onboardingOf(t, "alice"))?.checklist.invited).toBe(false);
  });

  test("is only shown to admins", async () => {
    const t = convexTest(schema, modules);
    await addTree(t, "process");
    await addMember(t, "carol", "contributor");
    expect((await onboardingOf(t, "carol"))?.checklist.visible).toBe(false);
  });
});

describe("onboarding mutations", () => {
  async function readMembership(t: Tester, membershipId: Id<"memberships">) {
    return await t.run((ctx) => ctx.db.get(membershipId));
  }

  test("keep the first timestamp", async () => {
    const t = convexTest(schema, modules);
    const { membershipId, userId } = await addMember(t, "alice", "admin");
    const alice = t.withIdentity(as("alice"));

    await alice.mutation(api.onboarding.completeWelcome, {});
    await alice.mutation(api.onboarding.markTourWatched, { via: "video" });
    await t.run(async (ctx) => {
      await ctx.db.patch(membershipId, { onboarding: { welcomedAt: 1 } });
      await ctx.db.patch(userId, { tourWatchedAt: 1 });
    });
    await alice.mutation(api.onboarding.completeWelcome, {});
    await alice.mutation(api.onboarding.markTourWatched, { via: "transcript" });

    expect((await readMembership(t, membershipId))?.onboarding?.welcomedAt).toBe(1);
    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.tourWatchedAt).toBe(1);
    expect(user?.tourWatchedVia).toBe("video");
  });

  test("resolve the walkthrough once, either way", async () => {
    const t = convexTest(schema, modules);
    await addTree(t, "process");
    const { membershipId } = await addMember(t, "bob", "contributor");
    const bob = t.withIdentity(as("bob"));

    await bob.mutation(api.onboarding.resolveWalkthrough, { outcome: "skipped" });
    await bob.mutation(api.onboarding.resolveWalkthrough, { outcome: "completed" });

    expect((await onboardingOf(t, "bob"))?.walkthrough).toBe("skipped");
    const onboarding = (await readMembership(t, membershipId))?.onboarding;
    expect(onboarding?.walkthroughCompletedAt).toBeUndefined();
  });

  test("hide, show and complete the checklist", async () => {
    const t = convexTest(schema, modules);
    const { membershipId } = await addMember(t, "alice", "admin");
    const alice = t.withIdentity(as("alice"));
    await alice.mutation(api.onboarding.completeWelcome, {});

    await alice.mutation(api.onboarding.setChecklistHidden, { hidden: true });
    expect((await onboardingOf(t, "alice"))?.checklist).toMatchObject({
      visible: false,
      hidden: true,
    });

    await alice.mutation(api.onboarding.setChecklistHidden, { hidden: false });
    expect((await onboardingOf(t, "alice"))?.checklist).toMatchObject({
      visible: true,
      hidden: false,
    });
    // Showing it again leaves the other milestones alone.
    const onboarding = (await readMembership(t, membershipId))?.onboarding;
    expect(onboarding?.welcomedAt).toBeDefined();
    expect(onboarding?.checklistDismissedAt).toBeUndefined();

    await alice.mutation(api.onboarding.markChecklistCompleted, {});
    expect((await onboardingOf(t, "alice"))?.checklist).toMatchObject({
      visible: false,
      hidden: false,
    });
  });

  test("record hints", async () => {
    const t = convexTest(schema, modules);
    await addMember(t, "alice", "admin");
    const alice = t.withIdentity(as("alice"));
    await alice.mutation(api.onboarding.markHintSeen, { hint: "capture" });
    expect((await onboardingOf(t, "alice"))?.hints).toEqual({
      captureSeen: true,
      firstMapSeen: false,
    });
  });

  test("write only the caller's own membership in the active org", async () => {
    const t = convexTest(schema, modules);
    const alice = await addMember(t, "alice", "admin");
    const aliceInB = await addMember(t, "alice", "contributor", {
      orgId: ORG_B,
      userId: alice.userId,
    });
    const bob = await addMember(t, "bob", "contributor");

    await t.withIdentity(as("alice")).mutation(api.onboarding.completeWelcome, {});

    expect((await readMembership(t, alice.membershipId))?.onboarding?.welcomedAt).toBeDefined();
    expect((await readMembership(t, aliceInB.membershipId))?.onboarding).toBeUndefined();
    expect((await readMembership(t, bob.membershipId))?.onboarding).toBeUndefined();
  });

  test("skip membership writes for ineligible members, but still record the tour", async () => {
    const t = convexTest(schema, modules);
    const { membershipId, userId } = await addMember(t, "alice", "admin", {
      extra: { createdAt: launchedAt - 1 },
    });
    const alice = t.withIdentity(as("alice"));

    await alice.mutation(api.onboarding.completeWelcome, {});
    await alice.mutation(api.onboarding.markTourWatched, { via: "video" });

    expect((await readMembership(t, membershipId))?.onboarding).toBeUndefined();
    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.tourWatchedAt).toBeDefined();
  });

  test("refuse callers who aren't members", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.withIdentity(as("nobody")).mutation(api.onboarding.completeWelcome, {}),
    ).rejects.toThrow();
  });
});

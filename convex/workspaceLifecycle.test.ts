/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { closeTenantDeletedInClerk } from "./tenants";
import { PURGE_GRACE_MS } from "./lib/workspaceStatus";

/**
 * Workspace offboarding, phase 1: suspend and reinstate
 * (docs/client-offboarding-plan.md).
 */

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://test.clerk";
const ORG_A = "org_closing";
const ORG_B = "org_staying";

type Ids = {
  tenantA: Id<"tenants">;
  tenantB: Id<"tenants">;
  conversationA: Id<"conversations">;
  membershipA: Id<"memberships">;
};

function identity(name: string, orgId?: string) {
  return {
    tokenIdentifier: `${ISSUER}|${name}`,
    subject: name,
    issuer: ISSUER,
    name,
    email: `${name}@example.test`,
    ...(orgId ? { orgId, orgSlug: orgId } : {}),
  };
}

async function seed(t: ReturnType<typeof convexTest>): Promise<Ids> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const user = async (name: string, platformRole?: "superAdmin") =>
      await ctx.db.insert("users", {
        tokenIdentifier: `${ISSUER}|${name}`,
        clerkUserId: name,
        name,
        email: `${name}@example.test`,
        emailLower: `${name}@example.test`,
        profileComplete: true,
        ...(platformRole ? { platformRole } : {}),
      });
    const member = async (name: string, userId: Id<"users">, orgId: string) =>
      await ctx.db.insert("memberships", {
        tokenIdentifier: `${ISSUER}|${name}`,
        userId,
        clerkOrgId: orgId,
        role: "admin",
        status: "active",
        createdAt: now,
      });

    const staff = await user("user_staff", "superAdmin");
    const ada = await user("user_ada");
    const bo = await user("user_bo");
    const membershipA = await member("user_ada", ada, ORG_A);
    await member("user_bo", bo, ORG_B);
    // Staff reach client workspaces through their own memberships, which a
    // closed workspace must also shut out.
    await member("user_staff", staff, ORG_A);

    const tenant = async (clerkOrgId: string, slug: string) =>
      await ctx.db.insert("tenants", {
        clerkOrgId,
        name: slug,
        slug,
        allowedEmailDomains: ["example.test"],
        status: "active",
        source: "console",
        createdAt: now,
        updatedAt: now,
      });
    const tenantA = await tenant(ORG_A, "closing-co");
    const tenantB = await tenant(ORG_B, "staying-co");

    await ctx.db.insert("membershipIntents", {
      clerkOrgId: ORG_A,
      email: "invitee@example.test",
      emailLower: "invitee@example.test",
      requestedRole: "contributor",
      source: "adminInvite",
      status: "pending",
      clerkInvitationId: "orginv_pending1",
      createdAt: now,
      updatedAt: now,
    });

    const fn = await ctx.db.insert("functions", { name: "Ops", sortOrder: 0, clerkOrgId: ORG_A });
    const dept = await ctx.db.insert("departments", {
      functionId: fn,
      name: "Finance",
      sortOrder: 0,
      clerkOrgId: ORG_A,
    });
    const proc = await ctx.db.insert("processes", {
      departmentId: dept,
      name: "Invoicing",
      sortOrder: 0,
      clerkOrgId: ORG_A,
    });
    const conversationA = await ctx.db.insert("conversations", {
      processId: proc,
      elevenlabsConversationId: "conv_closing1",
      contributorName: "user_ada",
      userId: ada,
      inputMode: "agent",
      status: "done",
      clerkOrgId: ORG_A,
    });
    await ctx.db.insert("functions", { name: "Sales", sortOrder: 0, clerkOrgId: ORG_B });

    return { tenantA, tenantB, conversationA, membershipA };
  });
}

/** The `code` a ConvexError carries, from either a call or `t.run`. */
async function codeOf(call: Promise<unknown>): Promise<string | null> {
  try {
    await call;
  } catch (error) {
    let data = (error as { data?: unknown }).data;
    while (typeof data === "string") data = JSON.parse(data);
    return (data as { code?: string } | undefined)?.code ?? null;
  }
  throw new Error("Expected the call to fail");
}

type ClerkCall = { url: string; method: string };

function stubClerk(options: { revokeStatus?: number } = {}) {
  const calls: ClerkCall[] = [];
  let pending = [{ id: "orginv_pending1", organization_id: ORG_A }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (method === "GET" && url.includes(`/organizations/${ORG_A}/invitations`)) {
        return json({ data: pending, total_count: pending.length });
      }
      if (method === "POST" && url.endsWith("/revoke")) {
        const status = options.revokeStatus ?? 200;
        if (status !== 200) {
          return json({ errors: [{ code: "server_error", message: "boom" }] }, status);
        }
        pending = [];
        return json({ id: "orginv_pending1", organization_id: ORG_A, status: "revoked" });
      }
      return json({ errors: [{ code: "not_found", message: "unexpected" }] }, 404);
    }),
  );
  return calls;
}

beforeEach(() => {
  process.env.CLERK_SECRET_KEY = "sk_test_abc";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function suspendA(t: ReturnType<typeof convexTest>, ids: Ids) {
  return await t.withIdentity(identity("user_staff")).action(
    api.workspaceLifecycle.suspendWorkspace,
    { tenantId: ids.tenantA, reason: "Contract ended", confirmSlug: "closing-co" },
  );
}

describe("suspending a workspace", () => {
  test("closes it, schedules the purge, revokes invitations and audits", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const calls = stubClerk();
    const before = Date.now();

    const result = await suspendA(t, ids);

    expect(result).toMatchObject({ invitationsRevoked: 1, errors: [] });
    expect(result.purgeAfter).toBeGreaterThanOrEqual(before + PURGE_GRACE_MS);
    expect(result.purgeAfter).toBeLessThanOrEqual(Date.now() + PURGE_GRACE_MS);
    expect(calls.some((c) => c.method === "POST" && c.url.includes("orginv_pending1/revoke"))).toBe(true);

    const state = await t.run(async (ctx) => ({
      tenant: await ctx.db.get(ids.tenantA),
      intents: await ctx.db
        .query("membershipIntents")
        .withIndex("by_clerkOrgId_and_status", (q) => q.eq("clerkOrgId", ORG_A).eq("status", "pending"))
        .collect(),
      audit: await ctx.db
        .query("authAuditEvents")
        .withIndex("by_clerkOrgId_and_createdAt", (q) => q.eq("clerkOrgId", ORG_A))
        .collect(),
      conversation: await ctx.db.get(ids.conversationA),
    }));
    expect(state.tenant?.status).toBe("suspended");
    expect(state.tenant?.offboarding).toMatchObject({
      reason: "Contract ended",
      suspendedByName: "user_staff",
      purgeAfter: result.purgeAfter,
      invitationsRevoked: 1,
    });
    expect(state.intents).toHaveLength(0);
    expect(state.audit.map((row) => row.action)).toContain("workspaceSuspended");
    // Suspension deletes nothing: that is the purge's job, 30 days later.
    expect(state.conversation).not.toBeNull();
  });

  test("shuts out members and staff, but no other workspace", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    stubClerk();
    await suspendA(t, ids);

    for (const name of ["user_ada", "user_staff"]) {
      expect(
        await codeOf(t.withIdentity(identity(name, ORG_A)).query(api.functions.list, {})),
      ).toBe("WORKSPACE_CLOSED");
    }
    expect(
      await codeOf(t.withIdentity(identity("user_ada", ORG_A)).mutation(api.functions.create, { name: "New" })),
    ).toBe("WORKSPACE_CLOSED");
    const other = await t.withIdentity(identity("user_bo", ORG_B)).query(api.functions.list, {});
    expect(other.map((fn: { name: string }) => fn.name)).toEqual(["Sales"]);
  });

  test("blocks actions before they reach Clerk", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const calls = stubClerk();
    await suspendA(t, ids);
    calls.length = 0;

    expect(
      await codeOf(t.withIdentity(identity("user_ada", ORG_A)).action(api.invitations.list, {})),
    ).toBe("WORKSPACE_CLOSED");
    expect(calls).toHaveLength(0);
  });

  test("lets nobody join, and says why", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    stubClerk();
    await suspendA(t, ids);

    const newcomer = t.withIdentity(identity("user_new", ORG_A));
    await newcomer.mutation(api.users.store, {});
    const memberships = await t.run(async (ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_tokenIdentifier_and_clerkOrgId", (q) =>
          q.eq("tokenIdentifier", `${ISSUER}|user_new`).eq("clerkOrgId", ORG_A),
        )
        .collect(),
    );
    expect(memberships).toHaveLength(0);
    expect(
      await newcomer.query(api.users.getMyJoinStatus, { clerkOrgId: ORG_A }),
    ).toEqual({ blocked: true, closed: true });
    expect(
      await t.withIdentity(identity("user_new")).query(api.users.getMyJoinStatus, { clerkOrgId: ORG_B }),
    ).toEqual({ blocked: false });
  });

  test("revokes already-issued audio links", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const source = () =>
      t.query(internal.postCall.getConversationAudioSource, {
        conversationId: ids.conversationA,
        clerkOrgId: ORG_A,
        membershipId: ids.membershipA,
      });
    expect(await source()).not.toBeNull();

    stubClerk();
    await suspendA(t, ids);
    expect(await source()).toBeNull();
  });

  test("needs the exact address, a reason and a platform admin", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    stubClerk();
    const staff = t.withIdentity(identity("user_staff"));

    expect(
      await codeOf(
        staff.action(api.workspaceLifecycle.suspendWorkspace, {
          tenantId: ids.tenantA,
          reason: "Contract ended",
          confirmSlug: "staying-co",
        }),
      ),
    ).toBe("CONFIRMATION_MISMATCH");
    expect(
      await codeOf(
        staff.action(api.workspaceLifecycle.suspendWorkspace, {
          tenantId: ids.tenantA,
          reason: "   ",
          confirmSlug: "closing-co",
        }),
      ),
    ).toBe("REASON_REQUIRED");
    expect(
      await codeOf(
        t.withIdentity(identity("user_ada", ORG_A)).action(api.workspaceLifecycle.suspendWorkspace, {
          tenantId: ids.tenantA,
          reason: "Contract ended",
          confirmSlug: "closing-co",
        }),
      ),
    ).toBe("INSUFFICIENT_ROLE");

    const tenant = await t.run((ctx) => ctx.db.get(ids.tenantA));
    expect(tenant?.status).toBe("active");
  });

  test("records invitations Clerk refused to revoke, for a retry", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    stubClerk({ revokeStatus: 500 });

    const result = await suspendA(t, ids);
    expect(result.invitationsRevoked).toBe(0);
    expect(result.errors).toHaveLength(1);
    // Closed regardless: Fabric refuses the invitee even if Clerk lets them in.
    const tenant = await t.run((ctx) => ctx.db.get(ids.tenantA));
    expect(tenant?.status).toBe("suspended");
    expect(tenant?.offboarding?.invitationRevokeErrors).toHaveLength(1);

    stubClerk();
    const retry = await t
      .withIdentity(identity("user_staff"))
      .action(api.workspaceLifecycle.retryInvitationRevocation, { tenantId: ids.tenantA });
    expect(retry).toEqual({ invitationsRevoked: 1, errors: [] });
    const after = await t.run((ctx) => ctx.db.get(ids.tenantA));
    expect(after?.offboarding?.invitationRevokeErrors).toBeUndefined();
    expect(after?.offboarding?.invitationsRevoked).toBe(1);
  });

  test("keeps a closed workspace closed through Clerk and provisioning updates", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    stubClerk();
    await suspendA(t, ids);

    await t.run((ctx) => closeTenantDeletedInClerk(ctx, ORG_A));
    await t.mutation(internal.tenants.patchTenantInternal, {
      tenantId: ids.tenantA,
      clearProvisioningErrors: true,
    });
    await t.mutation(internal.tenants.upsertFromClerkInternal, {
      clerkOrgId: ORG_A,
      name: "Closing Co (renamed in Clerk)",
      slug: "closing-co",
      allowedEmailDomains: [],
    });

    const tenant = await t.run((ctx) => ctx.db.get(ids.tenantA));
    expect(tenant?.status).toBe("suspended");
    expect(tenant?.offboarding).toBeDefined();
  });
});

describe("reinstating a workspace", () => {
  test("reopens it and cancels the purge", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    stubClerk();
    await suspendA(t, ids);

    const staff = t.withIdentity(identity("user_staff"));
    await staff.mutation(api.workspaceLifecycle.reinstateWorkspace, { tenantId: ids.tenantA });

    const tenant = await t.run((ctx) => ctx.db.get(ids.tenantA));
    expect(tenant?.status).toBe("active");
    expect(tenant?.offboarding).toBeUndefined();
    const fns = await t.withIdentity(identity("user_ada", ORG_A)).query(api.functions.list, {});
    expect(fns.map((fn: { name: string }) => fn.name)).toEqual(["Ops"]);

    const audit = await t.run((ctx) =>
      ctx.db
        .query("authAuditEvents")
        .withIndex("by_clerkOrgId_and_createdAt", (q) => q.eq("clerkOrgId", ORG_A))
        .collect(),
    );
    expect(audit.map((row) => row.action)).toContain("workspaceReinstated");

    expect(
      await codeOf(staff.mutation(api.workspaceLifecycle.reinstateWorkspace, { tenantId: ids.tenantA })),
    ).toBe("NOT_SUSPENDED");
  });

  test("is refused once the purge has started, and to non-staff", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    stubClerk();
    await suspendA(t, ids);

    expect(
      await codeOf(
        t
          .withIdentity(identity("user_ada"))
          .mutation(api.workspaceLifecycle.reinstateWorkspace, { tenantId: ids.tenantA }),
      ),
    ).toBe("INSUFFICIENT_ROLE");

    await t.run((ctx) => ctx.db.patch(ids.tenantA, { status: "purging" }));
    expect(
      await codeOf(
        t
          .withIdentity(identity("user_staff"))
          .mutation(api.workspaceLifecycle.reinstateWorkspace, { tenantId: ids.tenantA }),
      ),
    ).toBe("NOT_SUSPENDED");
  });

  test("returns a workspace with unfinished provisioning to needing attention", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    await t.run((ctx) =>
      ctx.db.patch(ids.tenantA, { status: "needsAttention", provisioningErrors: ["Logo upload failed"] }),
    );
    stubClerk();
    await suspendA(t, ids);
    await t
      .withIdentity(identity("user_staff"))
      .mutation(api.workspaceLifecycle.reinstateWorkspace, { tenantId: ids.tenantA });

    const tenant = await t.run((ctx) => ctx.db.get(ids.tenantA));
    expect(tenant?.status).toBe("needsAttention");
  });
});

describe("deletions made in the Clerk dashboard (Phase 5)", () => {
  beforeEach(() => {
    process.env.CLERK_JWT_ISSUER_DOMAIN = ISSUER;
  });

  test("a deleted organization closes its workspace for the 30-day purge, and can't be reopened", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    await t.mutation(internal.users.handleClerkWebhook, {
      eventId: "evt_org_deleted",
      eventType: "organization.deleted",
      data: { id: ORG_A, deleted: true },
    });

    const tenant = await t.run((ctx) => ctx.db.get(ids.tenantA));
    expect(tenant?.status).toBe("suspended");
    expect(tenant?.offboarding).toMatchObject({ origin: "clerkDeleted" });
    expect(tenant!.offboarding!.purgeAfter - tenant!.offboarding!.suspendedAt).toBe(PURGE_GRACE_MS);
    // The data is still there to export until the purge.
    expect(await t.run((ctx) => ctx.db.get(ids.conversationA))).not.toBeNull();
    expect(
      await codeOf(t.withIdentity(identity("user_ada", ORG_A)).query(api.functions.list, {})),
    ).toBe("WORKSPACE_CLOSED");
    expect(
      await codeOf(
        t
          .withIdentity(identity("user_staff"))
          .mutation(api.workspaceLifecycle.reinstateWorkspace, { tenantId: ids.tenantA }),
      ),
    ).toBe("CLERK_ORG_DELETED");
  });

  test("a deleted organization the console never saw still gets a workspace to purge", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("functions", { name: "Orphan", sortOrder: 0, clerkOrgId: "org_unseen" });
    });
    await t.mutation(internal.users.handleClerkWebhook, {
      eventId: "evt_org_deleted_unseen",
      eventType: "organization.deleted",
      data: { id: "org_unseen", deleted: true },
    });
    await t.mutation(internal.users.handleClerkWebhook, {
      eventId: "evt_org_deleted_empty",
      eventType: "organization.deleted",
      data: { id: "org_never_used", deleted: true },
    });

    const tenants = await t.run((ctx) => ctx.db.query("tenants").collect());
    expect(tenants.find((row) => row.clerkOrgId === "org_unseen")).toMatchObject({
      status: "suspended",
      offboarding: { origin: "clerkDeleted" },
    });
    expect(tenants.some((row) => row.clerkOrgId === "org_never_used")).toBe(false);
  });

  test("a deleted organization already in offboarding keeps its schedule", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    stubClerk();
    await suspendA(t, ids);
    const before = await t.run((ctx) => ctx.db.get(ids.tenantA));

    await t.mutation(internal.users.handleClerkWebhook, {
      eventId: "evt_org_deleted_late",
      eventType: "organization.deleted",
      data: { id: ORG_A, deleted: true },
    });
    const after = await t.run((ctx) => ctx.db.get(ids.tenantA));
    expect(after?.offboarding).toEqual(before?.offboarding);
  });

  test("a deleted Clerk user keeps their interviews but not their name or email", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    await t.mutation(internal.users.handleClerkWebhook, {
      eventId: "evt_user_deleted_ada",
      eventType: "user.deleted",
      data: { id: "user_ada" },
    });

    const state = await t.run(async (ctx) => ({
      ada: await ctx.db
        .query("users")
        .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", `${ISSUER}|user_ada`))
        .unique(),
      membership: await ctx.db.get(ids.membershipA),
      conversation: await ctx.db.get(ids.conversationA),
    }));
    expect(state.ada).toMatchObject({ name: "Former member", email: "" });
    expect(state.ada?.emailLower).toBeUndefined();
    expect(state.ada?.deletedAt).toBeDefined();
    expect(state.membership).toBeNull();
    expect(state.conversation).toMatchObject({ contributorName: "user_ada" });
  });
});

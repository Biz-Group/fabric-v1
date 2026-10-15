import { v } from "convex/values";
import {
  action,
  ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  MutationCtx,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { requireSuperAdmin, type Role } from "./lib/orgAuth";
import { userError } from "./lib/userError";
import { memberSearchText, membershipTitleFields } from "./lib/memberProfile";
import {
  assertClerkId,
  ClerkApiError,
  clerkFetch,
  clerkUserIdFromTokenIdentifier,
  isClerkApiErrorCode,
  normalizeEmail,
} from "./lib/clerkApi";

// ---------------------------------------------------------------------------
// Platform-role management (super-admin layer)
//
// Fabric runs a two-layer auth model:
//   1. Platform role  — users.platformRole = "superAdmin" (orthogonal, not
//      scoped to any org). Grants: create/delete orgs, fan-out action,
//      cross-org dashboards. Does NOT by itself grant tenant data access.
//   2. Org role       — memberships.role   = admin | contributor | viewer.
//      Scoped to one org. Governs all tenant data access.
//
// Super-admins gain access to client orgs via Model A: a fan-out action makes
// them real Clerk members of every org and writes matching Fabric memberships
// rows. No per-request bypass anywhere in the auth path.
// ---------------------------------------------------------------------------

async function patchStatsIfPresent(
  ctx: MutationCtx,
  clerkOrgId: string,
  delta: { active?: number; admin?: number; contributor?: number; viewer?: number },
) {
  const stats = await ctx.db
    .query("orgMembershipStats")
    .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", clerkOrgId))
    .unique();
  if (!stats) return;
  await ctx.db.patch(stats._id, {
    activeCount: Math.max(0, stats.activeCount + (delta.active ?? 0)),
    adminCount: Math.max(0, stats.adminCount + (delta.admin ?? 0)),
    contributorCount: Math.max(
      0,
      stats.contributorCount + (delta.contributor ?? 0),
    ),
    viewerCount: Math.max(0, stats.viewerCount + (delta.viewer ?? 0)),
    updatedAt: Date.now(),
  });
}

// --- Bootstrap -------------------------------------------------------------

/**
 * One-shot bootstrap for the first platform super-admin when a user row
 * already exists in Convex. Run via CLI:
 *   npx convex run platform:bootstrapSuperAdmin '{"email":"saish.gaonkar@bizgroup.ae"}'
 *
 * Sets users.platformRole to "superAdmin" for the matching email. Does NOT
 * touch Clerk or memberships — if the user already has admin memberships
 * everywhere they need them, that's sufficient. Otherwise, run
 * `fanOutSuperAdminMemberships` for each additional org they should access.
 *
 * Use `seedAndBootstrapSuperAdmin` instead when the Convex `users` row
 * doesn't exist yet (e.g. fresh prod deployment where nobody has signed in).
 */
export const bootstrapSuperAdmin = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
    if (!user) throw new Error(`No user found with email: ${args.email}`);

    if (user.platformRole === "superAdmin") {
      return {
        userId: user._id,
        email: args.email,
        alreadySuperAdmin: true,
      };
    }

    await ctx.db.patch(user._id, { platformRole: "superAdmin" });
    return {
      userId: user._id,
      email: args.email,
      alreadySuperAdmin: false,
    };
  },
});

/**
 * Full super-admin bootstrap that works even when the Convex `users` row
 * doesn't exist yet. Intended for bringing up a brand-new Fabric deployment:
 * no one has signed in, so `users.store` hasn't run yet, so the usual
 * bootstrapSuperAdmin fails with "No user found".
 *
 * This action:
 *   1. Calls the Clerk Admin API to look up the user by email
 *   2. Constructs the canonical `tokenIdentifier` that `users.store` would
 *      eventually write (`<CLERK_JWT_ISSUER_DOMAIN>|<clerk_user_id>`)
 *   3. Upserts the users row with that tokenIdentifier + platformRole
 *
 * When the user later signs into the app for the first time, `users.store`
 * finds this pre-seeded row via `by_tokenIdentifier` and reuses it (instead
 * of creating a second row).
 *
 * Requires:
 *   - CLERK_SECRET_KEY set on the Convex deployment
 *   - CLERK_JWT_ISSUER_DOMAIN set on the Convex deployment
 *   - The user has already been invited to and accepted the Clerk org
 *     (otherwise Clerk returns an empty list)
 *
 * Run with:
 *   npx convex run --prod platform:seedAndBootstrapSuperAdmin '{"email":"saish.gaonkar@bizgroup.ae"}'
 */
export const seedAndBootstrapSuperAdmin = internalAction({
  args: { email: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    clerkUserId: string;
    tokenIdentifier: string;
    userId: Id<"users">;
    action: "patched-existing" | "inserted-new";
  }> => {
    const issuerDomain = process.env.CLERK_JWT_ISSUER_DOMAIN;
    if (!issuerDomain) {
      throw new Error("CLERK_JWT_ISSUER_DOMAIN is not set in Convex env");
    }

    const users = (await clerkFetch("/users", {
      query: { email_address: [args.email], limit: "1" },
    })) as Array<{
      id: string;
      first_name?: string | null;
      last_name?: string | null;
      email_addresses?: Array<{ email_address: string }>;
    }>;
    if (!Array.isArray(users) || users.length === 0) {
      throw new Error(
        `No Clerk user found with email ${args.email}. Invite the user to the Clerk org first, and make sure they have accepted.`,
      );
    }

    const clerkUser = users[0];
    const tokenIdentifier = `${issuerDomain}|${clerkUser.id}`;
    const firstName = clerkUser.first_name ?? "";
    const lastName = clerkUser.last_name ?? "";
    const displayName = `${firstName} ${lastName}`.trim() || clerkUser.id;

    const { userId, action } = await ctx.runMutation(
      internal.platform.upsertAndSeedSuperAdminInternal,
      {
        email: args.email,
        tokenIdentifier,
        name: displayName,
      },
    );

    return {
      clerkUserId: clerkUser.id,
      tokenIdentifier,
      userId,
      action,
    };
  },
});

/**
 * Internal helper for `seedAndBootstrapSuperAdmin`. Upserts a user row and
 * stamps `platformRole: "superAdmin"`. Prefers lookup by tokenIdentifier,
 * falls back to email (handles the case where `users.store` already ran
 * but somehow produced a row without a matching tokenIdentifier).
 */
export const upsertAndSeedSuperAdminInternal = internalMutation({
  args: {
    email: v.string(),
    tokenIdentifier: v.string(),
    name: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    userId: Id<"users">;
    action: "patched-existing" | "inserted-new";
  }> => {
    let user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", args.tokenIdentifier),
      )
      .unique();
    if (!user) {
      user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", args.email))
        .unique();
    }

    if (user) {
      await ctx.db.patch(user._id, {
        tokenIdentifier: args.tokenIdentifier,
        clerkUserId: clerkUserIdFromTokenIdentifier(args.tokenIdentifier),
        email: args.email,
        emailLower: normalizeEmail(args.email),
        name: args.name,
        platformRole: "superAdmin",
      });
      return { userId: user._id, action: "patched-existing" };
    }

    const userId = await ctx.db.insert("users", {
      tokenIdentifier: args.tokenIdentifier,
      clerkUserId: clerkUserIdFromTokenIdentifier(args.tokenIdentifier),
      email: args.email,
      emailLower: normalizeEmail(args.email),
      name: args.name,
      profileComplete: false,
      platformRole: "superAdmin",
    });
    return { userId, action: "inserted-new" };
  },
});

// --- Read surface ----------------------------------------------------------

/** Super-admin-only. List every platform super-admin. */
export const listSuperAdmins = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);
    return await ctx.db
      .query("users")
      .withIndex("by_platformRole", (q) => q.eq("platformRole", "superAdmin"))
      .collect();
  },
});

/**
 * Read-only incident audit for the enrollment holes closed on 2026-10-13
 * (Clerk test mode left on in prod + the `bizgroup.ae` staff-domain
 * shortcut). Lists memberships that either use a Clerk test address
 * (`+clerk_test`) or belong to a non-super-admin `@bizgroup.ae` account that
 * joined a tenant by itself rather than through an invite or fan-out. Nothing
 * is changed; decide removals per row.
 *
 *   npx convex run --prod platform:auditEnrollmentExposure
 */
export const auditEnrollmentExposure = internalQuery({
  args: {},
  handler: async (ctx) => {
    const tenantSlugs = new Map<string, string>();
    const findings: Array<{
      reason: "clerkTestEmail" | "staffDomainSelfJoin";
      tenantSlug: string | null;
      clerkOrgId: string;
      email: string;
      role: string;
      source: string;
      createdAt: number;
      membershipId: Id<"memberships">;
    }> = [];

    for await (const m of ctx.db.query("memberships")) {
      const email = (m.emailLower ?? m.email ?? "").toLowerCase();
      const source = m.source ?? "legacy";
      const isTestEmail = email.slice(0, email.lastIndexOf("@")).includes("+clerk_test");
      const isStaffSelfJoin =
        email.endsWith("@bizgroup.ae") &&
        m.platformRole !== "superAdmin" &&
        (source === "selfSignup" || source === "webhook");
      if (!isTestEmail && !isStaffSelfJoin) continue;

      if (!tenantSlugs.has(m.clerkOrgId)) {
        const tenant = await ctx.db
          .query("tenants")
          .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", m.clerkOrgId))
          .unique();
        tenantSlugs.set(m.clerkOrgId, tenant?.slug ?? "");
      }
      findings.push({
        reason: isTestEmail ? "clerkTestEmail" : "staffDomainSelfJoin",
        tenantSlug: tenantSlugs.get(m.clerkOrgId) || null,
        clerkOrgId: m.clerkOrgId,
        email,
        role: m.role,
        source,
        createdAt: m.createdAt,
        membershipId: m._id,
      });
    }
    return findings;
  },
});

/** Internal: list super-admins for the fan-out action. */
export const getSuperAdminsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db
      .query("users")
      .withIndex("by_platformRole", (q) => q.eq("platformRole", "superAdmin"))
      .collect();
    return users.map((u) => ({
      userId: u._id,
      tokenIdentifier: u.tokenIdentifier,
      email: u.email,
      name: u.name,
    }));
  },
});

/** Internal: super-admin gate for the fan-out action. Returns caller user. */
export const requireSuperAdminInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await requireSuperAdmin(ctx);
    return { userId: user._id, tokenIdentifier: user.tokenIdentifier };
  },
});

/** Super-admin-only. Look up a user by email for the console's promote flow.
 * Bounded, exact-match lookup — not a directory search. */
export const findUserByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const emailLower = normalizeEmail(args.email);
    if (!emailLower) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_emailLower", (q) => q.eq("emailLower", emailLower))
      .first();
    if (!user) return null;
    return {
      userId: user._id,
      name: user.name,
      email: user.email,
      platformRole: user.platformRole ?? null,
    };
  },
});

// --- Promote / demote ------------------------------------------------------

/**
 * Super-admin-only. Promote or demote another user's platform role.
 *
 * Safety: prevents the caller from demoting themselves to protect against
 * locking the platform out of super-admin access (symmetric to the
 * "can't demote the last admin" guard on org roles).
 *
 * Promoting only sets the flag: the new super-admin still needs Clerk and
 * Fabric memberships in each tenant, which `fanOutSuperAdminMemberships`
 * adds. Demoting also takes back what the fan-out gave (see
 * `revokeFanOutAccess`), so a former super-admin doesn't stay an admin of
 * every client tenant.
 */
export const setPlatformRole = mutation({
  args: {
    targetUserId: v.id("users"),
    platformRole: v.union(v.literal("superAdmin"), v.null()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ workspacesRemoved: number; rolesRestored: number }> => {
    const caller = await requireSuperAdmin(ctx);

    const target = await ctx.db.get(args.targetUserId);
    if (!target) {
      throw userError("USER_NOT_FOUND", "User not found. They may have been deleted.");
    }

    // Prevent self-demotion
    if (
      caller._id === args.targetUserId &&
      args.platformRole === null &&
      caller.platformRole === "superAdmin"
    ) {
      throw userError(
        "SELF_DEMOTION",
        "You can't remove your own super-admin access. Ask another super-admin.",
      );
    }

    if (args.platformRole === null) {
      await ctx.db.patch(args.targetUserId, { platformRole: undefined });
      return await revokeFanOutAccess(ctx, target, caller._id);
    }
    await ctx.db.patch(args.targetUserId, { platformRole: args.platformRole });
    return { workspacesRemoved: 0, rolesRestored: 0 };
  },
});

function roleDelta(role: Role, amount: number) {
  return {
    admin: role === "admin" ? amount : 0,
    contributor: role === "contributor" ? amount : 0,
    viewer: role === "viewer" ? amount : 0,
  };
}

/**
 * Undoes the fan-out for a demoted super-admin, in the same transaction as
 * the demotion:
 *   - a membership the fan-out promoted goes back to its original role;
 *   - a membership the fan-out created is cut off now (tombstoned, which
 *     every access check and automatic re-provisioning respects) and then
 *     removed from Clerk and Fabric by `removeFanOutClerkMemberships`.
 * Fan-outs before `roleBeforeFanOut` existed didn't record the original
 * role, so those memberships count as created and are removed; the person
 * can be invited back with the right role.
 */
async function revokeFanOutAccess(
  ctx: MutationCtx,
  user: Doc<"users">,
  actorUserId: Id<"users">,
): Promise<{ workspacesRemoved: number; rolesRestored: number }> {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .take(500);
  const now = Date.now();
  const toRemove: Array<{
    membershipId: Id<"memberships">;
    clerkOrgId: string;
  }> = [];
  let rolesRestored = 0;

  for (const membership of memberships) {
    if (membership.source !== "superAdminFanOut") {
      if (membership.platformRole !== undefined) {
        await ctx.db.patch(membership._id, { platformRole: undefined });
      }
      continue;
    }

    const originalRole = membership.roleBeforeFanOut;
    if (originalRole) {
      await ctx.db.patch(membership._id, {
        role: originalRole,
        source: membership.sourceBeforeFanOut,
        roleBeforeFanOut: undefined,
        sourceBeforeFanOut: undefined,
        platformRole: undefined,
        updatedAt: now,
      });
      if (originalRole !== membership.role) {
        await patchStatsIfPresent(ctx, membership.clerkOrgId, {
          ...roleDelta(membership.role, -1),
          [originalRole]: 1,
        });
      }
      await ctx.db.insert("authAuditEvents", {
        clerkOrgId: membership.clerkOrgId,
        actorUserId,
        targetUserId: user._id,
        membershipId: membership._id,
        action: "roleChanged",
        detail: `Super-admin demoted: role restored to ${originalRole}`,
        createdAt: now,
      });
      rolesRestored++;
      continue;
    }

    if (membership.status !== "removed") {
      await ctx.db.patch(membership._id, {
        status: "removed",
        removedAt: now,
        platformRole: undefined,
        updatedAt: now,
      });
    }
    toRemove.push({
      membershipId: membership._id,
      clerkOrgId: membership.clerkOrgId,
    });
  }

  if (toRemove.length > 0) {
    await ctx.scheduler.runAfter(
      0,
      internal.platform.removeFanOutClerkMemberships,
      {
        clerkUserId:
          user.clerkUserId ??
          clerkUserIdFromTokenIdentifier(user.tokenIdentifier),
        actorUserId,
        memberships: toRemove,
      },
    );
  }
  return { workspacesRemoved: toRemove.length, rolesRestored };
}

/**
 * Second half of a demotion: removes the former super-admin from each Clerk
 * org the fan-out added them to, then deletes the tombstoned Fabric row. A
 * Clerk failure leaves that org's tombstone in place (no Fabric access
 * either way) and is logged; demoting again retries it.
 */
export const removeFanOutClerkMemberships = internalAction({
  args: {
    clerkUserId: v.string(),
    actorUserId: v.id("users"),
    memberships: v.array(
      v.object({ membershipId: v.id("memberships"), clerkOrgId: v.string() }),
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    assertClerkId(args.clerkUserId, "user");
    for (const { membershipId, clerkOrgId } of args.memberships) {
      assertClerkId(clerkOrgId, "org");
      try {
        await clerkFetch(
          `/organizations/${clerkOrgId}/memberships/${args.clerkUserId}`,
          { method: "DELETE" },
        );
      } catch (error) {
        // Already gone from Clerk (a 404) is the outcome we wanted.
        if (!(error instanceof ClerkApiError && error.status === 404)) {
          console.error(
            `Demotion: could not remove ${args.clerkUserId} from ${clerkOrgId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          continue;
        }
      }
      await ctx.runMutation(internal.platform.completeFanOutRemoval, {
        membershipId,
        actorUserId: args.actorUserId,
      });
    }
  },
});

export const completeFanOutRemoval = internalMutation({
  args: {
    membershipId: v.id("memberships"),
    actorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db.get(args.membershipId);
    // Re-promoted and fanned out again in the meantime: leave it.
    if (
      !membership ||
      membership.status !== "removed" ||
      membership.source !== "superAdminFanOut"
    ) {
      return;
    }
    await ctx.db.delete(membership._id);
    await patchStatsIfPresent(ctx, membership.clerkOrgId, {
      active: -1,
      ...roleDelta(membership.role, -1),
    });
    await ctx.db.insert("authAuditEvents", {
      clerkOrgId: membership.clerkOrgId,
      actorUserId: args.actorUserId,
      targetUserId: membership.userId,
      membershipId: membership._id,
      action: "memberRemoved",
      detail: "Super-admin demoted: fan-out access removed",
      createdAt: Date.now(),
    });
  },
});

// --- Fan-out ---------------------------------------------------------------

/** Internal: idempotent membership insert, used by the fan-out action. */
export const insertSuperAdminMembershipInternal = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    userId: v.id("users"),
    clerkOrgId: v.string(),
    invitedBy: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("Super-admin user not found");
    const clerkUserId = clerkUserIdFromTokenIdentifier(args.tokenIdentifier);
    const emailLower = user.emailLower ?? normalizeEmail(user.email);
    const name = user.name || user.email || "Super Admin";
    const searchText = memberSearchText([name, user.email, user.jobTitle]);
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_tokenIdentifier_and_clerkOrgId", (q) =>
        q
          .eq("tokenIdentifier", args.tokenIdentifier)
          .eq("clerkOrgId", args.clerkOrgId),
      )
      .unique();
    if (existing) {
      const titleFields = membershipTitleFields(
        { name, email: user.email, jobTitle: user.jobTitle },
        existing.jobTitleOverride,
      );
      // Remember what this membership was before the fan-out took it over, so
      // demotion can restore it. A later fan-out keeps the first record.
      const original =
        existing.source === "superAdminFanOut"
          ? {}
          : {
              roleBeforeFanOut: existing.role,
              sourceBeforeFanOut: existing.source,
            };
      // The fan-out is an explicit grant, so it also lifts a tombstone left
      // by a demotion whose Clerk cleanup failed.
      const reactivate =
        existing.status === "removed"
          ? { status: "active" as const, removedAt: undefined }
          : {};
      // Upgrade to admin if existing membership has a lower role.
      if (existing.role !== "admin") {
        await ctx.db.patch(existing._id, {
          ...original,
          ...reactivate,
          role: "admin",
          source: "superAdminFanOut",
          clerkUserId,
          name,
          email: user.email,
          emailLower,
          profileComplete: user.profileComplete,
          platformRole: "superAdmin",
          ...titleFields,
          updatedAt: Date.now(),
        });
        await patchStatsIfPresent(ctx, args.clerkOrgId, {
          admin: 1,
          contributor: existing.role === "contributor" ? -1 : 0,
          viewer: existing.role === "viewer" ? -1 : 0,
        });
      } else {
        await ctx.db.patch(existing._id, {
          ...original,
          ...reactivate,
          source: "superAdminFanOut",
          clerkUserId,
          name,
          email: user.email,
          emailLower,
          profileComplete: user.profileComplete,
          platformRole: "superAdmin",
          ...titleFields,
          updatedAt: Date.now(),
        });
      }
      return { inserted: false, upgraded: existing.role !== "admin" };
    }
    await ctx.db.insert("memberships", {
      tokenIdentifier: args.tokenIdentifier,
      userId: args.userId,
      clerkOrgId: args.clerkOrgId,
      role: "admin",
      invitedBy: args.invitedBy,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "active",
      source: "superAdminFanOut",
      clerkUserId,
      name,
      email: user.email,
      emailLower,
      jobTitle: user.jobTitle,
      profileComplete: user.profileComplete,
      platformRole: "superAdmin",
      searchText,
    });
    await patchStatsIfPresent(ctx, args.clerkOrgId, {
      active: 1,
      admin: 1,
    });
    return { inserted: true, upgraded: false };
  },
});

export type FanOutResult = {
  clerkOrgId: string;
  superAdminsProcessed: number;
  membershipsInserted: number;
  membershipsUpgraded: number;
  clerkApiErrors: Array<{ userId: Id<"users">; email: string; message: string }>;
};

/**
 * Shared fan-out implementation — synchronizes every platform super-admin
 * into the given Clerk org as `org:admin` and ensures a matching Fabric
 * memberships row. Used by both the UI-facing action (auth-gated) and the
 * CLI-friendly internal action.
 */
export async function fanOutImpl(
  ctx: ActionCtx,
  clerkOrgId: string,
  invitedBy: Id<"users"> | undefined,
): Promise<FanOutResult> {
  assertClerkId(clerkOrgId, "org");
  const clerkSecret = process.env.CLERK_SECRET_KEY;
  if (!clerkSecret) {
    throw new Error("CLERK_SECRET_KEY is not set in Convex env");
  }

  const superAdmins: Array<{
    userId: Id<"users">;
    tokenIdentifier: string;
    email: string;
    name: string;
  }> = await ctx.runQuery(internal.platform.getSuperAdminsInternal, {});

  const result: FanOutResult = {
    clerkOrgId,
    superAdminsProcessed: 0,
    membershipsInserted: 0,
    membershipsUpgraded: 0,
    clerkApiErrors: [],
  };

  for (const sa of superAdmins) {
    result.superAdminsProcessed++;
    const clerkUserId = clerkUserIdFromTokenIdentifier(sa.tokenIdentifier);

    // Step 1: add the user to the Clerk org as org:admin.
    // Idempotency: if the user is already a member, Clerk returns a 400 with
    // code `already_a_member_in_organization` — we treat that as success so
    // the fan-out can be re-run safely.
    try {
      await clerkFetch(`/organizations/${clerkOrgId}/memberships`, {
        method: "POST",
        body: { user_id: clerkUserId, role: "org:admin" },
      });
    } catch (error) {
      if (!isClerkApiErrorCode(error, "already_a_member_in_organization")) {
        result.clerkApiErrors.push({
          userId: sa.userId,
          email: sa.email,
          message: error instanceof Error ? error.message : String(error),
        });
        // Don't write Fabric membership if Clerk side failed — keeps the two
        // systems consistent. The caller can retry once the error is fixed.
        continue;
      }
    }

    // Step 2: idempotently insert/upgrade the Fabric membership row.
    const mr: { inserted: boolean; upgraded: boolean } = await ctx.runMutation(
      internal.platform.insertSuperAdminMembershipInternal,
      {
        tokenIdentifier: sa.tokenIdentifier,
        userId: sa.userId,
        clerkOrgId,
        invitedBy,
      },
    );
    if (mr.inserted) result.membershipsInserted++;
    if (mr.upgraded) result.membershipsUpgraded++;
  }

  return result;
}

/**
 * UI-facing action. Super-admin-gated via JWT. Call from authenticated
 * client code once an in-app org-creation flow exists.
 */
export const fanOutSuperAdminMemberships = action({
  args: { clerkOrgId: v.string() },
  handler: async (ctx, args): Promise<FanOutResult> => {
    const caller: { userId: Id<"users">; tokenIdentifier: string } =
      await ctx.runQuery(internal.platform.requireSuperAdminInternal, {});
    return fanOutImpl(ctx, args.clerkOrgId, caller.userId);
  },
});

/**
 * CLI-friendly variant. Use when invoking from `npx convex run`, where no
 * JWT identity is attached. Deployment-key auth is the gate here.
 *
 *   npx convex run platform:fanOutSuperAdminMembershipsInternal '{"clerkOrgId":"org_xxxxx"}'
 */
export const fanOutSuperAdminMembershipsInternal = internalAction({
  args: { clerkOrgId: v.string() },
  handler: async (ctx, args): Promise<FanOutResult> => {
    return fanOutImpl(ctx, args.clerkOrgId, undefined);
  },
});

// --- Tenant enrollment domains ----------------------------------------------
//
// Each tenant's subdomain sign-up is gated by email domain: a user may join
// `<slug>.<root>` only when a verified email of theirs matches the tenant's
// `allowedEmailDomains` (stored in Clerk org public metadata) or a pending
// invitation. Platform staff are added by the super-admin fan-out, not by
// email domain. These actions manage the allowed list.

const EMAIL_DOMAIN_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function normalizeEmailDomains(domains: string[]): string[] {
  const normalized = domains
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter((domain) => domain.length > 0);
  for (const domain of normalized) {
    if (!EMAIL_DOMAIN_PATTERN.test(domain)) {
      throw new Error(`Invalid email domain: "${domain}"`);
    }
  }
  return [...new Set(normalized)];
}

type SetAllowedDomainsResult = {
  clerkOrgId: string;
  allowedEmailDomains: string[];
};

export async function setAllowedEmailDomainsImpl(
  clerkOrgId: string,
  domains: string[],
): Promise<SetAllowedDomainsResult> {
  assertClerkId(clerkOrgId, "org");
  const allowedEmailDomains = normalizeEmailDomains(domains);
  // Clerk merges public_metadata keys, so this replaces only
  // `allowedEmailDomains` and leaves other metadata untouched.
  await clerkFetch(`/organizations/${clerkOrgId}/metadata`, {
    method: "PATCH",
    body: { public_metadata: { allowedEmailDomains } },
  });
  return { clerkOrgId, allowedEmailDomains };
}

/**
 * UI-facing action. Super-admin-gated via JWT. Replaces the tenant's allowed
 * email domain list (pass the full list each time; [] makes the tenant
 * invite-only).
 */
export const setOrgAllowedEmailDomains = action({
  args: { clerkOrgId: v.string(), domains: v.array(v.string()) },
  handler: async (ctx, args): Promise<SetAllowedDomainsResult> => {
    await ctx.runQuery(internal.platform.requireSuperAdminInternal, {});
    return setAllowedEmailDomainsImpl(args.clerkOrgId, args.domains);
  },
});

/**
 * CLI-friendly variant. Deployment-key auth is the gate here.
 *
 *   npx convex run platform:setOrgAllowedEmailDomainsInternal \
 *     '{"clerkOrgId":"org_xxxxx","domains":["clientco.com","clientco.ae"]}'
 */
export const setOrgAllowedEmailDomainsInternal = internalAction({
  args: { clerkOrgId: v.string(), domains: v.array(v.string()) },
  handler: async (_ctx, args): Promise<SetAllowedDomainsResult> => {
    return setAllowedEmailDomainsImpl(args.clerkOrgId, args.domains);
  },
});

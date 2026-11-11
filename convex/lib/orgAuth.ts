import { v } from "convex/values";
import { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { authError } from "./authErrors";
import { isWorkspaceClosed } from "./workspaceStatus";

// Per-org role hierarchy: admin > contributor > viewer.
export type Role = "admin" | "contributor" | "viewer";
const RANK: Record<Role, number> = { viewer: 0, contributor: 1, admin: 2 };

type IdentityWithOrgClaims = {
  orgId?: string;
  orgSlug?: string;
  o?: {
    id?: string;
    slg?: string;
  };
};

/**
 * Identity-only gate for user-scoped operations that must work even when
 * there's no active Clerk org — profile onboarding, the apex landing page, etc.
 * For tenant data access, use `requireOrgMember` or a role variant instead.
 */
export async function requireAuth(
  ctx: QueryCtx | MutationCtx | ActionCtx,
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw authError("NOT_AUTHENTICATED", "Not authenticated");
  return identity;
}

/** Clerk's Convex token can expose org claims either as top-level custom
 * claims (`orgId`, `orgSlug`) or in the compact built-in `o` object
 * (`o.id`, `o.slg`). Support both so auth keeps working across template
 * variations and SDK changes. */
export function getActiveOrgClaims(identity: unknown): {
  orgId: string | null;
  orgSlug: string | null;
} {
  const claims = identity as IdentityWithOrgClaims;
  const orgId = claims.orgId ?? claims.o?.id ?? null;
  const orgSlug = claims.orgSlug ?? claims.o?.slg ?? null;
  return { orgId, orgSlug };
}

export type OrgContext = {
  tokenIdentifier: string;
  orgId: string;
  orgSlug: string;
  userId: Id<"users">;
  membershipId: Id<"memberships">;
  role: Role;
  email?: string;
  name?: string;
};

export function isActiveMembership(
  membership: Doc<"memberships"> | null,
): membership is Doc<"memberships"> {
  return (
    membership !== null &&
    membership.removedAt === undefined &&
    membership.status !== "removed"
  );
}

/**
 * A server-resolved identity for work that runs without an auth token, such as
 * a scheduled action. Only ever built from `requireOrgMember`'s result and
 * passed to internal functions, so a client can never supply one.
 */
export type OrgViewer = { tokenIdentifier: string; orgId: string };

export const orgViewerValidator = v.object({
  tokenIdentifier: v.string(),
  orgId: v.string(),
});

export type ResolvedViewer = {
  tokenIdentifier: string;
  orgId: string;
  user: Doc<"users">;
  membership: Doc<"memberships">;
  role: Role;
};

type ViewerLookup =
  | { ok: true; viewer: ResolvedViewer }
  | {
      ok: false;
      code: "NOT_MEMBER" | "REMOVED" | "WORKSPACE_CLOSED";
      message: string;
    };

async function lookupOrgViewer(
  ctx: QueryCtx | MutationCtx,
  { tokenIdentifier, orgId }: OrgViewer,
): Promise<ViewerLookup> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", tokenIdentifier),
    )
    .unique();
  if (!user) {
    return { ok: false, code: "NOT_MEMBER", message: "User record not found" };
  }
  if (user.deletedAt !== undefined) {
    return { ok: false, code: "REMOVED", message: "User record not found" };
  }

  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_tokenIdentifier_and_clerkOrgId", (q) =>
      q.eq("tokenIdentifier", tokenIdentifier).eq("clerkOrgId", orgId),
    )
    .unique();
  if (!isActiveMembership(membership)) {
    // A tombstoned row means an admin is removing this member right now.
    return {
      ok: false,
      code: membership ? "REMOVED" : "NOT_MEMBER",
      message: "Not a member of this organization",
    };
  }

  // Checked after membership, so only members learn the workspace is closed.
  // Every member is shut out, staff included (docs/client-offboarding-plan.md).
  if (await isWorkspaceClosed(ctx, orgId)) {
    return {
      ok: false,
      code: "WORKSPACE_CLOSED",
      message: "This workspace is closed",
    };
  }

  return {
    ok: true,
    viewer: { tokenIdentifier, orgId, user, membership, role: membership.role },
  };
}

/**
 * The shared resolver: maps a viewer to its active user, membership and role
 * with the same lookup and `isActiveMembership` rule as `requireOrgMember`.
 * Returns null when the viewer is not (or no longer) an active member.
 */
export async function resolveOrgViewer(
  ctx: QueryCtx | MutationCtx,
  viewer: OrgViewer,
): Promise<ResolvedViewer | null> {
  const found = await lookupOrgViewer(ctx, viewer);
  return found.ok ? found.viewer : null;
}

/**
 * `requireOrgMember` for internal functions that receive a viewer instead of
 * an auth token. Re-resolves membership on every call, so a member removed
 * mid-task loses access at their next read.
 */
export async function requireOrgViewer(
  ctx: QueryCtx | MutationCtx,
  viewer: OrgViewer,
): Promise<ResolvedViewer> {
  const found = await lookupOrgViewer(ctx, viewer);
  if (!found.ok) throw authError(found.code, found.message);
  return found.viewer;
}

/**
 * Resolves identity + Fabric membership for the caller's active Clerk org.
 * Throws if not authenticated, no active org, user record missing, or no
 * membership row for that org. No platformRole bypass — super-admins access
 * client orgs via auto-provisioned memberships (Model A).
 */
export async function requireOrgMember(
  ctx: QueryCtx | MutationCtx,
): Promise<OrgContext> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw authError("NOT_AUTHENTICATED", "Not authenticated");

  const { orgId, orgSlug } = getActiveOrgClaims(identity);
  if (!orgId) throw authError("NO_ACTIVE_ORG", "No active organization");

  const { user, membership } = await requireOrgViewer(ctx, {
    tokenIdentifier: identity.tokenIdentifier,
    orgId,
  });

  return {
    tokenIdentifier: identity.tokenIdentifier,
    orgId,
    orgSlug: orgSlug ?? "",
    userId: user._id,
    membershipId: membership._id,
    role: membership.role,
    email: identity.email ?? undefined,
    name: identity.name ?? undefined,
  };
}

export async function requireOrgRole(
  ctx: QueryCtx | MutationCtx,
  minimum: Role,
): Promise<OrgContext> {
  const org = await requireOrgMember(ctx);
  if (RANK[org.role] < RANK[minimum]) {
    throw authError("INSUFFICIENT_ROLE", "Insufficient permissions");
  }
  return org;
}

export const requireOrgContributor = (ctx: QueryCtx | MutationCtx) =>
  requireOrgRole(ctx, "contributor");

export const requireOrgAdmin = (ctx: QueryCtx | MutationCtx) =>
  requireOrgRole(ctx, "admin");

/**
 * Throws "Not found" (not "Forbidden") when a document belongs to a different
 * org — avoids leaking existence across tenants.
 */
export function assertOrgOwns<T extends { clerkOrgId?: string }>(
  caller: { orgId: string },
  doc: T | null,
): asserts doc is T {
  if (!doc || doc.clerkOrgId !== caller.orgId) throw new Error("Not found");
}

/**
 * Action-safe: actions have no ctx.db. Public action entrypoints use this to
 * establish org context from the JWT, then pass `orgId` explicitly to every
 * internal query/mutation they invoke (internals do not re-read ctx.auth).
 */
export async function resolveOrgForAction(
  ctx: ActionCtx,
): Promise<{ orgId: string; orgSlug: string | null; tokenIdentifier: string }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw authError("NOT_AUTHENTICATED", "Not authenticated");
  const { orgId, orgSlug } = getActiveOrgClaims(identity);
  if (!orgId) throw authError("NO_ACTIVE_ORG", "No active organization");
  // Internals called from actions check membership with their own lookups,
  // so the closed-workspace gate is applied once here for all of them.
  const closed: boolean = await ctx.runQuery(
    internal.workspaceLifecycle.isClosedInternal,
    { clerkOrgId: orgId },
  );
  if (closed) throw authError("WORKSPACE_CLOSED", "This workspace is closed");
  return { orgId, orgSlug, tokenIdentifier: identity.tokenIdentifier };
}

// ---- Platform-scope helpers ------------------------------------------------

/**
 * Platform-level auth. Grants: create/delete orgs, fan-out action,
 * cross-org dashboards. Does NOT by itself grant access to any tenant's
 * data — for that, the super-admin must have (or auto-acquire) a membership
 * row via the fan-out flow.
 *
 * Intentionally does NOT require an active Clerk org — platform tools at the
 * apex domain must work even when no org is selected.
 */
export async function requireSuperAdmin(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw authError("NOT_AUTHENTICATED", "Not authenticated");

  const user = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user || user.deletedAt !== undefined) {
    throw authError("NOT_MEMBER", "User record not found");
  }
  if (user.platformRole !== "superAdmin") {
    throw authError("INSUFFICIENT_ROLE", "Platform super-admin required");
  }
  return user;
}

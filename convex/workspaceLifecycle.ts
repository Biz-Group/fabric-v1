import { v } from "convex/values";
import {
  action,
  type ActionCtx,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireSuperAdmin } from "./lib/orgAuth";
import {
  assertClerkId,
  ClerkApiError,
  clerkFetch,
  clerkUserIdFromTokenIdentifier,
} from "./lib/clerkApi";
import { userError } from "./lib/userError";
import {
  isClosedStatus,
  isWorkspaceClosed,
  PURGE_GRACE_MS,
} from "./lib/workspaceStatus";

// ---------------------------------------------------------------------------
// Workspace offboarding, phase 1: suspend and reinstate
// (docs/client-offboarding-plan.md).
//
// Suspending closes the workspace to everyone at once (lib/orgAuth.ts reads
// the status on every access), revokes its pending Clerk invitations, and
// sets the date the automatic purge runs (D2: 30 days later). Reinstating
// before then reopens it as it was, except that revoked invitations stay
// revoked. Platform super-admins only (D1).
//
// The Clerk org and its memberships stay until the purge, so a reinstated
// workspace needs nothing re-created.
// ---------------------------------------------------------------------------

const MAX_REASON_LENGTH = 500;
/** Clerk pages of pending invitations read per suspension (100 each). */
const MAX_INVITATION_PAGES = 10;

/** For `resolveOrgForAction`, which has no database access of its own. */
export const isClosedInternal = internalQuery({
  args: { clerkOrgId: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    return await isWorkspaceClosed(ctx, args.clerkOrgId);
  },
});

export const beginSuspension = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    actorUserId: v.id("users"),
    reason: v.string(),
    confirmSlug: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ clerkOrgId: string; purgeAfter: number }> => {
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) throw userError("NOT_FOUND", "That workspace doesn't exist.");
    if (isClosedStatus(tenant.status)) {
      throw userError("ALREADY_CLOSED", "This workspace is already closed.");
    }
    if (args.confirmSlug.trim().toLowerCase() !== tenant.slug.toLowerCase()) {
      throw userError(
        "CONFIRMATION_MISMATCH",
        `Type the workspace's address, ${tenant.slug}, to confirm.`,
      );
    }
    const reason = args.reason.trim();
    if (!reason) {
      throw userError("REASON_REQUIRED", "Say why this workspace is closing.");
    }
    if (reason.length > MAX_REASON_LENGTH) {
      throw userError(
        "REASON_TOO_LONG",
        `Keep the reason under ${MAX_REASON_LENGTH} characters.`,
      );
    }

    const actor = await ctx.db.get(args.actorUserId);
    const now = Date.now();
    const purgeAfter = now + PURGE_GRACE_MS;
    await ctx.db.patch(tenant._id, {
      status: "suspended",
      offboarding: {
        suspendedAt: now,
        suspendedByUserId: args.actorUserId,
        suspendedByName: actor?.name || "A platform admin",
        origin: "console",
        reason,
        purgeAfter,
      },
      updatedAt: now,
    });
    await ctx.db.insert("authAuditEvents", {
      clerkOrgId: tenant.clerkOrgId,
      actorUserId: args.actorUserId,
      action: "workspaceSuspended",
      detail: `Purge after ${new Date(purgeAfter).toISOString()}. Reason: ${reason}`,
      createdAt: now,
    });
    return { clerkOrgId: tenant.clerkOrgId, purgeAfter };
  },
});

export const recordInvitationRevocation = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    revoked: v.number(),
    errors: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const tenant = await ctx.db.get(args.tenantId);
    // Reinstated meanwhile: the result no longer describes a suspension.
    if (!tenant || tenant.status !== "suspended" || !tenant.offboarding) return;
    await ctx.db.patch(tenant._id, {
      offboarding: {
        ...tenant.offboarding,
        invitationsRevoked:
          (tenant.offboarding.invitationsRevoked ?? 0) + args.revoked,
        invitationRevokeErrors:
          args.errors.length > 0 ? args.errors : undefined,
      },
      updatedAt: Date.now(),
    });
  },
});

type ClerkInvitation = { id: string; organization_id: string };

/**
 * Revokes every pending Clerk invitation to the org, so nobody can accept one
 * into a closed workspace. One failure doesn't stop the rest; failures are
 * recorded on the tenant for the console to offer a retry.
 */
async function revokePendingInvitations(
  ctx: ActionCtx,
  tenantId: Id<"tenants">,
  clerkOrgId: string,
  requestingClerkUserId: string,
): Promise<{ revoked: number; errors: string[] }> {
  assertClerkId(clerkOrgId, "org");
  let revoked = 0;
  const errors: string[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < MAX_INVITATION_PAGES; page++) {
    let rows: ClerkInvitation[];
    try {
      // Always the first page: each pass revokes what it read, so the next
      // read returns what remains.
      const response = (await clerkFetch(
        `/organizations/${clerkOrgId}/invitations`,
        { query: { status: "pending", limit: "100" } },
      )) as { data: ClerkInvitation[] } | ClerkInvitation[];
      rows = (Array.isArray(response) ? response : response.data).filter(
        (row) => row.organization_id === clerkOrgId && !seen.has(row.id),
      );
    } catch (error) {
      errors.push(
        `Could not list pending invitations: ${error instanceof Error ? error.message : String(error)}`,
      );
      break;
    }
    if (rows.length === 0) break;

    for (const row of rows) {
      seen.add(row.id);
      try {
        const invitationId = assertClerkId(row.id, "orginv");
        await clerkFetch(
          `/organizations/${clerkOrgId}/invitations/${invitationId}/revoke`,
          {
            method: "POST",
            body: { requesting_user_id: requestingClerkUserId },
          },
        );
        await ctx.runMutation(internal.users.markInvitationRevoked, {
          clerkOrgId,
          clerkInvitationId: invitationId,
        });
        revoked++;
      } catch (error) {
        // Already accepted, expired or revoked elsewhere: nothing left to do.
        if (error instanceof ClerkApiError && error.status === 404) continue;
        errors.push(
          `${row.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  await ctx.runMutation(internal.workspaceLifecycle.recordInvitationRevocation, {
    tenantId,
    revoked,
    errors,
  });
  return { revoked, errors };
}

/**
 * Closes a workspace. `confirmSlug` must repeat the workspace's address, so
 * a slip of the mouse in the console can't close the wrong client.
 */
export const suspendWorkspace = action({
  args: {
    tenantId: v.id("tenants"),
    reason: v.string(),
    confirmSlug: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ purgeAfter: number; invitationsRevoked: number; errors: string[] }> => {
    const caller: { userId: Id<"users">; tokenIdentifier: string } =
      await ctx.runQuery(internal.platform.requireSuperAdminInternal, {});
    const { clerkOrgId, purgeAfter } = await ctx.runMutation(
      internal.workspaceLifecycle.beginSuspension,
      {
        tenantId: args.tenantId,
        actorUserId: caller.userId,
        reason: args.reason,
        confirmSlug: args.confirmSlug,
      },
    );
    const { revoked, errors } = await revokePendingInvitations(
      ctx,
      args.tenantId,
      clerkOrgId,
      clerkUserIdFromTokenIdentifier(caller.tokenIdentifier),
    );
    return { purgeAfter, invitationsRevoked: revoked, errors };
  },
});

export const getTenantForRetry = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args): Promise<Doc<"tenants"> | null> => {
    return await ctx.db.get(args.tenantId);
  },
});

/** Re-runs invitation revocation for a suspended workspace after a failure. */
export const retryInvitationRevocation = action({
  args: { tenantId: v.id("tenants") },
  handler: async (
    ctx,
    args,
  ): Promise<{ invitationsRevoked: number; errors: string[] }> => {
    const caller: { userId: Id<"users">; tokenIdentifier: string } =
      await ctx.runQuery(internal.platform.requireSuperAdminInternal, {});
    const tenant: Doc<"tenants"> | null = await ctx.runQuery(
      internal.workspaceLifecycle.getTenantForRetry,
      { tenantId: args.tenantId },
    );
    if (!tenant || tenant.status !== "suspended") {
      throw userError("NOT_SUSPENDED", "This workspace isn't suspended.");
    }
    const { revoked, errors } = await revokePendingInvitations(
      ctx,
      tenant._id,
      tenant.clerkOrgId,
      clerkUserIdFromTokenIdentifier(caller.tokenIdentifier),
    );
    return { invitationsRevoked: revoked, errors };
  },
});

/**
 * Reopens a suspended workspace and cancels its purge. Only from
 * `suspended`: once the purge starts there is nothing to reopen.
 */
export const reinstateWorkspace = mutation({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) throw userError("NOT_FOUND", "That workspace doesn't exist.");
    if (tenant.status !== "suspended") {
      throw userError(
        "NOT_SUSPENDED",
        tenant.status === "purging" || tenant.status === "purged"
          ? "This workspace's data is being or has been deleted, so it can't be reopened."
          : "This workspace isn't suspended.",
      );
    }
    if (tenant.offboarding?.origin === "clerkDeleted") {
      throw userError(
        "CLERK_ORG_DELETED",
        "This organization was deleted in Clerk, so the workspace can't be reopened. Export its data if it's needed.",
      );
    }
    const now = Date.now();
    const suspendedAt = tenant.offboarding?.suspendedAt;
    await ctx.db.patch(tenant._id, {
      // A workspace suspended with provisioning still unfinished goes back
      // to needing attention, so the retry stays visible.
      status:
        (tenant.provisioningErrors?.length ?? 0) > 0 ? "needsAttention" : "active",
      offboarding: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("authAuditEvents", {
      clerkOrgId: tenant.clerkOrgId,
      actorUserId: actor._id,
      action: "workspaceReinstated",
      detail: suspendedAt
        ? `Suspended ${new Date(suspendedAt).toISOString()}; purge cancelled. Revoked invitations were not restored.`
        : "Purge cancelled.",
      createdAt: now,
    });
    return null;
  },
});

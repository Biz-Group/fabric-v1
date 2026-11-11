import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

/**
 * Workspace offboarding states (docs/client-offboarding-plan.md).
 *
 *   active ──suspend──▶ suspended ──30 days──▶ purging ──▶ purged
 *     ▲                     │
 *     └─────reinstate───────┘
 *
 * A closed workspace keeps its data until the purge, but nobody can reach it:
 * not members, not invited people, not signed audio links, and not Biz Group
 * staff through their workspace memberships. The tenants console, which is
 * platform-gated rather than membership-gated, still sees it.
 *
 * `deleted` (the org was deleted in Clerk) is closed too: nothing should be
 * reachable in an org that no longer exists.
 */
export type TenantStatus = Doc<"tenants">["status"];

const CLOSED: ReadonlySet<TenantStatus> = new Set<TenantStatus>([
  "suspended",
  "purging",
  "purged",
  "deleted",
]);

/** Days between suspension and the automatic purge (D2). */
export const PURGE_GRACE_DAYS = 30;
export const PURGE_GRACE_MS = PURGE_GRACE_DAYS * 24 * 60 * 60 * 1000;

export function isClosedStatus(status: TenantStatus): boolean {
  return CLOSED.has(status);
}

export async function tenantForOrg(
  ctx: QueryCtx | MutationCtx,
  clerkOrgId: string,
): Promise<Doc<"tenants"> | null> {
  return await ctx.db
    .query("tenants")
    .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", clerkOrgId))
    .unique();
}

/**
 * Whether the org's workspace is closed. An org with no `tenants` row (one
 * the mirror hasn't seen yet) is open: the row is created by the console,
 * the Clerk webhook or the backfill, and its absence never meant "closed".
 */
export async function isWorkspaceClosed(
  ctx: QueryCtx | MutationCtx,
  clerkOrgId: string,
): Promise<boolean> {
  const tenant = await tenantForOrg(ctx, clerkOrgId);
  return tenant !== null && isClosedStatus(tenant.status);
}

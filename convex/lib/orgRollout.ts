/**
 * Per-tenant rollout switches on a shared deployment.
 *
 * A switch variable accepts three forms:
 *   - unset, empty, or `false` — off for every tenant.
 *   - `true` — on for every tenant on this deployment.
 *   - a comma-separated list of Clerk organization IDs — on for exactly those
 *     tenants, off for every other tenant on the same deployment.
 *
 * The list form exists because production is one Convex deployment shared by
 * every tenant. A boolean cannot express "internal tenant first, then selected
 * external tenants", which is the sequence a rollout requires; without it, the
 * only way to try a feature on one tenant is to enable it for all of them.
 *
 * Unknown or malformed entries simply never match an org, so a typo fails
 * closed rather than enabling a tenant by accident.
 */
export type OrgRollout =
  | { mode: "off" }
  | { mode: "all" }
  | { mode: "allowlist"; orgIds: ReadonlySet<string> };

export function parseOrgRollout(raw: string | undefined): OrgRollout {
  const value = raw?.trim();
  if (!value || value.toLowerCase() === "false") return { mode: "off" };
  if (value.toLowerCase() === "true") return { mode: "all" };
  const orgIds = new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
  // An allowlist that parsed to nothing is indistinguishable from off, and
  // treating it as off keeps every downstream check on the safe path.
  return orgIds.size === 0 ? { mode: "off" } : { mode: "allowlist", orgIds };
}

export function isOrgInRollout(
  rollout: OrgRollout,
  clerkOrgId: string,
): boolean {
  if (rollout.mode === "off") return false;
  if (rollout.mode === "all") return true;
  return rollout.orgIds.has(clerkOrgId);
}

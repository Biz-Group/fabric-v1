import { env } from "../_generated/server";
import { isOrgInRollout, parseOrgRollout, type OrgRollout } from "./orgRollout";

/**
 * Summary V2 rollout switch, in the shared per-tenant format (see
 * `orgRollout.ts`). Off is the rollback position: reads fall back to the
 * stored deterministic Markdown and no structured artifact is deleted.
 */
export type SummaryV2Rollout = OrgRollout;

export function parseSummaryV2Rollout(
  raw: string | undefined,
): SummaryV2Rollout {
  return parseOrgRollout(raw);
}

export function summaryV2Rollout(): SummaryV2Rollout {
  return parseSummaryV2Rollout(env.SUMMARY_V2);
}

export function isSummaryV2EnabledForOrg(clerkOrgId: string): boolean {
  return isOrgInRollout(summaryV2Rollout(), clerkOrgId);
}

/**
 * True when at least one tenant has V2 enabled. Only for deployment-wide
 * decisions that genuinely have no organization in hand; anything touching a
 * tenant's data must use `isSummaryV2EnabledForOrg`.
 */
export function isSummaryV2EnabledAnywhere(): boolean {
  return summaryV2Rollout().mode !== "off";
}

/**
 * Read half of the rollback switch. Disabling `SUMMARY_V2` for a tenant must
 * return every overview surface — UI, clipboard, and PDF — to the
 * deterministic legacy Markdown projection while every structured artifact
 * stays in the database, so reads hide `summaryV2` instead of deleting it.
 */
export function readableSummaryV2<T>(
  clerkOrgId: string,
  artifact: T | undefined,
): T | undefined {
  return isSummaryV2EnabledForOrg(clerkOrgId) ? artifact : undefined;
}

/**
 * Same gate for the list projections, which read `summaryV2` off the document
 * to derive lightweight state and coverage metadata. The row carries its own
 * `clerkOrgId`, so a caller cannot accidentally gate one tenant's row on
 * another tenant's rollout state.
 */
export function withSummaryV2ReadGate<
  T extends { clerkOrgId: string; summaryV2?: unknown },
>(row: T): T {
  if (isSummaryV2EnabledForOrg(row.clerkOrgId)) return row;
  const withoutArtifact = { ...row };
  delete withoutArtifact.summaryV2;
  return withoutArtifact;
}

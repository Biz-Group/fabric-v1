/**
 * The confidence an automation opportunity is shown and briefed with.
 *
 * The insights prompt defines `high` as "multiple contributors described this
 * friction", but that stage only sees the graph, never who said what, so it
 * can return `high` from a single person's account. One contributor cannot
 * support that definition, so display and brief both cap it at `medium`
 * (decision D8, docs/ui-audit-task-list.md). The stored value is untouched.
 *
 * Pure, so the tab and the copied brief cannot disagree.
 */

import type { AutomationOpportunity } from "@/features/automations/opportunity-brief";

export type OpportunityConfidence = AutomationOpportunity["confidence"];

export type EffectiveConfidence = {
  level: OpportunityConfidence;
  /** True when the stored level was lowered because of a single contributor. */
  capped: boolean;
};

export const CONFIDENCE_DEFINITION =
  "Confidence reflects how many contributors independently described this friction.";

export function effectiveOpportunityConfidence(
  confidence: OpportunityConfidence,
  /** Absent on older coverage records; unknown is never treated as one. */
  uniqueContributors: number | undefined,
): EffectiveConfidence {
  if (
    confidence === "high" &&
    uniqueContributors !== undefined &&
    uniqueContributors <= 1
  ) {
    return { level: "medium", capped: true };
  }
  return { level: confidence, capped: false };
}

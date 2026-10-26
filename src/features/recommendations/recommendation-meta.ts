import type { ClientRecommendation } from "../../../convex/recommendations";
import type { StatusTone } from "@/features/status/status-meta";

export type { ClientRecommendation };
export type RecommendationContent = NonNullable<ClientRecommendation["content"]>;
export type Intervention = RecommendationContent["intervention"];
export type DecisionStatus = ClientRecommendation["decisionStatus"];
export type DismissReason = NonNullable<ClientRecommendation["dismissReason"]>;
export type ScoreLevel = NonNullable<ClientRecommendation["scores"]>["value"]["level"];

export const INTERVENTION_LABEL: Record<Intervention, string> = {
  eliminate: "Remove a step",
  simplify: "Simplify",
  standardise: "Standardise",
  role_or_policy: "Role or policy",
  training: "Training",
  workflow: "Workflow",
  integration: "Integration",
  ai_assist: "AI assist",
  agent: "Agent",
};

const TECHNICAL: ReadonlySet<Intervention> = new Set([
  "workflow",
  "integration",
  "ai_assist",
  "agent",
]);

export function isTechnical(intervention: Intervention): boolean {
  return TECHNICAL.has(intervention);
}

export const DECISION_LABEL: Record<DecisionStatus, string> = {
  new: "New",
  shortlisted: "Shortlisted",
  dismissed: "Dismissed",
  in_progress: "In progress",
  done: "Done",
};

/** Only a decision asks for colour; "new" is the resting state. */
export const DECISION_TONE: Record<DecisionStatus, StatusTone> = {
  new: "neutral",
  shortlisted: "info",
  dismissed: "neutral",
  in_progress: "warning",
  done: "success",
};

export const DISMISS_REASONS: Array<{ value: DismissReason; label: string }> = [
  { value: "not_a_real_problem", label: "Not a real problem" },
  { value: "already_fixed", label: "Already fixed" },
  { value: "too_costly", label: "Too costly" },
  { value: "not_a_priority", label: "Not a priority" },
  { value: "wrong_recommendation", label: "Wrong recommendation" },
];

export const DISMISS_REASON_LABEL = Object.fromEntries(
  DISMISS_REASONS.map((reason) => [reason.value, reason.label]),
) as Record<DismissReason, string>;

export const CAUSE_BASIS_LABEL: Record<RecommendationContent["causeBasis"], string> = {
  reported: "Reported by a contributor",
  inferred: "Fabric's reading of the evidence",
  unknown: "Not known yet",
};

/** High value is good news; high effort is a cost worth flagging. */
export const VALUE_TONE: Record<ScoreLevel, StatusTone> = {
  high: "success",
  medium: "info",
  low: "neutral",
  unknown: "neutral",
};

export const EFFORT_TONE: Record<ScoreLevel, StatusTone> = {
  low: "success",
  medium: "neutral",
  high: "warning",
  unknown: "neutral",
};

export function interviewsLabel(interviews: number): string {
  if (interviews === 0) return "No interview cited";
  return `Based on ${interviews} ${interviews === 1 ? "interview" : "interviews"}`;
}

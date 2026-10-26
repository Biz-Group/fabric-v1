import type { FlowNodeCategory, FlowNodeDetail } from "./flowStages";
import {
  isTechnicalIntervention,
  type Intervention,
  type RecommendationFrequency,
} from "./recommendationStage";

/**
 * Value, effort and evidence for a recommendation, computed in code.
 *
 * The automation stage asked the model to rate its own confidence, and it rated
 * 136 of 188 single-interview opportunities "high" — the label meant nothing.
 * These scores are derived from the flow instead, so each one comes with the
 * two or three facts that produced it and can be tuned in one place. No hours
 * or currency figures: the evidence does not support them.
 */

export type ScoreLevel = "high" | "medium" | "low" | "unknown";
export type Score = { level: ScoreLevel; reasons: string[] };
export type Evidence = { interviews: number; contributors: number };

export type ScoringNode = {
  id: string;
  label: string;
  category: FlowNodeCategory;
  detail: FlowNodeDetail | null;
};

const CONVERSATION_REF = /Conv\.\s*(\d+)/g;

/**
 * Distinct interviews and contributors behind a set of steps, read from node
 * sources ("Name, Conv. N"). Counted, not labelled high/medium/low, because the
 * count is the honest version: most processes rest on one interview.
 */
export function deriveEvidence(nodes: readonly ScoringNode[]): Evidence {
  const interviews = new Set<string>();
  const contributors = new Set<string>();
  for (const node of nodes) {
    for (const source of node.detail?.sources ?? []) {
      const refs = [...source.matchAll(CONVERSATION_REF)].map((m) => m[1]);
      for (const ref of refs) interviews.add(ref);
      const name = source.split(/,\s*Conv\./)[0]?.trim();
      if (name) contributors.add(name.toLowerCase());
    }
  }
  return { interviews: interviews.size, contributors: contributors.size };
}

/** Distinct roles on the covered steps, first spelling kept. */
export function derivePeopleAffected(nodes: readonly ScoringNode[]): string[] {
  const seen = new Map<string, string>();
  for (const node of nodes) {
    for (const actor of node.detail?.actors ?? []) {
      const trimmed = actor.trim();
      const key = trimmed.toLowerCase();
      if (trimmed && !seen.has(key)) seen.set(key, trimmed);
    }
  }
  return [...seen.values()].slice(0, 12);
}

const FREQUENCY_POINTS: Record<RecommendationFrequency, number | null> = {
  daily: 3,
  weekly: 3,
  monthly: 2,
  quarterly: 1,
  annual: 1,
  ad_hoc: 1,
  unknown: null,
};

const FREQUENCY_REASON: Record<RecommendationFrequency, string> = {
  daily: "Runs daily",
  weekly: "Runs weekly",
  monthly: "Runs monthly",
  quarterly: "Runs quarterly",
  annual: "Runs about once a year",
  ad_hoc: "Runs as needed",
  unknown: "How often it runs wasn't described",
};

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Frequency × friction × reach. `unknown` rather than a guess when there is neither frequency nor friction. */
export function scoreValue(input: {
  frequency: RecommendationFrequency;
  covered: readonly ScoringNode[];
  evidence: Evidence;
  peopleAffected: readonly string[];
}): Score {
  const painPoints = new Set<string>();
  let bottlenecks = 0;
  for (const node of input.covered) {
    for (const point of node.detail?.painPoints ?? []) {
      painPoints.add(point.trim().toLowerCase());
    }
    if (node.detail?.isBottleneck) bottlenecks += 1;
  }
  const friction = painPoints.size + bottlenecks;
  const frictionPoints = friction === 0 ? 0 : friction <= 2 ? 1 : friction <= 4 ? 2 : 3;

  const reach = Math.max(input.peopleAffected.length, input.evidence.contributors);
  const reachPoints = reach === 0 ? 0 : reach <= 1 ? 1 : reach <= 3 ? 2 : 3;

  const frequencyPoints = FREQUENCY_POINTS[input.frequency];

  const frictionReason =
    friction === 0
      ? "No problems reported on these steps"
      : bottlenecks > 0
        ? `${plural(painPoints.size, "problem")} reported, ${plural(bottlenecks, "bottleneck")}`
        : `${plural(painPoints.size, "problem")} reported`;

  if (frequencyPoints === null && friction === 0) {
    return {
      level: "unknown",
      reasons: [FREQUENCY_REASON.unknown, frictionReason],
    };
  }

  const total = (frequencyPoints ?? 1.5) + frictionPoints + reachPoints;
  const level: ScoreLevel = total >= 7 ? "high" : total >= 5 ? "medium" : "low";
  const reasons = [FREQUENCY_REASON[input.frequency], frictionReason];
  if (reach > 0) reasons.push(`${plural(reach, "role")} involved`);
  return { level, reasons };
}

const RUNG_EFFORT: Record<Intervention, number> = {
  eliminate: 0,
  simplify: 1,
  standardise: 1,
  role_or_policy: 1,
  training: 1,
  workflow: 2,
  ai_assist: 2,
  integration: 3,
  agent: 3,
};

const RUNG_REASON: Record<Intervention, string> = {
  eliminate: "Removes a step",
  simplify: "Simplifies existing steps",
  standardise: "Writes down how it's done",
  role_or_policy: "Changes a role or rule",
  training: "Uses tools people already have",
  workflow: "Needs an automated workflow",
  ai_assist: "Needs an AI assistant",
  integration: "Connects systems",
  agent: "Needs an AI agent",
};

/** Rung, systems, decision points, judgement and span. */
export function scoreEffort(input: {
  intervention: Intervention;
  covered: readonly ScoringNode[];
}): Score {
  const technical = isTechnicalIntervention(input.intervention);
  let points = RUNG_EFFORT[input.intervention];
  const reasons = [RUNG_REASON[input.intervention]];

  const systems = new Set<string>();
  for (const node of input.covered) {
    for (const tool of node.detail?.tools ?? []) {
      systems.add(tool.trim().toLowerCase());
    }
  }
  if (technical && systems.size > 0) {
    points += systems.size >= 3 ? 2 : 1;
    reasons.push(`Touches ${plural(systems.size, "system")}`);
  }

  const decisions = input.covered.filter(
    (node) => node.category === "decision",
  ).length;
  if (decisions >= 2) {
    points += 1;
    reasons.push(`${plural(decisions, "decision point")}`);
  }

  // "low" automation potential is the detail stage's marker for a step that
  // needs human judgement. Only an AI change takes that judgement over and so
  // pays for it; a workflow or integration routes around those steps and
  // leaves the person deciding, and a role change does not touch them at all.
  const takesOverJudgement =
    input.intervention === "ai_assist" || input.intervention === "agent";
  const judgement = input.covered.filter(
    (node) => node.detail?.automationPotential === "low",
  ).length;
  if (takesOverJudgement && judgement > 0) {
    points += 1;
    reasons.push(`${plural(judgement, "step")} needing human judgement`);
  }

  if (input.covered.length >= 5) {
    points += 1;
    reasons.push(`Spans ${input.covered.length} steps`);
  }

  const level: ScoreLevel = points <= 1 ? "low" : points <= 3 ? "medium" : "high";
  return { level, reasons: reasons.slice(0, 3) };
}

export function computeRecommendationScores(input: {
  intervention: Intervention;
  frequency: RecommendationFrequency;
  nodeIds: readonly string[];
  nodes: readonly ScoringNode[];
}) {
  const wanted = new Set(input.nodeIds);
  const covered = input.nodes.filter((node) => wanted.has(node.id));
  const evidence = deriveEvidence(covered);
  const peopleAffected = derivePeopleAffected(covered);
  return {
    value: scoreValue({
      frequency: input.frequency,
      covered,
      evidence,
      peopleAffected,
    }),
    effort: scoreEffort({ intervention: input.intervention, covered }),
    evidence,
    peopleAffected,
  };
}

export function recommendationMatchKey(
  nodeIds: readonly string[],
  intervention: string,
): string {
  return `${[...new Set(nodeIds)].sort().join(",")}|${intervention}`;
}

const VALUE_ORDER: Record<ScoreLevel, number> = {
  high: 0,
  medium: 1,
  low: 2,
  unknown: 3,
};
const EFFORT_ORDER: Record<ScoreLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  unknown: 3,
};

/** Value first, then the cheaper change, then the better-evidenced one. */
export function compareRecommendations(
  a: { scores?: { value: Score; effort: Score; evidence: Evidence }; createdAt: number },
  b: { scores?: { value: Score; effort: Score; evidence: Evidence }; createdAt: number },
): number {
  const av = VALUE_ORDER[a.scores?.value.level ?? "unknown"];
  const bv = VALUE_ORDER[b.scores?.value.level ?? "unknown"];
  if (av !== bv) return av - bv;
  const ae = EFFORT_ORDER[a.scores?.effort.level ?? "unknown"];
  const be = EFFORT_ORDER[b.scores?.effort.level ?? "unknown"];
  if (ae !== be) return ae - be;
  const ai = a.scores?.evidence.interviews ?? 0;
  const bi = b.scores?.evidence.interviews ?? 0;
  if (ai !== bi) return bi - ai;
  return a.createdAt - b.createdAt;
}

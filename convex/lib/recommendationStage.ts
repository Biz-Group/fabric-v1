import type { AIJsonSchema } from "./aiProvider";
import { withUntrustedEvidenceBoundary } from "./aiPromptSafety";
import type { FlowNodeCategory, FlowNodeDetail } from "./flowStages";

/**
 * Prompt, schema, input and normalizer for the recommendation stage.
 *
 * This replaces the automation-only insights call. That call framed every
 * problem as something to automate — it had no other answer to give — so a
 * supplier list one manager controlled became a database migration, when the
 * contributor had described a permissions problem. This stage diagnoses first,
 * then picks the least complex change that would work, from removing a step to
 * building an agent. See docs/process-improvement-recommendations-plan.md §6.
 *
 * It runs after the flow is finalized, in its own scheduled action with its own
 * status, so a slow or failed pass costs the recommendations, never the flow.
 */

/** Bumped whenever the prompt or schema changes meaning. Stored on every run. */
export const RECOMMENDATIONS_PROMPT_VERSION = "recommendations-v7-2026-10-26";

/**
 * This stage reasons before it answers (`RECOMMENDATIONS_REASONING`): deciding
 * the cause, the simplest fix and what could build on it is judgement, and a
 * forced tool call on Haiku 5.5 answers with no thinking at all. Thinking
 * counts toward `maxTokens`, so the cap is the ~6,000 the answer needs plus
 * room to think. `isWithinTimeBudget(12_000, 140_000)` holds against
 * MEASURED_THROUGHPUT (ceiling ~12,300). One SDK retry plus one re-ask when the
 * model answers in text instead of calling the tool: 2 x 2 x 140 s = 560 s,
 * inside the 10-minute action limit.
 */
export const RECOMMENDATIONS_MAX_TOKENS = 12_000;
export const RECOMMENDATIONS_TIMEOUT_MS = 140_000;
export const RECOMMENDATIONS_MAX_RETRIES = 1;
export const RECOMMENDATIONS_REASONING = "medium" as const;
/** Calls per run when the model answers in text instead of the tool. */
export const RECOMMENDATIONS_MAX_ASKS = 2;

/** Zero is a valid answer; more than this is a list nobody acts on. */
export const MAX_RECOMMENDATIONS = 5;

/**
 * Technical follow-ons are published on top of the five, each tied to the
 * recommendation it builds on. Capped so a process still reads as a short
 * list: at most eight in all.
 */
export const MAX_FOLLOW_ONS = 3;

const TOOL_NAME = "return_process_recommendations";

export const INTERVENTIONS = [
  "eliminate",
  "simplify",
  "standardise",
  "role_or_policy",
  "training",
  "workflow",
  "integration",
  "ai_assist",
  "agent",
] as const;
export type Intervention = (typeof INTERVENTIONS)[number];

export const TECHNICAL_INTERVENTIONS: ReadonlySet<Intervention> = new Set([
  "workflow",
  "integration",
  "ai_assist",
  "agent",
]);

export function isTechnicalIntervention(intervention: Intervention): boolean {
  return TECHNICAL_INTERVENTIONS.has(intervention);
}

export const FREQUENCIES = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "annual",
  "ad_hoc",
  "unknown",
] as const;
export type RecommendationFrequency = (typeof FREQUENCIES)[number];

export type CauseBasis = "reported" | "inferred" | "unknown";

/** What the model returns for one recommendation, after normalizing. */
export type GeneratedRecommendation = {
  title: string;
  problem: string;
  cause: string;
  causeBasis: CauseBasis;
  intervention: Intervention;
  supportingInterventions: Intervention[];
  proposedChange: string;
  whyNotSimpler?: string;
  nodeIds: string[];
  pilot: { what: string; measure: string };
  openQuestions: string[];
  risks: string[];
  frequency: RecommendationFrequency;
  previousRecommendationId?: string;
  /** For a follow-on: the position of the recommendation it builds on. */
  buildsOnIndex?: number;
};

export const RECOMMENDATIONS_SYSTEM_PROMPT = withUntrustedEvidenceBoundary(`You are an operations improvement adviser reviewing a fully mapped business process. You receive every step with what employees said about it in interviews, how the steps connect, how often the process runs, and any recommendations already made for this process.

Your job is to recommend the changes the process owner should consider. Diagnose before you prescribe: say what the problem is and why it happens, then choose the least complex change that would fix it.

## Kinds of change, simplest first
- "eliminate": stop doing a step that adds nothing (a duplicate sign-off nobody acts on)
- "simplify": merge or shorten steps (two forms become one)
- "standardise": write down how it should be done (a checklist, a template, a definition)
- "role_or_policy": change who does it or what the rule is (give coordinators edit rights; change who approves under a threshold)
- "training": people already have what they need but do not know how to use it
- "workflow": a deterministic automated flow — routing, approvals with reminders, notifications, data movement
- "integration": make two systems exchange data so nobody re-keys it
- "ai_assist": AI drafts, summarises or compares, and a person checks the result
- "agent": an AI agent handles requests end to end with tools and escalation

Consider them in this order. Many real problems are about ownership, access, rules or habits rather than missing software — a spreadsheet only one manager can edit is a permissions problem before it is a database problem — so fix the cause with the simplest change that works.

The ladder is a sequence, not a choice of one. A simple fix often leaves work behind that is still repetitive, rule-based or slow, and a technical change can build on it: write the runbook, then an assistant answers cover staff from it; agree the escalation checklist, then draft each escalation against it; write the redirect rule, then a workflow sends the redirect. That is what followOn is for: every non-technical recommendation must answer it.

Where a technical change needs a simpler change first, make the simpler change the recommendation and the technical change its followOn — not a technical recommendation with the simpler change listed under supportingInterventions. Make a technical change a recommendation of its own only when nothing simpler has to happen first. If a followOn builds on several of your recommendations, attach it to the one it depends on most, name the others in its problem, and do not repeat it under them. A recommendation may also name supporting changes ("standardise the template, then route it with a workflow").

Each step is marked as rule-based, partly rule-based, needing human judgement, or already automated. Rule-based steps that happen often are worth improving even if nobody complained about them — say so in the problem ("done by hand for every ticket; nobody reported it as a problem") rather than inventing a complaint.

## For each recommendation
- title: this change only, in plain words (4-10 words). Leave what comes after it to followOn — not "write the runbook, then automate it".
- problem: what contributors described going wrong, and on which steps. Concrete, grounded in what was said.
- cause: why it happens
- causeBasis: "reported" if a contributor said why; "inferred" if you are reading it from the evidence; "unknown" if neither
- intervention: the primary kind of change
- supportingInterventions: other kinds of change it depends on, or empty
- proposedChange: what to change, in 2-4 sentences, written for the process owner rather than a developer
- whyNotSimpler: for workflow, integration, ai_assist and agent only — why a non-technical change is not enough, or what the simpler change leaves undone
- nodeIds: the steps it changes. Every id must come from the process you were given.
- pilot.what: a small trial — what, for whom, for how long
- pilot.measure: the one observable thing that would show it worked (a wait that disappears, a rework loop that stops, a count that drops). No invented figures.
- openQuestions: what we would need to know before acting, specific to this recommendation
- risks: what could go wrong if the change is made
- frequency: how often the affected work happens, normalised from what contributors said: daily, weekly, monthly, quarterly, annual, ad_hoc, or unknown
- previousRecommendationId: if this is the same recommendation as one listed under "Current recommendations", its id. Otherwise omit it.
- followOn: once this change is in place, what technical change could build on it?
  - kind: "workflow", "integration", "ai_assist" or "agent" — or "none" when the work left over needs human judgement throughout, happens rarely, or is already handled. Always "none" when this recommendation is itself technical.
  - When kind is not "none", also give: title; problem (the repetitive, rule-based or slow work the simpler change leaves undone); proposedChange; whyNotSimpler (why it is worth doing on top of the simpler change); nodeIds; pilot; openQuestions; risks; and previousRecommendationId if it matches a current recommendation.
  - Decide this for each recommendation on its merits. "none" is a real answer, but do not default to it.

## Rules
- Ground everything in the evidence. Recommend changes where contributors described a problem, or where frequent work is rule-based and done by hand.
- Refer to people by role or team, never by name.
- Do not invent steps, systems, savings, hours, costs or percentages.
- Return between 0 and ${MAX_RECOMMENDATIONS} recommendations, most important first, none overlapping. If the evidence does not justify any change, return an empty list — that is a valid answer.
- A recommendation listed under "Dismissed" was rejected by the organisation. Do not propose it again unless the evidence has clearly changed; if you do, give its id as previousRecommendationId.

Think it through first. Then call the return_process_recommendations tool exactly once with your answer — never answer in text.`);

const INTERVENTION_ENUM = [...INTERVENTIONS];

const RESPONSE_SCHEMA: AIJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          problem: { type: "string" },
          cause: { type: "string" },
          causeBasis: {
            type: "string",
            enum: ["reported", "inferred", "unknown"],
          },
          intervention: { type: "string", enum: INTERVENTION_ENUM },
          supportingInterventions: {
            type: "array",
            items: { type: "string", enum: INTERVENTION_ENUM },
          },
          proposedChange: { type: "string" },
          whyNotSimpler: { type: "string" },
          nodeIds: { type: "array", items: { type: "string" } },
          pilot: {
            type: "object",
            additionalProperties: false,
            properties: {
              what: { type: "string" },
              measure: { type: "string" },
            },
            required: ["what", "measure"],
          },
          openQuestions: { type: "array", items: { type: "string" } },
          risks: { type: "array", items: { type: "string" } },
          frequency: { type: "string", enum: [...FREQUENCIES] },
          previousRecommendationId: { type: "string" },
          followOn: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: {
                type: "string",
                enum: ["none", "workflow", "integration", "ai_assist", "agent"],
              },
              title: { type: "string" },
              problem: { type: "string" },
              proposedChange: { type: "string" },
              whyNotSimpler: { type: "string" },
              nodeIds: { type: "array", items: { type: "string" } },
              pilot: {
                type: "object",
                additionalProperties: false,
                properties: {
                  what: { type: "string" },
                  measure: { type: "string" },
                },
                required: ["what", "measure"],
              },
              openQuestions: { type: "array", items: { type: "string" } },
              risks: { type: "array", items: { type: "string" } },
              previousRecommendationId: { type: "string" },
            },
            required: ["kind"],
          },
        },
        required: [
          "title",
          "problem",
          "cause",
          "causeBasis",
          "intervention",
          "supportingInterventions",
          "proposedChange",
          "nodeIds",
          "pilot",
          "openQuestions",
          "risks",
          "frequency",
          "followOn",
        ],
      },
    },
  },
  required: ["recommendations"],
};

export function buildRecommendationsAIRequest(userContent: string) {
  return {
    capability: "synthesis" as const,
    operation: "process-recommendations",
    system: RECOMMENDATIONS_SYSTEM_PROMPT,
    user: userContent,
    maxTokens: RECOMMENDATIONS_MAX_TOKENS,
    timeoutMs: RECOMMENDATIONS_TIMEOUT_MS,
    maxRetries: RECOMMENDATIONS_MAX_RETRIES,
    reasoning: RECOMMENDATIONS_REASONING,
    tool: {
      name: TOOL_NAME,
      description:
        "Return the improvement recommendations for this process, simplest effective change first.",
      inputSchema: RESPONSE_SCHEMA,
    },
  };
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type RecommendationInputNode = {
  id: string;
  label: string;
  category: FlowNodeCategory;
  detail: FlowNodeDetail | null;
};

export type RecommendationInputContext = {
  /** "Conv. N" — position in the flow's evidence, never a name. */
  ref: string;
  frequency?: string;
  volume?: string;
  totalDuration?: string;
  approvals?: string;
  edgeCases?: string;
  dependencies?: string;
};

export type ExistingRecommendationSummary = {
  id: string;
  title: string;
  problem: string;
  decisionStatus: string;
  dismissReason?: string;
};

const CONVERSATION_REF = /Conv\.\s*\d+/g;

/**
 * Node sources read "Name, Conv. N". The model only needs to know which
 * interviews back a step, so names are dropped before they reach it — that is
 * cheaper and surer than asking it not to repeat them.
 */
export function anonymiseSources(sources: readonly string[]): string[] {
  const refs = new Set<string>();
  for (const source of sources) {
    const matches = source.match(CONVERSATION_REF);
    if (matches && matches.length > 0) {
      for (const match of matches) refs.add(match.replace(/\s+/g, " "));
    } else {
      refs.add("a contributor");
    }
  }
  return [...refs];
}

/**
 * The detail stage's automation-potential rating, said neutrally. The model
 * needs to know which work is rule-based and which needs judgement; the word
 * "automation" invites it to answer every problem with software, which is what
 * the old stage did.
 */
const STEP_NATURE: Record<FlowNodeDetail["automationPotential"], string> = {
  high: "rule-based and repetitive",
  medium: "partly rule-based",
  low: "needs human judgement",
  none: "already automated",
};

export function buildRecommendationsUserContent(input: {
  nodes: RecommendationInputNode[];
  edges: Array<{ source: string; target: string; type: string; label?: string }>;
  contexts: RecommendationInputContext[];
  current: ExistingRecommendationSummary[];
  dismissed: ExistingRecommendationSummary[];
}): string {
  const steps = input.nodes
    .map((node) => {
      const lines = [`### ${node.id} — ${node.label} (${node.category})`];
      const detail = node.detail;
      if (!detail) {
        lines.push("No description available for this step.");
        return lines.join("\n");
      }
      if (detail.description) lines.push(detail.description);
      if (detail.actors.length) lines.push(`Who: ${detail.actors.join(", ")}`);
      if (detail.tools.length) lines.push(`Tools: ${detail.tools.join(", ")}`);
      if (detail.estimatedDuration) {
        lines.push(`Duration: ${detail.estimatedDuration}`);
      }
      if (detail.painPoints.length) {
        lines.push(`Problems reported: ${detail.painPoints.join(" | ")}`);
      }
      if (detail.riskIndicators.length) {
        lines.push(`Risks: ${detail.riskIndicators.join(" | ")}`);
      }
      lines.push(`Nature: ${STEP_NATURE[detail.automationPotential]}`);
      const flags = [
        detail.isBottleneck ? "bottleneck" : null,
        detail.isTribalKnowledge ? "knowledge held by one person" : null,
      ].filter(Boolean);
      if (flags.length) lines.push(`Flags: ${flags.join(", ")}`);
      const sources = anonymiseSources(detail.sources);
      if (sources.length) lines.push(`Described in: ${sources.join(", ")}`);
      return lines.join("\n");
    })
    .join("\n\n");

  const connections = input.edges
    .map(
      (edge) =>
        `- ${edge.source} -> ${edge.target} (${edge.type}${edge.label ? `: ${edge.label}` : ""})`,
    )
    .join("\n");

  const contextLines = input.contexts
    .map((context) => {
      const parts = [
        context.frequency ? `how often: ${context.frequency}` : null,
        context.volume ? `how many: ${context.volume}` : null,
        context.totalDuration ? `end to end: ${context.totalDuration}` : null,
        context.approvals ? `approvals: ${context.approvals}` : null,
        context.edgeCases ? `exceptions: ${context.edgeCases}` : null,
        context.dependencies ? `depends on: ${context.dependencies}` : null,
      ].filter(Boolean);
      return parts.length ? `- ${context.ref}: ${parts.join("; ")}` : null;
    })
    .filter(Boolean)
    .join("\n");

  const sections = [
    `## Process steps\n\n${steps}`,
    `## Connections\n\n${connections || "None recorded."}`,
    `## How often, how much, and under what rules (from interviews)\n\n${
      contextLines || "Not described in any interview."
    }`,
  ];

  if (input.current.length > 0) {
    sections.push(
      `## Current recommendations\n\n${input.current
        .map(
          (rec) =>
            `- id ${rec.id} (${rec.decisionStatus}): ${rec.title} — ${rec.problem}`,
        )
        .join("\n")}`,
    );
  }
  if (input.dismissed.length > 0) {
    sections.push(
      `## Dismissed\n\n${input.dismissed
        .map(
          (rec) =>
            `- id ${rec.id}: ${rec.title} — ${rec.problem}${
              rec.dismissReason ? ` (reason: ${rec.dismissReason.replace(/_/g, " ")})` : ""
            }`,
        )
        .join("\n")}`,
    );
  }

  return sections.join("\n\n---\n\n");
}

/**
 * With the tool offered rather than forced, Haiku 5.5 sometimes sends a nested
 * array or object as a JSON string. Parsing it back is cheaper than asking
 * again, which costs a second ~30 s call.
 */
function parseIfJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** The tool input, with a stringified `recommendations` list read back. */
export function readRecommendationsPayload(
  payload: unknown,
): { recommendations: unknown[] } | null {
  if (!payload || typeof payload !== "object") return null;
  const list = parseIfJsonString(
    (payload as Record<string, unknown>).recommendations,
  );
  return Array.isArray(list) ? { recommendations: list } : null;
}

/** For the log: what arrived instead of a list. Shape only, no content. */
export function describePayloadShape(payload: unknown): string {
  if (!payload || typeof payload !== "object") return typeof payload;
  const list = (payload as Record<string, unknown>).recommendations;
  return Array.isArray(list) ? "array" : typeof list;
}

// ---------------------------------------------------------------------------
// Normalizing — a provider that drifts from the schema degrades a field or
// drops one recommendation, never fails the run.
// ---------------------------------------------------------------------------

/** Long enough for any honest answer; short enough to keep rows small. */
const MAX_TEXT = 1_200;
const MAX_LIST = 5;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "";
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(text)
    .filter((item) => item.length > 0)
    .slice(0, MAX_LIST);
}

const INTERVENTION_SET = new Set<string>(INTERVENTIONS);
const FREQUENCY_SET = new Set<string>(FREQUENCIES);
const CAUSE_BASIS_SET = new Set<string>(["reported", "inferred", "unknown"]);

export function normalizeRecommendations(
  payload: unknown,
  knownNodeIds: readonly string[],
): GeneratedRecommendation[] {
  const known = new Set(knownNodeIds);
  const parsed = (payload ?? {}) as Record<string, unknown>;
  const entries = Array.isArray(parsed.recommendations)
    ? parsed.recommendations
    : [];

  const out: GeneratedRecommendation[] = [];
  // Follow-ons wait until every primary recommendation is in, so the primaries
  // keep the first positions and a follow-on can point at its parent.
  const followOns: Array<{ parentIndex: number; raw: Record<string, unknown> }> = [];
  for (const raw of entries) {
    if (out.length >= MAX_RECOMMENDATIONS) break;
    const entry = (raw ?? {}) as Record<string, unknown>;

    const title = text(entry.title);
    const problem = text(entry.problem);
    const proposedChange = text(entry.proposedChange);
    if (!title || !problem || !proposedChange) continue;

    // A recommendation that cannot say which kind of change it is cannot be
    // ranked, planned or built from, so it is dropped rather than guessed.
    const intervention = String(entry.intervention);
    if (!INTERVENTION_SET.has(intervention)) continue;

    const nodeIds = [
      ...new Set(
        (Array.isArray(entry.nodeIds) ? entry.nodeIds : [])
          .map(String)
          .filter((id) => known.has(id)),
      ),
    ];
    if (nodeIds.length === 0) continue;

    const supportingInterventions = [
      ...new Set(
        (Array.isArray(entry.supportingInterventions)
          ? entry.supportingInterventions
          : []
        )
          .map(String)
          .filter((value) => INTERVENTION_SET.has(value) && value !== intervention),
      ),
    ] as Intervention[];

    const cause = text(entry.cause);
    const causeBasisRaw = String(entry.causeBasis);
    const causeBasis: CauseBasis = !cause
      ? "unknown"
      : CAUSE_BASIS_SET.has(causeBasisRaw)
        ? (causeBasisRaw as CauseBasis)
        : "inferred";

    const frequencyRaw = String(entry.frequency);
    const pilot = (parseIfJsonString(entry.pilot) ?? {}) as Record<string, unknown>;
    const whyNotSimpler = text(entry.whyNotSimpler);
    const previousRecommendationId = text(entry.previousRecommendationId);

    out.push({
      title,
      problem,
      cause,
      causeBasis,
      intervention: intervention as Intervention,
      supportingInterventions,
      proposedChange,
      whyNotSimpler:
        whyNotSimpler && isTechnicalIntervention(intervention as Intervention)
          ? whyNotSimpler
          : undefined,
      nodeIds,
      pilot: { what: text(pilot.what), measure: text(pilot.measure) },
      openQuestions: textList(entry.openQuestions),
      risks: textList(entry.risks),
      frequency: (FREQUENCY_SET.has(frequencyRaw)
        ? frequencyRaw
        : "unknown") as RecommendationFrequency,
      previousRecommendationId: previousRecommendationId || undefined,
    });

    const followOn = (parseIfJsonString(entry.followOn) ?? {}) as Record<
      string,
      unknown
    >;
    if (
      !isTechnicalIntervention(intervention as Intervention) &&
      TECHNICAL_INTERVENTIONS.has(String(followOn.kind) as Intervention)
    ) {
      followOns.push({ parentIndex: out.length - 1, raw: followOn });
    }
  }

  // Two parents can propose the same next step. It is kept once, under the
  // first — higher-ranked — parent, which is the order they arrive in.
  const seenFollowOns = new Set<string>();
  for (const { parentIndex, raw } of followOns) {
    if (out.length >= MAX_RECOMMENDATIONS + MAX_FOLLOW_ONS) break;
    const parent = out[parentIndex];
    const title = text(raw.title);
    const problem = text(raw.problem);
    const proposedChange = text(raw.proposedChange);
    if (!title || !problem || !proposedChange) continue;
    // A follow-on may name steps of its own; without any, it acts on the
    // steps of the change it builds on.
    const ownNodeIds = [
      ...new Set(
        (Array.isArray(raw.nodeIds) ? raw.nodeIds : [])
          .map(String)
          .filter((id) => known.has(id)),
      ),
    ];
    const nodeIds = ownNodeIds.length > 0 ? ownNodeIds : parent.nodeIds;
    const sameChange = `${String(raw.kind)}|${[...nodeIds].sort().join(",")}`;
    const sameTitle = `title|${title.toLowerCase()}`;
    if (seenFollowOns.has(sameChange) || seenFollowOns.has(sameTitle)) continue;
    seenFollowOns.add(sameChange);
    seenFollowOns.add(sameTitle);

    const pilot = (parseIfJsonString(raw.pilot) ?? {}) as Record<string, unknown>;
    const previousRecommendationId = text(raw.previousRecommendationId);
    out.push({
      title,
      problem,
      // It shares the parent's diagnosis: the follow-on exists because of
      // what the parent's fix leaves undone.
      cause: parent.cause,
      causeBasis: parent.causeBasis,
      intervention: String(raw.kind) as Intervention,
      supportingInterventions: [parent.intervention],
      proposedChange,
      whyNotSimpler: text(raw.whyNotSimpler) || undefined,
      nodeIds,
      pilot: { what: text(pilot.what), measure: text(pilot.measure) },
      openQuestions: textList(raw.openQuestions),
      risks: textList(raw.risks),
      frequency: parent.frequency,
      previousRecommendationId: previousRecommendationId || undefined,
      buildsOnIndex: parentIndex,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The automation-opportunity shape, for surfaces that still read it
// ---------------------------------------------------------------------------

const OPPORTUNITY_KIND: Record<
  "workflow" | "integration" | "ai_assist" | "agent",
  "workflow" | "integration" | "agent"
> = {
  workflow: "workflow",
  integration: "integration",
  ai_assist: "agent",
  agent: "agent",
};

/**
 * A technical recommendation in the automation-opportunity shape. Two uses:
 * the dual-write that keeps Insights, the PDF and AskFabric reading
 * `processFlows.insights` while they move over, and the V0 composed brief that
 * technical recommendations keep until build specs exist (plan Phase 5).
 * Non-technical recommendations have no such shape and return null.
 */
export function toAutomationOpportunity(rec: {
  title: string;
  nodeIds: string[];
  content: {
    intervention: Intervention;
    proposedChange: string;
    openQuestions: string[];
  };
  scores: { evidence: { contributors: number } };
}): {
  title: string;
  kind: "workflow" | "integration" | "agent";
  nodeIds: string[];
  rationale: string;
  prerequisites: string[];
  confidence: "high" | "medium" | "low";
} | null {
  const intervention = rec.content.intervention;
  if (!isTechnicalIntervention(intervention)) return null;
  const contributors = rec.scores.evidence.contributors;
  return {
    title: rec.title,
    kind: OPPORTUNITY_KIND[
      intervention as "workflow" | "integration" | "ai_assist" | "agent"
    ],
    nodeIds: rec.nodeIds,
    rationale: rec.content.proposedChange,
    prerequisites: rec.content.openQuestions,
    // The detail stage's own definition: high means 2+ contributors.
    confidence: contributors >= 2 ? "high" : contributors === 1 ? "medium" : "low",
  };
}

// ---------------------------------------------------------------------------
// Contributor-name check
// ---------------------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces contributor names the model repeated anyway with "a contributor".
 *
 * Names are stripped from the input, but actors and free-text answers can still
 * carry them. Full names go first so "Alice Smith" does not become
 * "a contributor Smith". Single name parts are matched case-sensitively and only
 * when three letters or longer, so "Will" in "Will Jones" is caught but the
 * word "will" is not.
 */
export function scrubContributorNames(
  recommendations: GeneratedRecommendation[],
  contributorNames: readonly string[],
): { recommendations: GeneratedRecommendation[]; replacements: number } {
  const fullNames = [
    ...new Set(contributorNames.map((name) => name.trim()).filter(Boolean)),
  ];
  const parts = [
    ...new Set(
      fullNames
        .flatMap((name) => name.split(/\s+/))
        .filter((part) => part.length >= 3 && /^\p{Lu}/u.test(part)),
    ),
  ];
  const patterns = [...fullNames, ...parts]
    .sort((a, b) => b.length - a.length)
    .map((name) => new RegExp(`(?<![\\p{L}])${escapeRegExp(name)}(?![\\p{L}])`, "gu"));

  let replacements = 0;
  const scrub = (value: string): string => {
    let result = value;
    for (const pattern of patterns) {
      result = result.replace(pattern, () => {
        replacements += 1;
        return "a contributor";
      });
    }
    return result;
  };
  const scrubList = (values: string[]) => values.map(scrub);

  if (patterns.length === 0) return { recommendations, replacements: 0 };

  return {
    recommendations: recommendations.map((rec) => ({
      ...rec,
      title: scrub(rec.title),
      problem: scrub(rec.problem),
      cause: scrub(rec.cause),
      proposedChange: scrub(rec.proposedChange),
      whyNotSimpler: rec.whyNotSimpler ? scrub(rec.whyNotSimpler) : undefined,
      pilot: { what: scrub(rec.pilot.what), measure: scrub(rec.pilot.measure) },
      openQuestions: scrubList(rec.openQuestions),
      risks: scrubList(rec.risks),
    })),
    replacements,
  };
}

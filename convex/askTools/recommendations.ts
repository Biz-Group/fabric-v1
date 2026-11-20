import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { readProcessFlow } from "../processFlows";
import { compareRecommendations } from "../lib/recommendationScoring";
import { askToolQuery } from "./executor";
import { MAX_FLOW_PROCESSES } from "./evidence";
import { entityPath, loadHierarchy, scopeInput, scopeOf, scopedProcesses, type OrgHierarchy } from "./scope";
import {
  MAX_BUDGET_TOKENS,
  MAX_LIST_ITEMS,
  NOT_FOUND,
  ResultBuilder,
  blockTokens,
  clipText,
  isoDate,
  searchResult,
  shortTitle,
  sources,
  type SearchResultBlock,
} from "./results";

/**
 * The recommendations Fabric generates for each process from its flow, as the
 * Recommendations tab shows them (`recommendations.getProcessRecommendations`):
 * the stored v2 rows with their scores and decision status. Legacy rows, who
 * decided what and per-member ratings stay out.
 */

type Recommendation = Doc<"processRecommendations">;
type Intervention = NonNullable<Recommendation["content"]>["intervention"];
type DecisionStatus = Recommendation["decisionStatus"];

/** Mirrors `src/features/recommendations/recommendation-meta.ts`. */
const INTERVENTION_LABEL: Record<Intervention, string> = {
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
const TECHNICAL = new Set<Intervention>(["workflow", "integration", "ai_assist", "agent"]);
const DECISION_LABEL: Record<DecisionStatus, string> = {
  new: "New",
  shortlisted: "Shortlisted",
  dismissed: "Dismissed",
  in_progress: "In progress",
  done: "Done",
};
const DISMISS_LABEL: Record<NonNullable<Recommendation["dismissReason"]>, string> = {
  not_a_real_problem: "not a real problem",
  already_fixed: "already fixed",
  too_costly: "too costly",
  not_a_priority: "not a priority",
  wrong_recommendation: "wrong recommendation",
};
const CAUSE_BASIS: Record<NonNullable<Recommendation["content"]>["causeBasis"], string> = {
  reported: "reported by a contributor",
  inferred: "Fabric's reading of the evidence",
  unknown: "not known yet",
};

/** Matches `MAX_ROWS_PER_PROCESS` in recommendations.ts. */
const MAX_ROWS_PER_PROCESS = 200;
/** One process's recommendation in full, before any shrinking to fit. */
const ENTRY_FULL_TOKENS = 700;
/** Below this share an entry is one line, without its prose. */
const MIN_PROSE_TOKENS = 200;
/** Org-wide reads stop here; the result says so. */
const MAX_SCOPE_ROWS = 3000;

async function rowsFor(
  ctx: QueryCtx,
  orgId: string,
  processId: Id<"processes">,
  lifecycle: "active" | "absent_from_latest",
): Promise<Recommendation[]> {
  const rows = await ctx.db
    .query("processRecommendations")
    .withIndex("by_clerkOrgId_and_processId_and_source_and_lifecycle", (q) =>
      q.eq("clerkOrgId", orgId).eq("processId", processId).eq("source", "v2").eq("lifecycle", lifecycle),
    )
    .take(MAX_ROWS_PER_PROCESS);
  return rows.filter((row) => row.content !== undefined);
}

/** Decided-against rows sort last; otherwise the tab's order (value, effort, evidence). */
function rank(a: Recommendation, b: Recommendation): number {
  const ad = a.decisionStatus === "dismissed" ? 1 : 0;
  const bd = b.decisionStatus === "dismissed" ? 1 : 0;
  return ad - bd || compareRecommendations(a, b);
}

function kindText(content: NonNullable<Recommendation["content"]>): string {
  const kind = `${INTERVENTION_LABEL[content.intervention]} (${TECHNICAL.has(content.intervention) ? "technical" : "non-technical"})`;
  const supporting = content.supportingInterventions.filter((i) => i !== content.intervention);
  return supporting.length ? `${kind}, with ${supporting.map((i) => INTERVENTION_LABEL[i].toLowerCase()).join(", ")}` : kind;
}

function statusText(row: Recommendation): string {
  return `${DECISION_LABEL[row.decisionStatus]}${row.dismissReason ? ` (${DISMISS_LABEL[row.dismissReason]})` : ""}`;
}

function scoreText(row: Recommendation): string {
  if (!row.scores) return "";
  const { value, effort, evidence } = row.scores;
  const level = (name: string, score: typeof value) =>
    `${name} ${score.level}${score.reasons.length ? ` (${score.reasons.join("; ")})` : ""}`;
  return `${level("Value", value)}. ${level("Effort", effort)}. Evidence: ${evidence.interviews} contribution${evidence.interviews === 1 ? "" : "s"}, ${evidence.contributors} contributor${evidence.contributors === 1 ? "" : "s"}.`;
}

function countBy<T extends string>(rows: Recommendation[], key: (row: Recommendation) => T): string {
  const counts = new Map<T, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${count} ${name}`)
    .join(", ");
}

function totalsText(rows: Recommendation[]): string {
  if (rows.length === 0) return "";
  const technical = rows.filter((row) => TECHNICAL.has(row.content!.intervention)).length;
  return [
    `${rows.length} recommendation${rows.length === 1 ? "" : "s"}: ${rows.length - technical} non-technical, ${technical} technical.`,
    `By kind of change: ${countBy(rows, (row) => INTERVENTION_LABEL[row.content!.intervention])}.`,
    `By status: ${countBy(rows, (row) => DECISION_LABEL[row.decisionStatus])}.`,
  ].join(" ");
}

export const getRecommendationsInput = scopeInput;

/**
 * Fabric's recommendations: for one process in full (problem, cause, proposed
 * change, pilot, scores, status, open questions, risks); for a department,
 * function or the whole organization, totals plus the top-ranked ones.
 */
export const getRecommendations = askToolQuery({
  input: getRecommendationsInput,
  handler: async (ctx, viewer, input) => {
    const hierarchy = await loadHierarchy(ctx, viewer.orgId);
    const { kind, id } = scopeOf(input);
    const scope = await scopedProcesses(ctx, viewer.orgId, hierarchy, kind, id);
    if (!scope) return NOT_FOUND;
    return scope.kind === "process"
      ? await recommendationsForProcess(ctx, viewer.orgId, hierarchy, scope.processes[0])
      : await forScope(ctx, viewer.orgId, hierarchy, scope);
  },
});

/** One process's recommendations in full (shared with rankSignals). */
export async function recommendationsForProcess(
  ctx: QueryCtx,
  orgId: string,
  hierarchy: OrgHierarchy,
  process: Doc<"processes">,
) {
  const pid = process._id;
  const active = (await rowsFor(ctx, orgId, pid, "active")).sort(rank);
  const earlier = (await rowsFor(ctx, orgId, pid, "absent_from_latest")).sort(rank);
  const runs = await ctx.db
    .query("recommendationRuns")
    .withIndex("by_clerkOrgId_and_processId_and_createdAt", (q) => q.eq("clerkOrgId", orgId).eq("processId", pid))
    .order("desc")
    .take(20);
  const latest = runs[0] ?? null;
  const lastReady = runs.find((run) => run.status === "ready") ?? null;
  const flow = await readProcessFlow(ctx, orgId, pid);
  const labelById = new Map((flow?.nodes ?? []).map((node) => [node.id, node.label]));
  const titleById = new Map([...active, ...earlier].map((row) => [row._id, row.title]));

  let newContributions = 0;
  if (lastReady) {
    const done = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_processId_and_status", (q) =>
        q.eq("clerkOrgId", orgId).eq("processId", pid).eq("status", "done"),
      )
      .take(500);
    newContributions = Math.max(0, done.length - lastReady.conversationCount);
  }

  const runState = !latest
    ? "Recommendations have not been generated for this process yet."
    : latest.status === "pending" || latest.status === "running"
      ? "Recommendations are being refreshed now."
      : latest.status === "failed"
        ? "The last refresh of recommendations failed; the ones shown are from the last successful run."
        : "";

  const builder = new ResultBuilder(MAX_BUDGET_TOKENS, 450);
  const entitySource = sources.entity("process", pid);
  const summary = [
    `Recommendations for ${process.name} (${entityPath(hierarchy, "process", process)}).`,
    active.length ? totalsText(active) : "There are no current recommendations.",
    lastReady ? `Last generated ${isoDate(lastReady.completedAt)} from ${lastReady.conversationCount} contribution${lastReady.conversationCount === 1 ? "" : "s"}.` : "",
    newContributions > 0 ? `${newContributions} newer contribution${newContributions === 1 ? " is" : "s are"} not reflected yet.` : "",
    earlier.length ? `${earlier.length} more from earlier runs are kept because someone made a decision about them.` : "",
    runState,
  ]
    .filter(Boolean)
    .join(" ");

  // Every recommendation must appear, since there is no next page: each one
  // gets an equal share of what is left, and its prose fields shrink to fit
  // (problem and proposed change keep the most).
  const entry = (row: Recommendation, fromEarlier: boolean, maxTokens: number) => {
    const content = row.content!;
    // About 170 tokens are fixed (title, kind, status, scores, steps); the
    // prose caps below add up to about 540 at full size.
    const scale = Math.max(0.2, Math.min(1, (maxTokens - 170) / 540));
    const clip = (value: string, tokens: number) => clipText(value, Math.round(tokens * scale));
    const steps = row.nodeIds.map((nodeId) => labelById.get(nodeId) ?? nodeId);
    const buildsOn = row.buildsOnId ? titleById.get(row.buildsOnId) : undefined;
    const text = [
      `${row.title}.`,
      fromEarlier ? "From an earlier run, kept because a decision was made about it." : "",
      `Kind of change: ${kindText(content)}. Status: ${statusText(row)}.`,
      scoreText(row),
      `Problem: ${clip(content.problem, 110)}`,
      `Cause (${CAUSE_BASIS[content.causeBasis]}): ${clip(content.cause, 70)}`,
      `Proposed change: ${clip(content.proposedChange, 130)}`,
      content.whyNotSimpler ? `Why a simpler change is not enough: ${clip(content.whyNotSimpler, 70)}` : "",
      buildsOn ? `Builds on: ${buildsOn}.` : "",
      `Pilot: ${clip(`${content.pilot.what} Measure: ${content.pilot.measure}`, 70)}`,
      steps.length ? `Steps: ${steps.join(", ")}.` : "",
      content.openQuestions.length ? `Open questions: ${clip(content.openQuestions.join("; "), 45)}.` : "",
      content.risks.length ? `Risks: ${clip(content.risks.join("; "), 45)}.` : "",
      `Frequency of the work: ${content.frequency.replace("_", " ")}.`,
    ]
      .filter(Boolean)
      .join(" ");
    return searchResult(sources.recommendation(pid, row._id), shortTitle(`${process.name}: ${row.title}`), clipText(text, maxTokens));
  };

  // With many recommendations, a share too small for prose gets a one-line
  // entry instead: what it is, its status and scores.
  const compact = (row: Recommendation, fromEarlier: boolean) =>
    searchResult(
      sources.recommendation(pid, row._id),
      shortTitle(`${process.name}: ${row.title}`),
      [
        `${row.title}.`,
        fromEarlier ? "From an earlier run." : "",
        `${INTERVENTION_LABEL[row.content!.intervention]}. Status: ${statusText(row)}.`,
        row.scores ? `Value ${row.scores.value.level}, effort ${row.scores.effort.level}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );

  const queue = [...active.map((row) => [row, false] as const), ...earlier.map((row) => [row, true] as const)];
  for (const [index, [row, fromEarlier]] of queue.entries()) {
    // Less the block's source and title, about 45 tokens.
    const share = Math.floor(builder.remaining / (queue.length - index)) - 55;
    const block = share >= MIN_PROSE_TOKENS ? entry(row, fromEarlier, Math.min(ENTRY_FULL_TOKENS, share)) : compact(row, fromEarlier);
    if (blockTokens(block) > builder.remaining) {
      builder.markTruncated();
      continue;
    }
    builder.add(block);
  }
  if (builder.count < queue.length) builder.markTruncated();

  return builder.finish(
    {
      process: process.name,
      recommendations: active.length,
      earlierWithDecisions: earlier.length,
      runStatus: latest?.status ?? "none",
      note: RECOMMENDATIONS_NOTE,
    },
    null,
    {
      summary: { source: entitySource, title: `${process.name} — recommendations`, text: summary },
    },
  );
}

export type ScopeRecommendations = {
  /** Every current recommendation read. */
  rows: Recommendation[];
  /** Those not dismissed, best first. */
  open: Recommendation[];
  processById: Map<Id<"processes">, Doc<"processes">>;
  withRecommendations: number;
  processesRead: number;
  capped: boolean;
};

/** The current recommendations of every process in scope, ranked (shared with rankSignals). */
export async function loadScopeRecommendations(
  ctx: QueryCtx,
  orgId: string,
  inScope: Doc<"processes">[],
): Promise<ScopeRecommendations> {
  const processes = inScope.slice(0, MAX_FLOW_PROCESSES);
  let capped = inScope.length > processes.length;
  const rows: Recommendation[] = [];
  for (const process of processes) {
    if (rows.length >= MAX_SCOPE_ROWS) {
      capped = true;
      break;
    }
    rows.push(...(await rowsFor(ctx, orgId, process._id, "active")));
  }
  return {
    rows,
    open: rows.filter((row) => row.decisionStatus !== "dismissed").sort(rank),
    processById: new Map(processes.map((process) => [process._id, process])),
    withRecommendations: new Set(rows.map((row) => row.processId)).size,
    processesRead: processes.length,
    capped,
  };
}

/** One recommendation in a ranked list: what it is, where, its scores and the change, briefly. */
export function recommendationListBlock(
  hierarchy: OrgHierarchy,
  scope: ScopeRecommendations,
  row: Recommendation,
  rankLabel: string,
): SearchResultBlock {
  const process = scope.processById.get(row.processId)!;
  const content = row.content!;
  const text = [
    `${row.title} — ${entityPath(hierarchy, "process", process)}.`,
    `Kind of change: ${kindText(content)}. Status: ${statusText(row)}.`,
    row.scores ? `Value ${row.scores.value.level}, effort ${row.scores.effort.level}, from ${row.scores.evidence.interviews} contribution${row.scores.evidence.interviews === 1 ? "" : "s"}.` : "",
    `Problem: ${clipText(content.problem, 45)}`,
    `Proposed change: ${clipText(content.proposedChange, 70)}`,
    `(${rankLabel})`,
  ]
    .filter(Boolean)
    .join(" ");
  return searchResult(sources.recommendation(row.processId, row._id), shortTitle(`${process.name}: ${row.title}`), text);
}

/** The citable totals line for a scope's recommendations. */
export function scopeRecommendationsText(scope: ScopeRecommendations, scopeName: string, processesInScope: number): string {
  return [
    `Recommendations across ${scopeName}: ${scope.withRecommendations} of ${processesInScope} processes have recommendations.`,
    scope.rows.length ? totalsText(scope.rows) : "There are no current recommendations in scope.",
    scope.capped ? `Only the first ${scope.processesRead} processes were read.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export const RECOMMENDATIONS_NOTE =
  "These are Fabric's recommendations, generated from each process flow. Present them as Fabric's, with their status; do not add vendor or product suggestions of your own.";

async function forScope(
  ctx: QueryCtx,
  orgId: string,
  hierarchy: OrgHierarchy,
  scope: NonNullable<Awaited<ReturnType<typeof scopedProcesses>>>,
) {
  const recs = await loadScopeRecommendations(ctx, orgId, scope.processes);
  const builder = new ResultBuilder(MAX_BUDGET_TOKENS, 450);
  for (const [index, row] of recs.open.slice(0, MAX_LIST_ITEMS).entries()) {
    const block = recommendationListBlock(hierarchy, recs, row, `recommendation #${index + 1}, ranked by value, then lower effort, then evidence`);
    if (blockTokens(block) > builder.remaining) {
      builder.markTruncated();
      continue;
    }
    builder.add(block);
  }
  if (recs.open.length > MAX_LIST_ITEMS) builder.markTruncated();

  const scopeName = scope.kind === "org" ? "the organisation" : `this ${scope.kind}`;
  const summary = [
    scopeRecommendationsText(recs, scopeName, scope.processes.length),
    recs.open.length > 0
      ? `The ${Math.min(recs.open.length, MAX_LIST_ITEMS)} highest-ranked that are not dismissed are listed (ranked by value, then lower effort, then evidence).`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return builder.finish(
    {
      scope: scope.source,
      processesInScope: scope.processes.length,
      processesWithRecommendations: recs.withRecommendations,
      recommendations: recs.rows.length,
      ...(recs.capped ? { readCapped: true } : {}),
      detail: "Call again with a process id for a recommendation's cause, pilot, open questions and risks.",
      note: RECOMMENDATIONS_NOTE,
    },
    null,
    {
      summary: { source: scope.source, title: "Recommendations: totals in scope", text: summary },
    },
  );
}

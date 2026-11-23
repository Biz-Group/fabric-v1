import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { contributorKeysFor } from "./lib/contributorIdentity";
import {
  evidenceConfidence,
  summarizeAutomationOpportunity,
  type FlowNodeDetail,
} from "./lib/flowStages";
import { computeRecommendationScores } from "./lib/recommendationScoring";
import {
  getFlow,
  loadRecommendationInput,
  storedRecommendations,
} from "./recommendations";
import {
  reapplyProcessEvidenceRules,
  renderSummaryV2AsLegacyMarkdown,
  type ContributorKeysByConversationId,
} from "./summaryV2";

/**
 * Task 1.9 (docs/consultative-approach-task-list.md): brings stored data in
 * line with the Phase 1 evidence rules, without a single model call.
 *
 *   1. Process overviews: evidence level and contributor count per finding,
 *      and one-person consensus findings moved to Notable.
 *   2. Flow steps: confidence from the people behind each step.
 *   3. Recommendations: scores recomputed (their text untouched), and
 *      the automation opportunities dual-written on the flow kept in step.
 *
 * Nothing here marks anything stale or schedules anything: overview
 * provenance and revisions, flow `stale`, and recommendation runs are left
 * alone, so no refresh (and no model spend) follows. The test asserts it.
 *
 * Dry run first, always. It writes nothing and lists every change:
 *
 *   npx convex run evidenceBackfill:runEvidenceBackfill '{"dryRun":true}'
 *   npx convex run evidenceBackfill:runEvidenceBackfill '{"dryRun":false}'
 *
 * Add "clerkOrgId" to limit either to one workspace. Idempotent: a second
 * write run reports no changes.
 */

const MAX_FLOW_CONVERSATIONS = 50;
const MAX_DETAIL_ROWS = 400;
const PROCESS_PAGE = 25;

export type EvidenceBackfillReport = {
  processId: Id<"processes">;
  processName: string;
  clerkOrgId: string;
  overview: string[];
  steps: string[];
  recommendations: string[];
  skipped: string[];
  totals: BackfillTotals;
};

/**
 * Counts to read before a write: a rule that downgrades far more than
 * expected (for example every step whose sources carry no `Conv. N`) shows up
 * here before any detail line is read.
 */
export type BackfillTotals = {
  findingLevelChanges: Record<string, number>;
  findingsMovedToNotable: number;
  stepConfidenceChanges: Record<string, number>;
  valueChanges: Record<string, number>;
  recommendationsWithNoResolvableEvidence: number;
  flowOpportunitiesChanged: number;
  processesSkippedForStaleFlow: number;
};

function emptyTotals(): BackfillTotals {
  return {
    findingLevelChanges: {},
    findingsMovedToNotable: 0,
    stepConfidenceChanges: {},
    valueChanges: {},
    recommendationsWithNoResolvableEvidence: 0,
    flowOpportunitiesChanged: 0,
    processesSkippedForStaleFlow: 0,
  };
}

function bump(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function addTotals(into: BackfillTotals, from: BackfillTotals): void {
  for (const key of ["findingLevelChanges", "stepConfidenceChanges", "valueChanges"] as const) {
    for (const [transition, count] of Object.entries(from[key])) {
      into[key][transition] = (into[key][transition] ?? 0) + count;
    }
  }
  into.findingsMovedToNotable += from.findingsMovedToNotable;
  into.recommendationsWithNoResolvableEvidence += from.recommendationsWithNoResolvableEvidence;
  into.flowOpportunitiesChanged += from.flowOpportunitiesChanged;
  into.processesSkippedForStaleFlow += from.processesSkippedForStaleFlow;
}

/** Keys sorted at every level: stored documents need not keep key order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

// ---------------------------------------------------------------------------
// 1. Process overview
// ---------------------------------------------------------------------------

async function backfillOverview(
  ctx: MutationCtx,
  process: Doc<"processes">,
  dryRun: boolean,
  report: EvidenceBackfillReport,
): Promise<void> {
  const artifact = process.summaryV2;
  if (!artifact || !("scope" in artifact)) return;

  const sections = [
    artifact.scope,
    artifact.consensus,
    artifact.variations,
    artifact.gaps,
    artifact.notable,
  ];
  const rows = new Map<string, Doc<"conversations">>();
  for (const finding of sections.flat()) {
    for (const source of finding.sources) {
      if (source.kind !== "conversation" || rows.has(source.conversationId)) continue;
      const conversation = await ctx.db.get(source.conversationId);
      if (!conversation || conversation.clerkOrgId !== process.clerkOrgId) continue;
      rows.set(source.conversationId, conversation);
    }
  }
  const ordered = [...rows.values()];
  const keyLists = contributorKeysFor(ordered);
  const keys: Record<string, string[]> = Object.fromEntries(
    ordered.map((row, index) => [row._id, keyLists[index]]),
  );

  const next = reapplyProcessEvidenceRules(
    artifact,
    keys as ContributorKeysByConversationId,
  );
  if (sameJson(next, artifact)) return;

  const before = new Map(
    sections.flat().map((finding) => [finding.id, finding]),
  );
  const nextSections = {
    scope: next.scope,
    consensus: next.consensus,
    variations: next.variations,
    gaps: next.gaps,
    notable: next.notable,
  };
  for (const [section, findings] of Object.entries(nextSections)) {
    for (const finding of findings) {
      const old = before.get(finding.id);
      if (!old) {
        report.totals.findingsMovedToNotable += 1;
        report.overview.push(`moved to ${section}: "${finding.title}" (${finding.evidenceLevel}, ${finding.contributorCount ?? "?"} contributor(s))`);
      } else if (old.evidenceLevel !== finding.evidenceLevel) {
        bump(report.totals.findingLevelChanges, `${old.evidenceLevel} -> ${finding.evidenceLevel}`);
        report.overview.push(`${section}: "${finding.title}" ${old.evidenceLevel} -> ${finding.evidenceLevel} (${finding.contributorCount} contributor(s), ${finding.supportCount} contribution(s))`);
      }
    }
  }
  if (report.overview.length === 0) {
    report.overview.push("contributor counts recorded; no level changed");
  }

  if (!dryRun) {
    await ctx.db.patch(process._id, {
      summaryV2: next,
      rollingSummary: renderSummaryV2AsLegacyMarkdown(next),
    });
  }
}

// ---------------------------------------------------------------------------
// 2 and 3. Flow steps and recommendations
// ---------------------------------------------------------------------------

/** Contributions in the flow's evidence order, if the flow's `Conv. N` can be trusted. */
async function trustedKeysInOrder(
  ctx: MutationCtx,
  flow: Doc<"processFlows">,
): Promise<string[][] | null> {
  if (flow.status !== "ready" || flow.stale) return null;
  const done = await ctx.db
    .query("conversations")
    .withIndex("by_clerkOrgId_and_processId_and_status", (q) =>
      q
        .eq("clerkOrgId", flow.clerkOrgId)
        .eq("processId", flow.processId)
        .eq("status", "done"),
    )
    .order("asc")
    .take(MAX_FLOW_CONVERSATIONS + 1);
  // A contribution added, moved or deleted since generation shifts positions.
  if (done.length !== flow.conversationCount || done.length > MAX_FLOW_CONVERSATIONS) {
    return null;
  }
  return contributorKeysFor(done);
}

async function backfillSteps(
  ctx: MutationCtx,
  flow: Doc<"processFlows">,
  keysInOrder: string[][],
  dryRun: boolean,
  report: EvidenceBackfillReport,
): Promise<void> {
  const conversations = keysInOrder.map((keys) => ({ contributorKeys: keys }));
  const recompute = (
    detail: FlowNodeDetail,
    label: string,
    category: string | undefined,
  ): FlowNodeDetail | null => {
    const confidence = evidenceConfidence(
      detail.confidence,
      detail.sources,
      conversations,
      category,
    );
    if (confidence === detail.confidence) return null;
    bump(report.totals.stepConfidenceChanges, `${detail.confidence} -> ${confidence}`);
    // A drop to low means no source resolved; show the sources so the
    // reviewer can judge whether the rule or the stored sources are wrong.
    const why = confidence === "low" ? ` (sources: ${JSON.stringify(detail.sources)})` : "";
    report.steps.push(`"${label}": ${detail.confidence} -> ${confidence}${why}`);
    return { ...detail, confidence };
  };

  if (flow.generationVersion === undefined || flow.generationId === undefined) {
    // Legacy single-call flow: details are inline on the flow row.
    let changed = false;
    const nodes = flow.nodes.map((node) => {
      const { id, label, category, ...detail } = node;
      const next = recompute(detail as FlowNodeDetail, label, category);
      if (!next) return node;
      changed = true;
      return { id, label, category, ...next };
    });
    if (changed && !dryRun) await ctx.db.patch(flow._id, { nodes });
    return;
  }

  const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));
  const rows = await ctx.db
    .query("processFlowNodeDetails")
    .withIndex(
      "by_clerkOrgId_and_processFlowId_and_generationId_and_nodeId",
      (q) =>
        q
          .eq("clerkOrgId", flow.clerkOrgId)
          .eq("processFlowId", flow._id)
          .eq("generationId", flow.generationId!),
    )
    .take(MAX_DETAIL_ROWS);
  for (const row of rows) {
    // Placeholder rows (not yet described) carry no real confidence.
    if (row.status !== "ready" || !row.detail) continue;
    const node = nodesById.get(row.nodeId);
    const next = recompute(row.detail, node?.label ?? row.nodeId, node?.category);
    if (next && !dryRun) await ctx.db.patch(row._id, { detail: next });
  }
}

/**
 * Rescores stored recommendations. Their text is never touched: names stay
 * as they are today (Saish, 23 Nov 2026), because who does the work is what
 * makes a recommendation actionable.
 */
async function backfillRecommendations(
  ctx: MutationCtx,
  process: Doc<"processes">,
  flow: Doc<"processFlows">,
  keysInOrder: string[][] | null,
  dryRun: boolean,
  report: EvidenceBackfillReport,
): Promise<void> {
  const rows = [
    ...(await storedRecommendations(ctx, process.clerkOrgId, process._id, "v2", "active")),
    ...(await storedRecommendations(ctx, process.clerkOrgId, process._id, "v2", "absent_from_latest")),
  ].filter((row) => row.content && row.scores);
  if (rows.length === 0) return;

  const input = await loadRecommendationInput(ctx, {
    clerkOrgId: process.clerkOrgId,
    processId: process._id,
    flow,
    includeExisting: false,
  });
  // Contributors per row after rescoring, for the flow's opportunity copy.
  const contributorsById = new Map<string, { row: Doc<"processRecommendations">; contributors: number }>();
  for (const row of rows) {
    const scores = keysInOrder
      ? computeRecommendationScores({
          intervention: row.content!.intervention,
          frequency: row.content!.frequency,
          nodeIds: row.nodeIds,
          nodes: input.nodes,
          contributorKeysInOrder: keysInOrder,
        })
      : row.scores!;
    contributorsById.set(row._id, { row, contributors: scores.evidence.contributors });
    if (sameJson(scores, row.scores)) continue;
    if (scores.value.level !== row.scores!.value.level) {
      bump(report.totals.valueChanges, `${row.scores!.value.level} -> ${scores.value.level}`);
    }
    if (scores.evidence.interviews === 0) {
      report.totals.recommendationsWithNoResolvableEvidence += 1;
    }
    report.recommendations.push(
      `"${row.title}": value ${row.scores!.value.level} -> ${scores.value.level}; evidence ${row.scores!.evidence.interviews}/${row.scores!.evidence.contributors} -> ${scores.evidence.interviews}/${scores.evidence.contributors} (contributions/contributors)`,
    );
    if (!dryRun) await ctx.db.patch(row._id, { scores });
  }

  // The flow's automation opportunities are a copy of the technical
  // recommendations (recommendations.ts publish); keep the copy in step.
  const opportunities = flow.insights.automationOpportunityDetails ?? [];
  if (opportunities.length === 0 || flow.insights.automationOpportunitiesSource !== "ai") return;
  const key = (title: string, nodeIds: readonly string[]) => `${title}|${[...nodeIds].sort().join(",")}`;
  const byOriginal = new Map(
    [...contributorsById.values()]
      .filter((entry) => entry.row.lifecycle === "active")
      .map((entry) => [key(entry.row.title, entry.row.nodeIds), entry]),
  );
  let changed = false;
  const nextOpportunities = opportunities.map((opportunity) => {
    const entry = byOriginal.get(key(opportunity.title, opportunity.nodeIds));
    if (!entry) return opportunity;
    const contributors = entry.contributors;
    const confidence: typeof opportunity.confidence =
      contributors >= 2 ? "high" : contributors === 1 ? "medium" : "low";
    const next = { ...opportunity, confidence };
    if (!sameJson(next, opportunity)) {
      changed = true;
      report.totals.flowOpportunitiesChanged += 1;
      if (next.confidence !== opportunity.confidence) {
        report.recommendations.push(`flow opportunity "${opportunity.title}": confidence ${opportunity.confidence} -> ${next.confidence}`);
      }
    }
    return next;
  });
  if (changed && !dryRun) {
    await ctx.db.patch(flow._id, {
      insights: {
        ...flow.insights,
        automationOpportunityDetails: nextOpportunities,
        automationOpportunities: nextOpportunities.map(summarizeAutomationOpportunity),
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** One process, all three parts. With `dryRun`, reads only. */
export const backfillProcessEvidence = internalMutation({
  args: { processId: v.id("processes"), dryRun: v.boolean() },
  handler: async (ctx, args): Promise<EvidenceBackfillReport | null> => {
    const process = await ctx.db.get(args.processId);
    if (!process) return null;
    const report: EvidenceBackfillReport = {
      processId: process._id,
      processName: process.name,
      clerkOrgId: process.clerkOrgId,
      overview: [],
      steps: [],
      recommendations: [],
      skipped: [],
      totals: emptyTotals(),
    };

    await backfillOverview(ctx, process, args.dryRun, report);

    const flow = await getFlow(ctx, process.clerkOrgId, process._id);
    if (flow) {
      const keysInOrder = await trustedKeysInOrder(ctx, flow);
      if (keysInOrder) {
        await backfillSteps(ctx, flow, keysInOrder, args.dryRun, report);
      } else {
        report.totals.processesSkippedForStaleFlow += 1;
        report.skipped.push(
          "flow is stale or its contributions changed since it was generated: step confidence and recommendation scores keep their values until the flow is regenerated",
        );
      }
      await backfillRecommendations(ctx, process, flow, keysInOrder, args.dryRun, report);
    }
    return report;
  },
});

export const listProcessIdsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), clerkOrgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = args.clerkOrgId
      ? await ctx.db
          .query("processes")
          .withIndex("by_clerkOrgId_and_departmentId", (q) =>
            q.eq("clerkOrgId", args.clerkOrgId!),
          )
          .paginate({ numItems: PROCESS_PAGE, cursor: args.cursor })
      : await ctx.db.query("processes").paginate({ numItems: PROCESS_PAGE, cursor: args.cursor });
    return {
      ids: page.page.map((process) => process._id),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/**
 * Runs the backfill over every process (or one workspace's) and returns the
 * processes that changed, or would change on a dry run.
 */
export const runEvidenceBackfill = internalAction({
  args: { dryRun: v.boolean(), clerkOrgId: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    dryRun: boolean;
    processesChecked: number;
    totals: BackfillTotals;
    changed: EvidenceBackfillReport[];
  }> => {
    const changed: EvidenceBackfillReport[] = [];
    const totals = emptyTotals();
    let processesChecked = 0;
    let cursor: string | null = null;
    for (;;) {
      const page: { ids: Id<"processes">[]; isDone: boolean; continueCursor: string } =
        await ctx.runQuery(internal.evidenceBackfill.listProcessIdsPage, {
          cursor,
          clerkOrgId: args.clerkOrgId,
        });
      for (const processId of page.ids) {
        processesChecked += 1;
        const report: EvidenceBackfillReport | null = await ctx.runMutation(
          internal.evidenceBackfill.backfillProcessEvidence,
          { processId, dryRun: args.dryRun },
        );
        if (report) addTotals(totals, report.totals);
        if (
          report &&
          (report.overview.length ||
            report.steps.length ||
            report.recommendations.length ||
            report.skipped.length)
        ) {
          changed.push(report);
        }
      }
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return { dryRun: args.dryRun, processesChecked, totals, changed };
  },
});

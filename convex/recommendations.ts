import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  requireOrgContributor,
  requireOrgMember,
} from "./lib/orgAuth";
import {
  AIRequestError,
  isAIConfigured,
  isTokenLimitFinishReason,
  type AICompletion,
} from "./lib/aiProvider";
import { meteredCompletion } from "./lib/aiUsageMeter";
import { extractDataCollection } from "./lib/conversationAnalysis";
import {
  INSIGHTS_RATE_LIMIT_RETRY_DELAYS_MS,
  SOFT_MAX_NODES,
  summarizeAutomationOpportunity,
  type FlowNodeDetail,
} from "./lib/flowStages";
import {
  buildRecommendationsAIRequest,
  buildRecommendationsUserContent,
  describePayloadShape,
  normalizeRecommendations,
  readRecommendationsPayload,
  RECOMMENDATIONS_MAX_ASKS,
  RECOMMENDATIONS_PROMPT_VERSION,
  scrubContributorNames,
  toAutomationOpportunity,
  type ExistingRecommendationSummary,
  type RecommendationInputContext,
  type RecommendationInputNode,
} from "./lib/recommendationStage";
import {
  compareRecommendations,
  computeRecommendationScores,
  recommendationMatchKey,
} from "./lib/recommendationScoring";
import { planReconciliation } from "./lib/recommendationReconcile";
import {
  recommendationContentValidator,
  recommendationDecisionStatusValidator,
  recommendationDismissReasonValidator,
  recommendationScoresValidator,
} from "./schema";

/**
 * Process recommendations: technical and non-technical changes, each with a
 * stable identity, code-computed scores, and the decisions people make about
 * them. See docs/process-improvement-recommendations-plan.md (Phases 1–3).
 *
 * The stage runs after the flow is finalized and has its own run row, so the
 * flow is usable while recommendations are still being worked out, and a
 * failed pass is retried without regenerating the flow.
 */

/** A run this fresh is joined by a second request rather than duplicated. */
const RUN_JOIN_WINDOW_MS = 300_000;

/** No heartbeat for this long means the run is gone, not slow. */
const RUN_STUCK_AFTER_MS = 600_000;

const REAP_BATCH = 25;

/** Stored recommendations read per process. Far above what a run produces. */
const MAX_ROWS_PER_PROCESS = 200;

/** Same cap the flow pipeline uses; keep in step with processFlows.ts. */
const MAX_CONVERSATIONS_PER_FLOW = 50;

const DELETE_BATCH = 25;

const RUN_FAILED_MESSAGE =
  "The recommendation analysis did not finish. Retry it — the process flow is not affected.";

// ---------------------------------------------------------------------------
// Flow helpers
// ---------------------------------------------------------------------------

/** Legacy single-call flows carry no generation id. */
function flowGenerationKey(flow: Doc<"processFlows">): string {
  return flow.generationId ?? "legacy";
}

/** A flow worth recommending from: a graph, and descriptions that finished. */
function isFlowUsable(flow: Doc<"processFlows">): boolean {
  if (flow.status !== "ready" || flow.nodes.length === 0) return false;
  if (flow.generationVersion === undefined) return true;
  return flow.detailsStatus === "ready" || flow.detailsStatus === "partial";
}

/** Nodes with their real details: inline on legacy flows, child rows on staged ones. */
async function loadFlowNodes(
  ctx: { db: QueryCtx["db"] },
  flow: Doc<"processFlows">,
): Promise<RecommendationInputNode[]> {
  if (flow.generationVersion === undefined || flow.generationId === undefined) {
    return flow.nodes.map((node) => {
      const { id, label, category, ...detail } = node;
      return { id, label, category, detail: detail as FlowNodeDetail };
    });
  }
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
    .take(SOFT_MAX_NODES * 4);
  const detailByNodeId = new Map(
    rows
      .filter((row) => row.status === "ready" && row.detail)
      .map((row) => [row.nodeId, row.detail!]),
  );
  return flow.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    category: node.category,
    detail: detailByNodeId.get(node.id) ?? null,
  }));
}

async function getFlow(
  ctx: { db: QueryCtx["db"] },
  clerkOrgId: string,
  processId: Id<"processes">,
): Promise<Doc<"processFlows"> | null> {
  return await ctx.db
    .query("processFlows")
    .withIndex("by_clerkOrgId_and_processId", (q) =>
      q.eq("clerkOrgId", clerkOrgId).eq("processId", processId),
    )
    .first();
}

async function latestRun(
  ctx: { db: QueryCtx["db"] },
  clerkOrgId: string,
  processId: Id<"processes">,
): Promise<Doc<"recommendationRuns"> | null> {
  return await ctx.db
    .query("recommendationRuns")
    .withIndex("by_clerkOrgId_and_processId_and_createdAt", (q) =>
      q.eq("clerkOrgId", clerkOrgId).eq("processId", processId),
    )
    .order("desc")
    .first();
}

async function getRun(
  ctx: { db: QueryCtx["db"] },
  clerkOrgId: string,
  runId: string,
): Promise<Doc<"recommendationRuns"> | null> {
  return await ctx.db
    .query("recommendationRuns")
    .withIndex("by_clerkOrgId_and_runId", (q) =>
      q.eq("clerkOrgId", clerkOrgId).eq("runId", runId),
    )
    .unique();
}

async function storedRecommendations(
  ctx: { db: QueryCtx["db"] },
  clerkOrgId: string,
  processId: Id<"processes">,
  source: "v2" | "legacy",
  lifecycle: Doc<"processRecommendations">["lifecycle"],
): Promise<Doc<"processRecommendations">[]> {
  return await ctx.db
    .query("processRecommendations")
    .withIndex("by_clerkOrgId_and_processId_and_source_and_lifecycle", (q) =>
      q
        .eq("clerkOrgId", clerkOrgId)
        .eq("processId", processId)
        .eq("source", source)
        .eq("lifecycle", lifecycle),
    )
    .take(MAX_ROWS_PER_PROCESS);
}

// ---------------------------------------------------------------------------
// Starting a run
// ---------------------------------------------------------------------------

/**
 * Starts a recommendation run for the process's current flow, or joins one
 * already in flight for the same flow generation. Returns null when the flow
 * is not in a state worth analysing.
 *
 * Called from the flow's finalize step, the retry mutation, and the backfill.
 */
export async function startRecommendationRunForOrg(
  ctx: MutationCtx,
  args: {
    clerkOrgId: string;
    processId: Id<"processes">;
    trigger: Doc<"recommendationRuns">["trigger"];
  },
): Promise<{ runId: string; joined: boolean } | null> {
  const flow = await getFlow(ctx, args.clerkOrgId, args.processId);
  if (!flow || !isFlowUsable(flow)) return null;

  const now = Date.now();
  const generation = flowGenerationKey(flow);
  const previous = await latestRun(ctx, args.clerkOrgId, args.processId);
  if (
    previous &&
    (previous.status === "pending" || previous.status === "running") &&
    previous.flowGenerationId === generation &&
    now - previous.lastProgressAt < RUN_JOIN_WINDOW_MS
  ) {
    return { runId: previous.runId, joined: true };
  }

  const runId = crypto.randomUUID();
  await ctx.db.insert("recommendationRuns", {
    clerkOrgId: args.clerkOrgId,
    processId: args.processId,
    processFlowId: flow._id,
    flowGenerationId: generation,
    runId,
    status: "pending",
    trigger: args.trigger,
    attempts: 0,
    promptVersion: RECOMMENDATIONS_PROMPT_VERSION,
    conversationCount: flow.conversationCount,
    createdAt: now,
    lastProgressAt: now,
  });
  await ctx.scheduler.runAfter(
    0,
    internal.recommendations.generateRecommendationsInternal,
    { clerkOrgId: args.clerkOrgId, runId },
  );
  return { runId, joined: false };
}

/**
 * Re-runs recommendations from the current flow, without regenerating it. The
 * recovery path for a failed run, and the "refresh" for a stale one.
 */
/**
 * Ops path for re-running one process without a signed-in user, e.g. after a
 * prompt change:
 *   npx convex run recommendations:rerunRecommendations '{"clerkOrgId":"org_…","processId":"…"}'
 */
export const rerunRecommendations = internalMutation({
  args: { clerkOrgId: v.string(), processId: v.id("processes") },
  handler: async (ctx, args) => {
    return await startRecommendationRunForOrg(ctx, { ...args, trigger: "retry" });
  },
});

export const regenerateRecommendations = mutation({
  args: { processId: v.id("processes") },
  handler: async (ctx, args): Promise<{ message: string | null }> => {
    const caller = await requireOrgContributor(ctx);
    const process = await ctx.db.get(args.processId);
    if (!process || process.clerkOrgId !== caller.orgId) {
      throw new Error("Process not found");
    }
    const started = await startRecommendationRunForOrg(ctx, {
      clerkOrgId: caller.orgId,
      processId: args.processId,
      trigger: "retry",
    });
    if (started === null) {
      return {
        message:
          "The process flow has to finish generating before recommendations can run.",
      };
    }
    return {
      message: started.joined
        ? "Recommendations are already being worked out."
        : null,
    };
  },
});

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

/** A provider that answers in text instead of the forced tool, fenced or not. */
function parseTextPayload(text: string | null): unknown {
  if (!text) return null;
  const trimmed = text.trim();
  const body = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function contextValue(value: unknown): string | undefined {
  const raw = Array.isArray(value)
    ? value.map(String).join(", ")
    : typeof value === "string"
      ? value
      : "";
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return undefined;
  return trimmed.slice(0, 400);
}

/**
 * Everything the stage needs, or null when the run no longer owns the
 * process: a newer run started, or the flow was regenerated underneath it.
 */
export const getRecommendationRunInput = internalQuery({
  args: { clerkOrgId: v.string(), runId: v.string() },
  handler: async (ctx, args) => {
    const run = await getRun(ctx, args.clerkOrgId, args.runId);
    if (!run || (run.status !== "pending" && run.status !== "running")) {
      return null;
    }
    const newest = await latestRun(ctx, args.clerkOrgId, run.processId);
    if (newest?.runId !== run.runId) return null;

    const flow = await ctx.db.get(run.processFlowId);
    if (
      !flow ||
      flow.clerkOrgId !== args.clerkOrgId ||
      flowGenerationKey(flow) !== run.flowGenerationId
    ) {
      return null;
    }

    const nodes = await loadFlowNodes(ctx, flow);

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_processId_and_status", (q) =>
        q
          .eq("clerkOrgId", args.clerkOrgId)
          .eq("processId", run.processId)
          .eq("status", "done"),
      )
      .order("asc")
      .take(MAX_CONVERSATIONS_PER_FLOW);

    // Same numbering the flow's evidence uses, so "Conv. 2" here is the
    // "Conv. 2" in each step's sources.
    const contexts: RecommendationInputContext[] = conversations.map(
      (conversation, index) => {
        const dc = extractDataCollection(conversation.analysis) ?? {};
        return {
          ref: `Conv. ${index + 1}`,
          frequency: contextValue(dc.frequency),
          volume: contextValue(dc.volume),
          totalDuration: contextValue(dc.total_process_duration),
          approvals: contextValue(dc.compliance_or_approvals),
          edgeCases: contextValue(dc.edge_cases),
          dependencies: contextValue(dc.dependencies),
        };
      },
    );

    const stored = [
      ...(await storedRecommendations(
        ctx,
        args.clerkOrgId,
        run.processId,
        "v2",
        "active",
      )),
      ...(await storedRecommendations(
        ctx,
        args.clerkOrgId,
        run.processId,
        "v2",
        "absent_from_latest",
      )),
    ];
    const summarize = (
      row: Doc<"processRecommendations">,
    ): ExistingRecommendationSummary => ({
      id: row._id,
      title: row.title,
      problem: row.content?.problem ?? "",
      decisionStatus: row.decisionStatus,
      dismissReason: row.dismissReason,
    });

    return {
      processId: run.processId,
      flowGenerationId: run.flowGenerationId,
      nodes,
      edges: flow.edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        type: edge.type,
        label: edge.label,
      })),
      contexts,
      current: stored
        .filter(
          (row) =>
            row.lifecycle === "active" && row.decisionStatus !== "dismissed",
        )
        .map(summarize),
      dismissed: stored
        .filter((row) => row.decisionStatus === "dismissed")
        .map(summarize),
      contributorNames: [
        ...new Set(conversations.map((c) => c.contributorName)),
      ],
    };
  },
});

export const markRecommendationRunRunning = internalMutation({
  args: { clerkOrgId: v.string(), runId: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const run = await getRun(ctx, args.clerkOrgId, args.runId);
    if (!run || (run.status !== "pending" && run.status !== "running")) {
      return false;
    }
    await ctx.db.patch(run._id, {
      status: "running",
      attempts: run.attempts + 1,
      lastProgressAt: Date.now(),
    });
    return true;
  },
});

export const failRecommendationRun = internalMutation({
  args: {
    clerkOrgId: v.string(),
    runId: v.string(),
    errorMessage: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const run = await getRun(ctx, args.clerkOrgId, args.runId);
    if (!run || run.status === "ready" || run.status === "failed") return;
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "failed",
      errorMessage: args.errorMessage,
      lastProgressAt: now,
      completedAt: now,
    });
  },
});

const publishedRecommendationValidator = v.object({
  title: v.string(),
  nodeIds: v.array(v.string()),
  content: recommendationContentValidator,
  scores: recommendationScoresValidator,
  matchKey: v.string(),
  previousRecommendationId: v.optional(v.string()),
  /** For a follow-on: the position of its parent in this list. */
  buildsOnIndex: v.optional(v.number()),
});

/**
 * Lands a run's recommendations: reconciles them against what is stored so
 * decisions carry over, then dual-writes the technical subset onto the flow so
 * surfaces still reading `insights.automationOpportunityDetails` keep working.
 */
export const publishRecommendationRun = internalMutation({
  args: {
    clerkOrgId: v.string(),
    runId: v.string(),
    recommendations: v.array(publishedRecommendationValidator),
  },
  handler: async (ctx, args): Promise<{ published: boolean }> => {
    const run = await getRun(ctx, args.clerkOrgId, args.runId);
    if (!run || run.status !== "running") return { published: false };

    const now = Date.now();
    const newest = await latestRun(ctx, args.clerkOrgId, run.processId);
    const flow = await ctx.db.get(run.processFlowId);
    if (
      newest?.runId !== run.runId ||
      !flow ||
      flowGenerationKey(flow) !== run.flowGenerationId
    ) {
      // Something newer owns the process. Close this run out rather than leave
      // it looking stuck.
      await ctx.db.patch(run._id, {
        status: "failed",
        errorMessage: "Superseded by a newer run.",
        lastProgressAt: now,
        completedAt: now,
      });
      return { published: false };
    }

    const stored = [
      ...(await storedRecommendations(
        ctx,
        args.clerkOrgId,
        run.processId,
        "v2",
        "active",
      )),
      ...(await storedRecommendations(
        ctx,
        args.clerkOrgId,
        run.processId,
        "v2",
        "absent_from_latest",
      )),
    ];
    const plan = planReconciliation(
      stored.map((row) => ({
        id: row._id,
        matchKey: row.matchKey,
        lifecycle: row.lifecycle as "active" | "absent_from_latest",
        decisionStatus: row.decisionStatus,
      })),
      args.recommendations,
    );

    const idByIndex: Array<Id<"processRecommendations">> = [];
    for (const [index, rec] of args.recommendations.entries()) {
      const fields = {
        title: rec.title,
        nodeIds: rec.nodeIds,
        content: rec.content,
        scores: rec.scores,
        matchKey: rec.matchKey,
        lifecycle: "active" as const,
        flowGenerationId: run.flowGenerationId,
        latestRunId: run.runId,
        updatedAt: now,
      };
      const matchedId = plan.matches[index];
      if (matchedId !== null) {
        // Decision status is deliberately not touched: carrying it across
        // regenerations is the point of matching.
        await ctx.db.patch(matchedId as Id<"processRecommendations">, fields);
        idByIndex.push(matchedId as Id<"processRecommendations">);
      } else {
        const id = await ctx.db.insert("processRecommendations", {
          ...fields,
          clerkOrgId: args.clerkOrgId,
          processId: run.processId,
          source: "v2",
          decisionStatus: "new",
          firstRunId: run.runId,
          createdAt: now,
        });
        idByIndex.push(id);
      }
    }
    // Links second: a parent's id only exists once every row is written. A
    // row that is no longer a follow-on loses its link.
    for (const [index, rec] of args.recommendations.entries()) {
      await ctx.db.patch(idByIndex[index], {
        buildsOnId:
          rec.buildsOnIndex === undefined
            ? undefined
            : idByIndex[rec.buildsOnIndex],
      });
    }
    for (const row of plan.unmatched) {
      await ctx.db.patch(row.id as Id<"processRecommendations">, {
        lifecycle: row.lifecycle,
        updatedAt: now,
      });
    }

    const opportunities = args.recommendations
      .map(toAutomationOpportunity)
      .filter((opportunity) => opportunity !== null);
    await ctx.db.patch(flow._id, {
      insights: {
        ...flow.insights,
        // Analysed, even when empty: "nothing worth automating" is an answer,
        // and storing it as "derived" made the tab claim nothing was analysed.
        automationOpportunitiesSource: "ai",
        automationOpportunityDetails: opportunities,
        automationOpportunities: opportunities.map(
          summarizeAutomationOpportunity,
        ),
      },
    });

    await ctx.db.patch(run._id, {
      status: "ready",
      resultCount: args.recommendations.length,
      errorMessage: undefined,
      lastProgressAt: now,
      completedAt: now,
    });
    return { published: true };
  },
});

export const touchRecommendationRun = internalMutation({
  args: { clerkOrgId: v.string(), runId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const run = await getRun(ctx, args.clerkOrgId, args.runId);
    if (!run || (run.status !== "pending" && run.status !== "running")) return;
    await ctx.db.patch(run._id, { lastProgressAt: Date.now() });
  },
});

export const generateRecommendationsInternal = internalAction({
  args: {
    clerkOrgId: v.string(),
    runId: v.string(),
    /** How many rate-limit reschedules this run has already had. */
    rateLimitAttempt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const fail = async (errorMessage: string) => {
      await ctx.runMutation(internal.recommendations.failRecommendationRun, {
        clerkOrgId: args.clerkOrgId,
        runId: args.runId,
        errorMessage,
      });
    };

    const input = await ctx.runQuery(
      internal.recommendations.getRecommendationRunInput,
      { clerkOrgId: args.clerkOrgId, runId: args.runId },
    );
    // Superseded or already finished — the newer run owns the process.
    if (input === null) return;

    if (!isAIConfigured("synthesis")) {
      await fail("Recommendations are not configured (missing API key).");
      return;
    }
    if (!input.nodes.some((node) => node.detail !== null)) {
      await fail(
        "No steps in this process flow were described, so there is nothing to analyse yet.",
      );
      return;
    }

    const owns = await ctx.runMutation(
      internal.recommendations.markRecommendationRunRunning,
      { clerkOrgId: args.clerkOrgId, runId: args.runId },
    );
    if (!owns) return;

    const request = buildRecommendationsAIRequest(
      buildRecommendationsUserContent(input),
    );
    let completion: AICompletion;
    let payload: { recommendations: unknown[] } | null = null;
    try {
      // The tool is offered, not forced, so the model can reason first; an
      // answer in text instead is asked again rather than failed outright.
      for (let ask = 1; ; ask++) {
        completion = await meteredCompletion(
          ctx,
          {
            clerkOrgId: args.clerkOrgId,
            entityType: "process",
            entityId: input.processId,
            runId: args.runId,
          },
          request,
        );
        const raw = completion.toolInput ?? parseTextPayload(completion.text);
        payload = readRecommendationsPayload(raw);
        if (
          payload ||
          isTokenLimitFinishReason(completion.finishReason) ||
          ask >= RECOMMENDATIONS_MAX_ASKS
        ) {
          break;
        }
        console.warn("Recommendation stage returned no usable list; asking again", {
          finishReason: completion.finishReason,
          calledTool: completion.toolInput !== null,
          recommendationsWas: describePayloadShape(raw),
        });
      }
    } catch (error) {
      const attempt = args.rateLimitAttempt ?? 0;
      const delayMs = INSIGHTS_RATE_LIMIT_RETRY_DELAYS_MS[attempt];
      if (
        error instanceof AIRequestError &&
        error.status === 429 &&
        delayMs !== undefined
      ) {
        console.warn("Recommendation analysis was rate limited", {
          attempt: attempt + 1,
          delayMs,
        });
        await ctx.runMutation(internal.recommendations.touchRecommendationRun, {
          clerkOrgId: args.clerkOrgId,
          runId: args.runId,
        });
        await ctx.scheduler.runAfter(
          delayMs,
          internal.recommendations.generateRecommendationsInternal,
          { ...args, rateLimitAttempt: attempt + 1 },
        );
        return;
      }
      console.error("AI recommendation request failed", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      await fail(RUN_FAILED_MESSAGE);
      return;
    }

    if (isTokenLimitFinishReason(completion.finishReason)) {
      console.error("Recommendation analysis hit the token limit", {
        finishReason: completion.finishReason,
      });
      await fail(RUN_FAILED_MESSAGE);
      return;
    }

    // An unusable response is a failure, not an empty answer. Only a response
    // that actually carries a recommendations list can say "nothing to change".
    if (!payload) {
      console.error("Recommendation response had no recommendations list");
      await fail(RUN_FAILED_MESSAGE);
      return;
    }

    const normalized = normalizeRecommendations(
      payload,
      input.nodes.map((node) => node.id),
    );
    // What the model said about follow-ons, against what survived
    // normalizing: tells "it answered none" apart from "it answered, and the
    // answer was incomplete". Kinds and counts only, no content.
    const followOnKinds = payload.recommendations.map((raw) => {
      const value = ((raw ?? {}) as Record<string, unknown>).followOn;
      const followOn = (
        typeof value === "string" ? parseTextPayload(value) : value
      ) as Record<string, unknown> | undefined;
      if (!followOn) return "missing";
      const filled = ["title", "problem", "proposedChange"].filter(
        (field) => typeof followOn[field] === "string" && followOn[field] !== "",
      ).length;
      return `${String(followOn.kind)}${followOn.kind === "none" ? "" : `(${filled}/3 fields)`}`;
    });
    console.info("Recommendation follow-ons", {
      processId: input.processId,
      proposed: followOnKinds,
      kept: normalized.filter((rec) => rec.buildsOnIndex !== undefined).length,
    });
    const { recommendations, replacements } = scrubContributorNames(
      normalized,
      input.contributorNames,
    );
    if (replacements > 0) {
      console.warn("Contributor names removed from recommendation text", {
        processId: input.processId,
        replacements,
      });
    }

    await ctx.runMutation(internal.recommendations.publishRecommendationRun, {
      clerkOrgId: args.clerkOrgId,
      runId: args.runId,
      recommendations: recommendations.map((rec) => ({
        title: rec.title,
        nodeIds: rec.nodeIds,
        content: {
          problem: rec.problem,
          cause: rec.cause,
          causeBasis: rec.causeBasis,
          intervention: rec.intervention,
          supportingInterventions: rec.supportingInterventions,
          proposedChange: rec.proposedChange,
          whyNotSimpler: rec.whyNotSimpler,
          pilot: rec.pilot,
          openQuestions: rec.openQuestions,
          risks: rec.risks,
          frequency: rec.frequency,
        },
        scores: computeRecommendationScores({
          intervention: rec.intervention,
          frequency: rec.frequency,
          nodeIds: rec.nodeIds,
          nodes: input.nodes,
        }),
        matchKey: recommendationMatchKey(rec.nodeIds, rec.intervention),
        previousRecommendationId: rec.previousRecommendationId,
        buildsOnIndex: rec.buildsOnIndex,
      })),
    });
  },
});

export const reapStuckRecommendationRuns = internalMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    const cutoff = Date.now() - RUN_STUCK_AFTER_MS;
    for (const status of ["pending", "running"] as const) {
      const stuck = await ctx.db
        .query("recommendationRuns")
        .withIndex("by_status_and_lastProgressAt", (q) =>
          q.eq("status", status).lt("lastProgressAt", cutoff),
        )
        .take(REAP_BATCH);
      for (const run of stuck) {
        console.warn("Reaping a stuck recommendation run", {
          processId: run.processId,
          status,
        });
        const now = Date.now();
        await ctx.db.patch(run._id, {
          status: "failed",
          errorMessage: RUN_FAILED_MESSAGE,
          lastProgressAt: now,
          completedAt: now,
        });
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function toClientRecommendation(row: Doc<"processRecommendations">) {
  return {
    _id: row._id,
    source: row.source,
    lifecycle: row.lifecycle,
    title: row.title,
    nodeIds: row.nodeIds,
    content: row.content ?? null,
    scores: row.scores ?? null,
    legacy: row.legacy ?? null,
    buildsOnId: row.buildsOnId ?? null,
    decisionStatus: row.decisionStatus,
    dismissReason: row.dismissReason ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type ClientRecommendation = ReturnType<typeof toClientRecommendation>;

export const getProcessRecommendations = query({
  args: { processId: v.id("processes") },
  handler: async (ctx, args) => {
    const caller = await requireOrgMember(ctx);
    const process = await ctx.db.get(args.processId);
    if (!process || process.clerkOrgId !== caller.orgId) return null;

    const run = await latestRun(ctx, caller.orgId, args.processId);
    // The run that produced what is on screen, which is not the latest one
    // while a refresh is in flight or after one failed.
    const lastReady =
      run?.status === "ready"
        ? run
        : await ctx.db
            .query("recommendationRuns")
            .withIndex("by_clerkOrgId_and_processId_and_createdAt", (q) =>
              q.eq("clerkOrgId", caller.orgId).eq("processId", args.processId),
            )
            .order("desc")
            .take(20)
            .then((rows) => rows.find((row) => row.status === "ready") ?? null);

    const active = await storedRecommendations(
      ctx,
      caller.orgId,
      args.processId,
      "v2",
      "active",
    );
    const earlier = await storedRecommendations(
      ctx,
      caller.orgId,
      args.processId,
      "v2",
      "absent_from_latest",
    );
    const legacy = await storedRecommendations(
      ctx,
      caller.orgId,
      args.processId,
      "legacy",
      "active",
    );

    let newInterviewsSince = 0;
    if (lastReady) {
      const done = await ctx.db
        .query("conversations")
        .withIndex("by_clerkOrgId_and_processId_and_status", (q) =>
          q
            .eq("clerkOrgId", caller.orgId)
            .eq("processId", args.processId)
            .eq("status", "done"),
        )
        .take(MAX_CONVERSATIONS_PER_FLOW + 1);
      newInterviewsSince = Math.max(
        0,
        done.length - lastReady.conversationCount,
      );
    }

    return {
      run: run
        ? {
            status: run.status,
            trigger: run.trigger,
            errorMessage: run.errorMessage ?? null,
            createdAt: run.createdAt,
          }
        : null,
      lastReadyAt: lastReady?.completedAt ?? null,
      newInterviewsSince,
      canDecide: caller.role !== "viewer",
      recommendations: [...active]
        .sort(compareRecommendations)
        .map(toClientRecommendation),
      earlier: earlier.map(toClientRecommendation),
      legacy: legacy.map(toClientRecommendation),
    };
  },
});

/** Decision history and ratings for one recommendation, loaded when it is opened. */
export const getRecommendationActivity = query({
  args: { recommendationId: v.id("processRecommendations") },
  handler: async (ctx, args) => {
    const caller = await requireOrgMember(ctx);
    const row = await ctx.db.get(args.recommendationId);
    if (!row || row.clerkOrgId !== caller.orgId) return null;

    const history = await ctx.db
      .query("recommendationDecisions")
      .withIndex("by_clerkOrgId_and_recommendationId_and_createdAt", (q) =>
        q
          .eq("clerkOrgId", caller.orgId)
          .eq("recommendationId", args.recommendationId),
      )
      .order("desc")
      .take(50);

    const reviews = await ctx.db
      .query("recommendationReviews")
      .withIndex("by_clerkOrgId_and_recommendationId_and_reviewerUserId", (q) =>
        q
          .eq("clerkOrgId", caller.orgId)
          .eq("recommendationId", args.recommendationId),
      )
      .take(500);
    const mine = reviews.find((review) => review.reviewerUserId === caller.userId);

    return {
      history: history.map((entry) => ({
        _id: entry._id,
        from: entry.from,
        to: entry.to,
        reason: entry.reason ?? null,
        note: entry.note ?? null,
        actorName: entry.actorName,
        createdAt: entry.createdAt,
      })),
      ratings: {
        useful: reviews.filter((review) => review.useful).length,
        notUseful: reviews.filter((review) => !review.useful).length,
        mine: mine ? mine.useful : null,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Decisions and ratings
// ---------------------------------------------------------------------------

const MAX_NOTE_LENGTH = 500;

async function requireDecidableRecommendation(
  ctx: MutationCtx,
  orgId: string,
  recommendationId: Id<"processRecommendations">,
): Promise<Doc<"processRecommendations">> {
  const row = await ctx.db.get(recommendationId);
  // Not found rather than forbidden, so another org's ids reveal nothing.
  if (!row || row.clerkOrgId !== orgId) throw new Error("Recommendation not found");
  return row;
}

/**
 * Shortlist, dismiss (with a reason), start, finish or reopen. Contributors and
 * admins only; every change is recorded with who made it.
 */
export const setRecommendationDecision = mutation({
  args: {
    recommendationId: v.id("processRecommendations"),
    to: recommendationDecisionStatusValidator,
    reason: v.optional(recommendationDismissReasonValidator),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    const caller = await requireOrgContributor(ctx);
    const row = await requireDecidableRecommendation(
      ctx,
      caller.orgId,
      args.recommendationId,
    );
    if (row.source !== "v2") {
      throw new Error("Earlier automation suggestions are read-only.");
    }
    if (row.lifecycle === "superseded") {
      throw new Error("This recommendation has been replaced.");
    }
    if (args.to === "dismissed" && args.reason === undefined) {
      throw new Error("Choose a reason for dismissing this recommendation.");
    }
    if (args.to === row.decisionStatus) return null;

    const note = args.note?.trim().slice(0, MAX_NOTE_LENGTH) || undefined;
    const user = await ctx.db.get(caller.userId);
    const now = Date.now();

    await ctx.db.patch(row._id, {
      decisionStatus: args.to,
      dismissReason: args.to === "dismissed" ? args.reason : undefined,
      updatedAt: now,
    });
    await ctx.db.insert("recommendationDecisions", {
      clerkOrgId: caller.orgId,
      processId: row.processId,
      recommendationId: row._id,
      from: row.decisionStatus,
      to: args.to,
      reason: args.to === "dismissed" ? args.reason : undefined,
      note,
      actorUserId: caller.userId,
      actorName: user?.name || caller.name || "A member",
      createdAt: now,
    });
    return null;
  },
});

/** "Was this useful?" — any member, viewers included. One rating per person. */
export const rateRecommendation = mutation({
  args: {
    recommendationId: v.id("processRecommendations"),
    useful: v.boolean(),
  },
  handler: async (ctx, args): Promise<null> => {
    const caller = await requireOrgMember(ctx);
    const row = await requireDecidableRecommendation(
      ctx,
      caller.orgId,
      args.recommendationId,
    );
    const now = Date.now();
    const existing = await ctx.db
      .query("recommendationReviews")
      .withIndex("by_clerkOrgId_and_recommendationId_and_reviewerUserId", (q) =>
        q
          .eq("clerkOrgId", caller.orgId)
          .eq("recommendationId", row._id)
          .eq("reviewerUserId", caller.userId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { useful: args.useful, updatedAt: now });
    } else {
      await ctx.db.insert("recommendationReviews", {
        clerkOrgId: caller.orgId,
        recommendationId: row._id,
        reviewerUserId: caller.userId,
        useful: args.useful,
        createdAt: now,
        updatedAt: now,
      });
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Cascade delete, called when a process (or its flow) is deleted
// ---------------------------------------------------------------------------

export const deleteForProcess = internalMutation({
  args: { processId: v.id("processes"), clerkOrgId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    // Children of each recommendation first, so nothing is left pointing at a
    // row that no longer exists.
    const recommendations = await ctx.db
      .query("processRecommendations")
      .withIndex("by_clerkOrgId_and_processId_and_source_and_lifecycle", (q) =>
        q.eq("clerkOrgId", args.clerkOrgId).eq("processId", args.processId),
      )
      .take(DELETE_BATCH);
    for (const row of recommendations) {
      const decisions = await ctx.db
        .query("recommendationDecisions")
        .withIndex("by_clerkOrgId_and_recommendationId_and_createdAt", (q) =>
          q.eq("clerkOrgId", args.clerkOrgId).eq("recommendationId", row._id),
        )
        .take(500);
      for (const decision of decisions) await ctx.db.delete(decision._id);
      const reviews = await ctx.db
        .query("recommendationReviews")
        .withIndex(
          "by_clerkOrgId_and_recommendationId_and_reviewerUserId",
          (q) =>
            q.eq("clerkOrgId", args.clerkOrgId).eq("recommendationId", row._id),
        )
        .take(500);
      for (const review of reviews) await ctx.db.delete(review._id);
      await ctx.db.delete(row._id);
    }

    const runs = await ctx.db
      .query("recommendationRuns")
      .withIndex("by_clerkOrgId_and_processId_and_createdAt", (q) =>
        q.eq("clerkOrgId", args.clerkOrgId).eq("processId", args.processId),
      )
      .take(DELETE_BATCH * 4);
    for (const run of runs) await ctx.db.delete(run._id);

    if (
      recommendations.length === DELETE_BATCH ||
      runs.length === DELETE_BATCH * 4
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.recommendations.deleteForProcess,
        args,
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Quality snapshot: what the stage is producing, for tuning the prompt.
//   npx convex run recommendations:recommendationQualitySnapshot
// Bounded reads across every tenant, so it reports a sample on a large
// deployment rather than failing.
// ---------------------------------------------------------------------------

const SNAPSHOT_SAMPLE = 2_000;

export const recommendationQualitySnapshot = internalQuery({
  args: {},
  handler: async (ctx) => {
    const ready = await ctx.db
      .query("recommendationRuns")
      .withIndex("by_status_and_lastProgressAt", (q) => q.eq("status", "ready"))
      .order("desc")
      .take(SNAPSHOT_SAMPLE);
    const failed = await ctx.db
      .query("recommendationRuns")
      .withIndex("by_status_and_lastProgressAt", (q) => q.eq("status", "failed"))
      .order("desc")
      .take(SNAPSHOT_SAMPLE);
    const rows = await ctx.db.query("processRecommendations").take(SNAPSHOT_SAMPLE);

    const byIntervention: Record<string, number> = {};
    const byDecision: Record<string, number> = {};
    const dismissReasons: Record<string, number> = {};
    for (const row of rows) {
      if (row.source !== "v2" || row.lifecycle !== "active" || !row.content) continue;
      byIntervention[row.content.intervention] =
        (byIntervention[row.content.intervention] ?? 0) + 1;
      byDecision[row.decisionStatus] = (byDecision[row.decisionStatus] ?? 0) + 1;
      if (row.dismissReason) {
        dismissReasons[row.dismissReason] = (dismissReasons[row.dismissReason] ?? 0) + 1;
      }
    }

    return {
      runs: {
        ready: ready.length,
        validEmpty: ready.filter((run) => run.resultCount === 0).length,
        failed: failed.length,
        superseded: failed.filter((run) => run.errorMessage === "Superseded by a newer run.")
          .length,
      },
      activeByIntervention: byIntervention,
      activeByDecision: byDecision,
      dismissReasons,
      sampled: rows.length === SNAPSHOT_SAMPLE,
    };
  },
});

// ---------------------------------------------------------------------------
// Backfill: re-run recommendations for every existing flow, one at a time.
//
// Run by hand, dev first, then prod only on explicit go-ahead:
//   npx convex run recommendations:startRecommendationBackfill '{"delayMs":90000}'
//   npx convex run recommendations:getRecommendationBackfillStatus
//   npx convex run recommendations:pauseRecommendationBackfill
//   npx convex run recommendations:resumeRecommendationBackfill
//
// Paced with a fixed delay after every flow it schedules, so Convex and
// Foundry never see more than one backfill run at a time.
// ---------------------------------------------------------------------------

async function currentBackfill(ctx: { db: QueryCtx["db"] }) {
  return await ctx.db.query("recommendationBackfills").order("desc").first();
}

export const startRecommendationBackfill = internalMutation({
  args: { delayMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const existing = await currentBackfill(ctx);
    if (existing && existing.status !== "done") {
      return { backfillId: existing._id, started: false };
    }
    const now = Date.now();
    const backfillId = await ctx.db.insert("recommendationBackfills", {
      status: "running",
      cursor: null,
      delayMs: Math.max(10_000, args.delayMs ?? 90_000),
      scheduled: 0,
      skipped: 0,
      startedAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.recommendations.stepRecommendationBackfill,
      { backfillId },
    );
    return { backfillId, started: true };
  },
});

export const stepRecommendationBackfill = internalMutation({
  args: { backfillId: v.id("recommendationBackfills") },
  handler: async (ctx, args): Promise<void> => {
    const backfill = await ctx.db.get(args.backfillId);
    if (!backfill || backfill.status !== "running") return;

    const page = await ctx.db
      .query("processFlows")
      .paginate({ numItems: 1, cursor: backfill.cursor });
    const flow = page.page[0];

    let scheduledRun = false;
    if (flow) {
      const previous = await latestRun(ctx, flow.clerkOrgId, flow.processId);
      const alreadyCurrent =
        previous?.status === "ready" &&
        previous.promptVersion === RECOMMENDATIONS_PROMPT_VERSION &&
        previous.flowGenerationId === flowGenerationKey(flow);
      if (!alreadyCurrent) {
        const started = await startRecommendationRunForOrg(ctx, {
          clerkOrgId: flow.clerkOrgId,
          processId: flow.processId,
          trigger: "backfill",
        });
        scheduledRun = started !== null && !started.joined;
      }
    }

    const done = page.isDone;
    await ctx.db.patch(backfill._id, {
      cursor: page.continueCursor,
      scheduled: backfill.scheduled + (scheduledRun ? 1 : 0),
      skipped: backfill.skipped + (flow && !scheduledRun ? 1 : 0),
      status: done ? "done" : "running",
      updatedAt: Date.now(),
    });
    if (!done) {
      await ctx.scheduler.runAfter(
        scheduledRun ? backfill.delayMs : 0,
        internal.recommendations.stepRecommendationBackfill,
        args,
      );
    }
  },
});

export const pauseRecommendationBackfill = internalMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    const backfill = await currentBackfill(ctx);
    if (backfill?.status === "running") {
      await ctx.db.patch(backfill._id, {
        status: "paused",
        updatedAt: Date.now(),
      });
    }
  },
});

export const resumeRecommendationBackfill = internalMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    const backfill = await currentBackfill(ctx);
    if (backfill?.status !== "paused") return;
    await ctx.db.patch(backfill._id, {
      status: "running",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.recommendations.stepRecommendationBackfill,
      { backfillId: backfill._id },
    );
  },
});

export const getRecommendationBackfillStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const backfill = await currentBackfill(ctx);
    if (!backfill) return null;
    return {
      status: backfill.status,
      scheduled: backfill.scheduled,
      skipped: backfill.skipped,
      startedAt: backfill.startedAt,
      updatedAt: backfill.updatedAt,
    };
  },
});

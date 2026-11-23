import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  AIRequestError,
  isAIConfigured,
  isTokenLimitFinishReason,
} from "./lib/aiProvider";
import { INSIGHTS_RATE_LIMIT_RETRY_DELAYS_MS } from "./lib/flowStages";
import {
  buildRecommendationsAIRequest,
  buildRecommendationsUserContent,
  isTechnicalIntervention,
  normalizeRecommendations,
  RECOMMENDATION_PROMPT_VARIANTS,
  recommendationsPromptVersion,
  scrubContributorNames,
  type GeneratedRecommendation,
  type RecommendationPromptVariant,
} from "./lib/recommendationStage";
import {
  askForRecommendations,
  describeFollowOnProposals,
  getFlow,
  isFlowUsable,
  loadRecommendationInput,
} from "./recommendations";

/**
 * Recommendation previews: prompt variants run side by side on real processes,
 * stored apart from the published recommendations and never shown to the
 * organisation. They run inside the deployment that holds the data, so client
 * content never leaves it.
 *
 * Ops only, by hand:
 *   npx convex run recommendationPreviews:startRecommendationPreview \
 *     '{"processes":[{"clerkOrgId":"org_…","processId":"…"}],"variants":["v9","v10"],"runs":3}'
 *   npx convex run recommendationPreviews:getRecommendationPreviewReport '{"batchId":"…"}'
 *   npx convex run recommendationPreviews:deleteRecommendationPreviewBatch '{"batchId":"…"}'
 * A process's previews are also deleted with the process
 * (recommendations.deleteForProcess).
 *
 * Calls are spaced out (`spacingMs`) so a batch never competes with live runs
 * for the Foundry quota, and a 429 is rescheduled the way live runs are.
 */

const MAX_PROCESSES = 30;
const MAX_RUNS = 5;
const MIN_SPACING_MS = 10_000;
const DEFAULT_SPACING_MS = 30_000;
const REPORT_LIMIT = 1_000;
const DELETE_BATCH = 100;

const FAILED_MESSAGE = "The preview call did not finish.";

function isVariant(value: string): value is RecommendationPromptVariant {
  return (RECOMMENDATION_PROMPT_VARIANTS as readonly string[]).includes(value);
}

export const startRecommendationPreview = internalMutation({
  args: {
    processes: v.array(
      v.object({ clerkOrgId: v.string(), processId: v.id("processes") }),
    ),
    variants: v.array(v.string()),
    runs: v.optional(v.number()),
    spacingMs: v.optional(v.number()),
    /**
     * Show the model the stored recommendations, as a live run does. Off by
     * default so every variant starts fresh rather than anchored to what the
     * live prompt produced.
     */
    includeExisting: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const variants = [...new Set(args.variants)];
    const unknown = variants.filter((variant) => !isVariant(variant));
    if (variants.length === 0 || unknown.length > 0) {
      throw new Error(
        `Variants must be some of ${RECOMMENDATION_PROMPT_VARIANTS.join(", ")}`,
      );
    }
    if (args.processes.length === 0 || args.processes.length > MAX_PROCESSES) {
      throw new Error(`Between 1 and ${MAX_PROCESSES} processes`);
    }
    const runs = Math.min(MAX_RUNS, Math.max(1, Math.floor(args.runs ?? 3)));
    const spacingMs = Math.max(MIN_SPACING_MS, args.spacingMs ?? DEFAULT_SPACING_MS);
    const includeExisting = args.includeExisting ?? false;

    const usable: typeof args.processes = [];
    const skipped: string[] = [];
    for (const target of args.processes) {
      const flow = await getFlow(ctx, target.clerkOrgId, target.processId);
      if (flow && isFlowUsable(flow)) usable.push(target);
      else skipped.push(target.processId);
    }

    const batchId = crypto.randomUUID();
    const now = Date.now();
    let slot = 0;
    // Interleaved, with the variant order rotating, so neither variant always
    // runs first or always meets a busier quota.
    for (let runIndex = 0; runIndex < runs; runIndex++) {
      for (const [position, target] of usable.entries()) {
        for (let k = 0; k < variants.length; k++) {
          const variant = variants[(k + runIndex + position) % variants.length];
          const previewId = await ctx.db.insert("recommendationPreviews", {
            clerkOrgId: target.clerkOrgId,
            processId: target.processId,
            batchId,
            variant,
            promptVersion: recommendationsPromptVersion(
              variant as RecommendationPromptVariant,
            ),
            runIndex,
            includeExisting,
            status: "pending",
            rateLimitAttempts: 0,
            createdAt: now,
          });
          await ctx.scheduler.runAfter(
            slot * spacingMs,
            internal.recommendationPreviews.runRecommendationPreview,
            { previewId },
          );
          slot += 1;
        }
      }
    }
    return {
      batchId,
      scheduled: slot,
      skipped,
      lastStartsAt: now + Math.max(0, slot - 1) * spacingMs,
    };
  },
});

export const getRecommendationPreviewInput = internalQuery({
  args: { previewId: v.id("recommendationPreviews") },
  handler: async (ctx, args) => {
    const preview = await ctx.db.get(args.previewId);
    if (!preview || preview.status !== "pending") return null;
    const flow = await getFlow(ctx, preview.clerkOrgId, preview.processId);
    const input =
      flow && isFlowUsable(flow)
        ? await loadRecommendationInput(ctx, {
            clerkOrgId: preview.clerkOrgId,
            processId: preview.processId,
            flow,
            includeExisting: preview.includeExisting,
          })
        : null;
    return {
      clerkOrgId: preview.clerkOrgId,
      processId: preview.processId,
      batchId: preview.batchId,
      variant: preview.variant,
      rateLimitAttempts: preview.rateLimitAttempts,
      input,
    };
  },
});

export const recordRecommendationPreviewRateLimit = internalMutation({
  args: { previewId: v.id("recommendationPreviews") },
  handler: async (ctx, args): Promise<void> => {
    const preview = await ctx.db.get(args.previewId);
    if (!preview || preview.status !== "pending") return;
    await ctx.db.patch(preview._id, {
      rateLimitAttempts: preview.rateLimitAttempts + 1,
    });
  },
});

export const finishRecommendationPreview = internalMutation({
  args: {
    previewId: v.id("recommendationPreviews"),
    status: v.union(v.literal("ready"), v.literal("failed")),
    errorMessage: v.optional(v.string()),
    output: v.optional(v.string()),
    followOnProposals: v.optional(v.array(v.string())),
    followOnsCapped: v.optional(v.number()),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const { previewId, ...fields } = args;
    const preview = await ctx.db.get(previewId);
    if (!preview || preview.status !== "pending") return;
    await ctx.db.patch(preview._id, { ...fields, completedAt: Date.now() });
  },
});

export const runRecommendationPreview = internalAction({
  args: { previewId: v.id("recommendationPreviews") },
  handler: async (ctx, args): Promise<void> => {
    const fail = async (errorMessage: string) => {
      await ctx.runMutation(
        internal.recommendationPreviews.finishRecommendationPreview,
        { previewId: args.previewId, status: "failed", errorMessage },
      );
    };

    const preview = await ctx.runQuery(
      internal.recommendationPreviews.getRecommendationPreviewInput,
      { previewId: args.previewId },
    );
    if (preview === null) return;
    const { input } = preview;
    if (!input || !input.nodes.some((node) => node.detail !== null)) {
      await fail("The process flow is not ready to analyse.");
      return;
    }
    if (!isVariant(preview.variant)) {
      await fail(`Unknown prompt variant ${preview.variant}.`);
      return;
    }
    if (!isAIConfigured("synthesis")) {
      await fail("Recommendations are not configured (missing API key).");
      return;
    }

    const request = {
      ...buildRecommendationsAIRequest(
        buildRecommendationsUserContent(input),
        preview.variant,
      ),
      // Kept apart from the live stage in the usage ledger.
      operation: "process-recommendations-preview",
    };
    const started = Date.now();
    let result: Awaited<ReturnType<typeof askForRecommendations>>;
    try {
      result = await askForRecommendations(
        ctx,
        {
          clerkOrgId: preview.clerkOrgId,
          entityType: "process",
          entityId: preview.processId,
          runId: preview.batchId,
        },
        request,
      );
    } catch (error) {
      const delayMs = INSIGHTS_RATE_LIMIT_RETRY_DELAYS_MS[preview.rateLimitAttempts];
      if (
        error instanceof AIRequestError &&
        error.status === 429 &&
        delayMs !== undefined
      ) {
        await ctx.runMutation(
          internal.recommendationPreviews.recordRecommendationPreviewRateLimit,
          { previewId: args.previewId },
        );
        await ctx.scheduler.runAfter(
          delayMs,
          internal.recommendationPreviews.runRecommendationPreview,
          args,
        );
        return;
      }
      await fail(
        `${FAILED_MESSAGE} ${error instanceof Error ? error.name : "UnknownError"}`,
      );
      return;
    }

    const { completion, payload } = result;
    if (isTokenLimitFinishReason(completion.finishReason)) {
      await fail(`${FAILED_MESSAGE} Token limit.`);
      return;
    }
    if (!payload) {
      await fail(`${FAILED_MESSAGE} No recommendations list.`);
      return;
    }

    const nodeIds = input.nodes.map((node) => node.id);
    const normalized = normalizeRecommendations(payload, nodeIds);
    const uncapped = normalizeRecommendations(
      payload,
      nodeIds,
      Number.POSITIVE_INFINITY,
    );
    const followOnCount = (recs: GeneratedRecommendation[]) =>
      recs.filter((rec) => rec.buildsOnIndex !== undefined).length;
    const { recommendations } = scrubContributorNames(
      normalized,
      input.contributorNames,
    );

    await ctx.runMutation(
      internal.recommendationPreviews.finishRecommendationPreview,
      {
        previewId: args.previewId,
        status: "ready",
        output: JSON.stringify(recommendations),
        followOnProposals: describeFollowOnProposals(payload),
        followOnsCapped: followOnCount(uncapped) - followOnCount(normalized),
        durationMs: Date.now() - started,
      },
    );
  },
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

type VariantTotals = {
  runs: { ready: number; failed: number; pending: number };
  recommendations: number;
  followOns: number;
  technicalTopLevel: number;
  technicalTotal: number;
  topLevelByIntervention: Record<string, number>;
  followOnByIntervention: Record<string, number>;
  /** Ready runs that returned nothing at all. */
  emptyRuns: number;
  /** Ready runs in which nothing technical was recommended at all. */
  runsWithNoTechnical: number;
  runsHittingCap: number;
  followOnsCapped: number;
  /** Top-level recommendations that came with a rationale. */
  withRationale: number;
  standardiseShareOfTopLevel: number;
  meanDurationMs: number;
};

function emptyTotals(): VariantTotals {
  return {
    runs: { ready: 0, failed: 0, pending: 0 },
    recommendations: 0,
    followOns: 0,
    technicalTopLevel: 0,
    technicalTotal: 0,
    topLevelByIntervention: {},
    followOnByIntervention: {},
    emptyRuns: 0,
    runsWithNoTechnical: 0,
    runsHittingCap: 0,
    followOnsCapped: 0,
    withRationale: 0,
    standardiseShareOfTopLevel: 0,
    meanDurationMs: 0,
  };
}

function parseOutput(preview: Doc<"recommendationPreviews">): GeneratedRecommendation[] {
  if (!preview.output) return [];
  try {
    const parsed: unknown = JSON.parse(preview.output);
    return Array.isArray(parsed) ? (parsed as GeneratedRecommendation[]) : [];
  } catch {
    return [];
  }
}

/**
 * Totals per variant, and the technical count per process per variant across
 * runs (its spread is the run-to-run variation). `includeItems` adds every
 * run's titles and kinds, nested as the tab shows them, for reading side by
 * side.
 */
export const getRecommendationPreviewReport = internalQuery({
  args: { batchId: v.string(), includeItems: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const previews = await ctx.db
      .query("recommendationPreviews")
      .withIndex("by_batchId", (q) => q.eq("batchId", args.batchId))
      .take(REPORT_LIMIT);

    const totals: Record<string, VariantTotals> = {};
    const durations: Record<string, number[]> = {};
    const technicalByProcess: Record<string, Record<string, number[]>> = {};
    const items: Array<{
      processId: Id<"processes">;
      variant: string;
      runIndex: number;
      status: string;
      recommendations: Array<{
        title: string;
        intervention: string;
        whyThisChange?: string;
        followOns: Array<{ title: string; intervention: string }>;
      }>;
    }> = [];

    for (const preview of previews) {
      const t = (totals[preview.variant] ??= emptyTotals());
      t.runs[preview.status] += 1;
      if (preview.status !== "ready") continue;

      const recs = parseOutput(preview);
      const top = recs.filter((rec) => rec.buildsOnIndex === undefined);
      const follow = recs.filter((rec) => rec.buildsOnIndex !== undefined);
      const technical = recs.filter((rec) => isTechnicalIntervention(rec.intervention));
      t.recommendations += top.length;
      t.followOns += follow.length;
      t.technicalTopLevel += top.filter((rec) =>
        isTechnicalIntervention(rec.intervention),
      ).length;
      t.technicalTotal += technical.length;
      for (const rec of top) {
        t.topLevelByIntervention[rec.intervention] =
          (t.topLevelByIntervention[rec.intervention] ?? 0) + 1;
        if (rec.whyNotSimpler) t.withRationale += 1;
      }
      for (const rec of follow) {
        t.followOnByIntervention[rec.intervention] =
          (t.followOnByIntervention[rec.intervention] ?? 0) + 1;
      }
      if (recs.length === 0) t.emptyRuns += 1;
      if (technical.length === 0) t.runsWithNoTechnical += 1;
      if ((preview.followOnsCapped ?? 0) > 0) t.runsHittingCap += 1;
      t.followOnsCapped += preview.followOnsCapped ?? 0;
      if (preview.durationMs !== undefined) {
        (durations[preview.variant] ??= []).push(preview.durationMs);
      }

      const perProcess = (technicalByProcess[preview.processId] ??= {});
      (perProcess[preview.variant] ??= []).push(technical.length);

      if (args.includeItems) {
        items.push({
          processId: preview.processId,
          variant: preview.variant,
          runIndex: preview.runIndex,
          status: preview.status,
          recommendations: top.map((rec) => ({
            title: rec.title,
            intervention: rec.intervention,
            whyThisChange: rec.whyNotSimpler,
            followOns: follow
              .filter((child) => recs[child.buildsOnIndex!] === rec)
              .map((child) => ({
                title: child.title,
                intervention: child.intervention,
              })),
          })),
        });
      }
    }

    for (const [variant, t] of Object.entries(totals)) {
      const standardise = t.topLevelByIntervention.standardise ?? 0;
      t.standardiseShareOfTopLevel =
        t.recommendations > 0 ? Math.round((standardise / t.recommendations) * 100) / 100 : 0;
      const runDurations = durations[variant] ?? [];
      t.meanDurationMs =
        runDurations.length > 0
          ? Math.round(runDurations.reduce((a, b) => a + b, 0) / runDurations.length)
          : 0;
    }

    const processIds = Object.keys(technicalByProcess) as Id<"processes">[];
    const names = new Map<string, string>();
    for (const processId of processIds) {
      const process = await ctx.db.get(processId);
      if (process) names.set(processId, process.name);
    }

    return {
      batchId: args.batchId,
      previews: previews.length,
      truncated: previews.length === REPORT_LIMIT,
      totals,
      technicalPerRunByProcess: processIds.map((processId) => ({
        processId,
        name: names.get(processId) ?? null,
        byVariant: technicalByProcess[processId],
      })),
      items: args.includeItems
        ? items.map((item) => ({ ...item, name: names.get(item.processId) ?? null }))
        : undefined,
    };
  },
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export const deleteRecommendationPreviewBatch = internalMutation({
  args: { batchId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const previews = await ctx.db
      .query("recommendationPreviews")
      .withIndex("by_batchId", (q) => q.eq("batchId", args.batchId))
      .take(DELETE_BATCH);
    for (const preview of previews) await ctx.db.delete(preview._id);
    if (previews.length === DELETE_BATCH) {
      await ctx.scheduler.runAfter(
        0,
        internal.recommendationPreviews.deleteRecommendationPreviewBatch,
        args,
      );
    }
  },
});

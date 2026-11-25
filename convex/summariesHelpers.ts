import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

// ---------------------------------------------------------------------------
// Staleness propagation — internal mutations, always called from an org-scoped
// public entrypoint that already verified the parent belongs to the caller.
// ---------------------------------------------------------------------------

export const markFunctionSummaryStale = internalMutation({
  args: { functionId: v.id("functions") },
  handler: async (ctx, args) => {
    const fn = await ctx.db.get(args.functionId);
    if (!fn) return;
    await ctx.db.patch(args.functionId, {
      summaryStale: true,
      summarySourceRevision: (fn.summarySourceRevision ?? 0) + 1,
      ...(fn.summaryV2GenerationId
        ? { summaryRegenRequestedAgain: true }
        : {}),
    });
  },
});

export const markDepartmentSummaryStale = internalMutation({
  args: { departmentId: v.id("departments") },
  handler: async (ctx, args) => {
    const dept = await ctx.db.get(args.departmentId);
    if (!dept) return;
    await ctx.db.patch(args.departmentId, {
      summaryStale: true,
      summarySourceRevision: (dept.summarySourceRevision ?? 0) + 1,
      ...(dept.summaryV2GenerationId
        ? { summaryRegenRequestedAgain: true }
        : {}),
    });
    await ctx.runMutation(
      internal.summariesHelpers.markFunctionSummaryStale,
      { functionId: dept.functionId },
    );
  },
});

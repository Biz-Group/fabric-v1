import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * What a process's generated outputs need when its set of done contributions
 * changes without a recording finishing: a contribution was deleted, or moved
 * to another process.
 *
 * Neither path rebuilds anything by default. Bulk tidying (deleting test
 * recordings, moving misfiled interviews) is exactly when a rebuild per click
 * would burn the most tokens for the least value, so outputs are flagged stale
 * and keep showing their last good content behind a Rebuild control.
 */

/**
 * A done contribution left `processId`: it was deleted, or moved elsewhere.
 * Call after the row is gone from the process.
 *
 * - Other done contributions remain: the flow, the overview and the parent
 *   rollups go stale. The overview keeps citing the departed contribution
 *   until someone rebuilds; its source chip resolves against loaded
 *   contributions and fails safe.
 * - None remain: the overview and flow are cleared, since there is no evidence
 *   left to show, and the department is cleared too when no sibling process
 *   has a summary.
 */
export async function invalidateProcessAfterEvidenceLeft(
  ctx: MutationCtx,
  clerkOrgId: string,
  processId: Id<"processes">,
): Promise<void> {
  const remainingDone = await ctx.db
    .query("conversations")
    .withIndex("by_clerkOrgId_and_processId_and_status", (q) =>
      q
        .eq("clerkOrgId", clerkOrgId)
        .eq("processId", processId)
        .eq("status", "done"),
    )
    .take(1);

  if (remainingDone.length > 0) {
    await ctx.runMutation(internal.processFlows.markFlowStale, {
      processId,
      clerkOrgId,
      // Unconditional: the flow may cite the contribution that just left, and
      // a count check could miss it if another was added meanwhile.
      trigger: "evidenceChanged",
    });
    const process = await ctx.db.get(processId);
    if (process && process.clerkOrgId === clerkOrgId) {
      await ctx.runMutation(
        internal.summariesHelpers.markDepartmentSummaryStale,
        { departmentId: process.departmentId },
      );
    }
    await ctx.runMutation(internal.summaryEvidence.markProcessSummaryStale, {
      processId,
      clerkOrgId,
    });
    return;
  }

  const process = await ctx.db.get(processId);
  if (!process || process.clerkOrgId !== clerkOrgId) return;

  await ctx.db.patch(processId, {
    rollingSummary: undefined,
    summaryV2: undefined,
    summaryUpdatedAt: undefined,
    summaryEvidenceRevision: (process.summaryEvidenceRevision ?? 0) + 1,
    ...(process.summaryV2GenerationId
      ? { summaryRegenRequestedAgain: true }
      : {}),
  });
  await ctx.runMutation(internal.processFlows.deleteForProcess, {
    processId,
    clerkOrgId,
  });

  const department = await ctx.db.get(process.departmentId);
  if (!department || department.clerkOrgId !== clerkOrgId) return;

  const siblingProcesses = await ctx.db
    .query("processes")
    .withIndex("by_clerkOrgId_and_departmentId", (q) =>
      q.eq("clerkOrgId", clerkOrgId).eq("departmentId", process.departmentId),
    )
    .take(1000);
  const hasSummaries = siblingProcesses.some((p) => p.rollingSummary);
  if (hasSummaries) {
    await ctx.runMutation(internal.summariesHelpers.markDepartmentSummaryStale, {
      departmentId: process.departmentId,
    });
  } else {
    await ctx.db.patch(process.departmentId, {
      summary: undefined,
      summaryV2: undefined,
      summaryUpdatedAt: undefined,
      summaryStale: undefined,
      summarySourceRevision: (department.summarySourceRevision ?? 0) + 1,
      ...(department.summaryV2GenerationId
        ? { summaryRegenRequestedAgain: true }
        : {}),
    });
    await ctx.runMutation(internal.summariesHelpers.markFunctionSummaryStale, {
      functionId: department.functionId,
    });
  }
}

/**
 * A done contribution arrived in `processId` from another process. Call after
 * the row has been re-pointed.
 *
 * `hadDoneBefore` is whether the process already had a done contribution. When
 * it had none, there is no overview or flow to mark stale, and leaving the
 * process with evidence but nothing generated would read as broken, so both
 * pipelines start, exactly as when a first recording finishes. They are
 * scheduled rather than run inline so a dispatch failure can never undo the
 * move itself. The contribution's cached evidence is process-independent, so
 * the rebuild makes no per-contribution AI call.
 */
export async function invalidateProcessAfterEvidenceArrived(
  ctx: MutationCtx,
  clerkOrgId: string,
  processId: Id<"processes">,
  hadDoneBefore: boolean,
): Promise<void> {
  const process = await ctx.db.get(processId);
  if (!process || process.clerkOrgId !== clerkOrgId) return;

  if (!hadDoneBefore) {
    await ctx.scheduler.runAfter(
      0,
      internal.summaryEvidence.requestProcessSummaryRebuild,
      { processId, clerkOrgId },
    );
    await ctx.scheduler.runAfter(
      0,
      internal.processFlows.requestFlowGeneration,
      { processId, clerkOrgId },
    );
  } else {
    await ctx.runMutation(internal.processFlows.markFlowStale, {
      processId,
      clerkOrgId,
      trigger: "evidenceChanged",
    });
    await ctx.runMutation(internal.summaryEvidence.markProcessSummaryStale, {
      processId,
      clerkOrgId,
    });
  }
  await ctx.runMutation(internal.summariesHelpers.markDepartmentSummaryStale, {
    departmentId: process.departmentId,
  });
}

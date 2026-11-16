import { DAY, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError } from "convex/values";
import { components } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { OrgContext } from "./orgAuth";
import { userError } from "./userError";

/**
 * Manual regeneration limits (docs/security-hardening-task-list.md, D4,
 * approved 2026-11-16). Each "Regenerate" press buys a full AI pipeline, so:
 *
 * - A contributor can start one only when there is something to redo: the
 *   output is missing, failed, stale, or out of step with its inputs.
 * - An admin can force a rerun of a current output, 3 times per process per
 *   day for each kind (flow, recommendations).
 * - Every workspace gets 30 manual runs a day across both kinds.
 *
 * Automatic runs (after an interview, a move, a reconcile) never come through
 * here. Joining a run already in flight costs nothing and is never limited.
 */
export const MANUAL_RUN_LIMITS = {
  manualForcedPerProcess: { kind: "fixed window", rate: 3, period: DAY },
  manualPerOrg: { kind: "fixed window", rate: 30, period: DAY },
} as const;

const limiter = new RateLimiter(components.rateLimiter, MANUAL_RUN_LIMITS);

export type ManualRunKind = "flow" | "recommendations";

const UP_TO_DATE: Record<ManualRunKind, string> = {
  flow: "This process flow is already up to date with its contributions.",
  recommendations: "These recommendations are already up to date with the process flow.",
};

/**
 * Refuses a manual run that has nothing to do (unless an admin forces it) or
 * that is over a daily cap; otherwise takes it from the caps. Call inside the
 * mutation that starts the run, after deciding it won't merely join one.
 */
export async function takeManualRun(
  ctx: MutationCtx,
  caller: OrgContext,
  args: { kind: ManualRunKind; processId: Id<"processes">; hasWork: boolean; force: boolean },
): Promise<void> {
  if (args.force && caller.role !== "admin") {
    throw userError("FORCE_NOT_ALLOWED", "Only an admin can regenerate an up-to-date result.");
  }
  if (!args.hasWork && !args.force) {
    // `canForce` lets the button offer an admin "Regenerate anyway" without
    // the client having to know the caller's role.
    throw new ConvexError({
      code: "NOTHING_TO_REGENERATE",
      userMessage: UP_TO_DATE[args.kind],
      canForce: caller.role === "admin",
    });
  }
  const forced = !args.hasWork;
  const processKey = `${caller.orgId}|${args.processId}|${args.kind}`;
  if (forced) {
    const perProcess = await limiter.check(ctx, "manualForcedPerProcess", { key: processKey });
    if (!perProcess.ok) {
      throw userError(
        "REGENERATE_LIMIT_REACHED",
        "This has already been regenerated 3 times today. Try again tomorrow.",
      );
    }
  }
  const perOrg = await limiter.check(ctx, "manualPerOrg", { key: caller.orgId });
  if (!perOrg.ok) {
    throw userError(
      "REGENERATE_LIMIT_REACHED",
      "Your workspace has reached today's limit for regenerating. Try again tomorrow.",
    );
  }
  if (forced) await limiter.limit(ctx, "manualForcedPerProcess", { key: processKey });
  await limiter.limit(ctx, "manualPerOrg", { key: caller.orgId });
}

/**
 * Whether a flow needs rebuilding: none yet, the last run failed or left
 * details unfinished, it predates the current pipeline, it is flagged stale,
 * or the number of finished contributions has changed since it was built
 * (the read model's staleness rule, in both directions).
 */
export async function flowHasWork(
  ctx: MutationCtx,
  flow: Doc<"processFlows"> | null,
  clerkOrgId: string,
  processId: Id<"processes">,
): Promise<boolean> {
  if (!flow) return true;
  if (flow.status === "failed" || flow.stale || flow.generationVersion !== "v3") return true;
  if (flow.detailsStatus === "failed" || flow.detailsStatus === "partial") return true;
  // Only whether the count differs matters, so read at most one past it.
  const done = await ctx.db
    .query("conversations")
    .withIndex("by_clerkOrgId_and_processId_and_status", (q) =>
      q.eq("clerkOrgId", clerkOrgId).eq("processId", processId).eq("status", "done"),
    )
    .take(flow.conversationCount + 1);
  return done.length !== flow.conversationCount;
}

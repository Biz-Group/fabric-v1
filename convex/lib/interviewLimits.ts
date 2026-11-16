import { DAY, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";

/**
 * Interview start caps (docs/security-hardening-task-list.md, D3, approved
 * 2026-11-16): 20 interviews a day per member and 200 per workspace. Fixed
 * daily windows, consumed when Fabric issues the conversation token, so a
 * started-but-abandoned interview still counts. Numbers are a first guess;
 * tune from real usage.
 */
export const INTERVIEW_RATE_LIMITS = {
  interviewUser: { kind: "fixed window", rate: 20, period: DAY },
  interviewOrg: { kind: "fixed window", rate: 200, period: DAY },
} as const;

/**
 * How long an issued interview counts as possibly still running for the "one
 * open interview at a time" rule: the agent's 6000 s maximum plus a margin.
 * Before refusing, `startInterview` asks ElevenLabs whether the open one is
 * actually live, so a closed tab doesn't block the member for this long.
 */
export const INTERVIEW_OPEN_WINDOW_MS = (6000 + 10 * 60) * 1000;

const limiter = new RateLimiter(components.rateLimiter, INTERVIEW_RATE_LIMITS);

export type InterviewLimitCheck = { ok: true } | { ok: false; scope: "user" | "org"; retryAfterMs: number };

/** Called inside the import's insert: the interview is in, so it no longer counts as open. */
export async function markSessionImported(ctx: MutationCtx, clerkOrgId: string, elevenlabsConversationId: string) {
  const sessions = await ctx.db
    .query("interviewSessions")
    .withIndex("by_elevenlabsConversationId", (q) => q.eq("elevenlabsConversationId", elevenlabsConversationId))
    .take(5);
  for (const session of sessions) {
    if (session.clerkOrgId === clerkOrgId && session.status !== "imported") {
      await ctx.db.patch("interviewSessions", session._id, { status: "imported" });
    }
  }
}

/**
 * When import binding is enforced. Unset: not enforced, mismatches are only
 * logged (the rollout default, and the kill switch). Set to an epoch-ms
 * timestamp: conversations that started at or after it must have been issued
 * by Fabric; older ones (before the switch-over) import as before.
 */
export function interviewBindingEnforcedFrom(): number | null {
  const raw = process.env.INTERVIEW_SESSIONS_ENFORCED_FROM;
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Consumes one interview from the member's and the workspace's daily caps. */
export async function takeInterviewQuota(
  ctx: MutationCtx,
  { orgId, userId }: { orgId: string; userId: string },
): Promise<InterviewLimitCheck> {
  // Check both before consuming either, so a refused org cap doesn't eat
  // the member's own allowance.
  const user = await limiter.check(ctx, "interviewUser", { key: `${orgId}|${userId}` });
  if (!user.ok) return { ok: false, scope: "user", retryAfterMs: user.retryAfter };
  const org = await limiter.check(ctx, "interviewOrg", { key: orgId });
  if (!org.ok) return { ok: false, scope: "org", retryAfterMs: org.retryAfter };
  await limiter.limit(ctx, "interviewUser", { key: `${orgId}|${userId}` });
  await limiter.limit(ctx, "interviewOrg", { key: orgId });
  return { ok: true };
}

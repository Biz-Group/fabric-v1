import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";

/**
 * MCP rate limits (B4, 2026-11-12): 60 tool calls a minute per user and 600 a
 * minute per workspace. Token buckets, so a burst of parallel calls at the start
 * of a question is fine; a looping agent is stopped. Tune from the audit data.
 *
 * Only `tools/call` is limited. Discovery and `tools/list` read no tenant data.
 */
export const MCP_RATE_LIMITS = {
  mcpUser: { kind: "token bucket", rate: 60, period: MINUTE },
  mcpOrg: { kind: "token bucket", rate: 600, period: MINUTE },
} as const;

const limiter = new RateLimiter(components.rateLimiter, MCP_RATE_LIMITS);

export type RateLimitCheck = { ok: true } | { ok: false; scope: "user" | "org"; retryAfterMs: number };

export async function checkRateLimit(
  ctx: ActionCtx,
  { tokenIdentifier, orgId }: { tokenIdentifier: string; orgId: string },
): Promise<RateLimitCheck> {
  // The user's limit is per workspace, so one busy workspace never blocks a
  // super-user in another.
  const user = await limiter.limit(ctx, "mcpUser", { key: `${orgId}|${tokenIdentifier}` });
  if (!user.ok) return { ok: false, scope: "user", retryAfterMs: user.retryAfter };
  const org = await limiter.limit(ctx, "mcpOrg", { key: orgId });
  if (!org.ok) return { ok: false, scope: "org", retryAfterMs: org.retryAfter };
  return { ok: true };
}

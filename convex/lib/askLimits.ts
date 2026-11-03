import { env, type QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Beta usage limits (D51, amends D18): questions per member per day and per
 * org per day, counted from answers that didn't fail. Days run midnight to
 * midnight Gulf time (UTC+4, no daylight saving), so every tenant resets at
 * the same moment.
 */

export const DEFAULT_DAILY_USER_LIMIT = 10;
export const DEFAULT_DAILY_ORG_LIMIT = 100;

const DAY_MS = 24 * 60 * 60 * 1_000;
const GULF_OFFSET_MS = 4 * 60 * 60 * 1_000;
/** Rows read past the limit at most, so a run of failed answers stays bounded. */
const MAX_SCAN = 1_000;

/** When the Gulf-time day containing `now` started. */
export function gulfDayStart(now: number): number {
  return Math.floor((now + GULF_OFFSET_MS) / DAY_MS) * DAY_MS - GULF_OFFSET_MS;
}

/**
 * A limit variable: unset or invalid means the default; `off` means no limit
 * (for when the beta ends); otherwise a positive whole number.
 */
export function parseDailyLimit(raw: string | undefined, fallback: number): number | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "off") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export type AskDailyLimits = { user: number | null; org: number | null };

export function readAskDailyLimits(): AskDailyLimits {
  return {
    user: parseDailyLimit(env.ASKFABRIC_DAILY_USER_LIMIT, DEFAULT_DAILY_USER_LIMIT),
    org: parseDailyLimit(env.ASKFABRIC_DAILY_ORG_LIMIT, DEFAULT_DAILY_ORG_LIMIT),
  };
}

type Counted = AsyncIterable<{ status?: string }>;

/** Answers that didn't fail, counted up to `stopAt`. */
async function countUpTo(rows: Counted, stopAt: number): Promise<number> {
  let counted = 0;
  let scanned = 0;
  for await (const row of rows) {
    if (row.status !== "error") counted += 1;
    scanned += 1;
    if (counted >= stopAt || scanned >= stopAt + MAX_SCAN) break;
  }
  return counted;
}

/** The member's questions today, up to `stopAt`. */
export async function userQuestionsToday(
  ctx: QueryCtx,
  clerkOrgId: string,
  userId: Id<"users">,
  now: number,
  stopAt: number,
): Promise<number> {
  const since = gulfDayStart(now);
  return await countUpTo(
    ctx.db
      .query("askMessages")
      .withIndex("by_clerkOrgId_and_userId_and_role", (q) =>
        q.eq("clerkOrgId", clerkOrgId).eq("userId", userId).eq("role", "assistant").gte("_creationTime", since),
      ),
    stopAt,
  );
}

/** The org's questions today, up to `stopAt`. */
export async function orgQuestionsToday(
  ctx: QueryCtx,
  clerkOrgId: string,
  now: number,
  stopAt: number,
): Promise<number> {
  const since = gulfDayStart(now);
  return await countUpTo(
    ctx.db
      .query("askMessages")
      .withIndex("by_clerkOrgId_and_role", (q) =>
        q.eq("clerkOrgId", clerkOrgId).eq("role", "assistant").gte("_creationTime", since),
      ),
    stopAt,
  );
}

/** Whether the member has an answer streaming in any thread of this org. */
export async function hasStreamingAnswer(ctx: QueryCtx, clerkOrgId: string, userId: Id<"users">): Promise<boolean> {
  // One answer at a time means a streaming answer is always the member's latest.
  const latest = await ctx.db
    .query("askMessages")
    .withIndex("by_clerkOrgId_and_userId_and_role", (q) =>
      q.eq("clerkOrgId", clerkOrgId).eq("userId", userId).eq("role", "assistant"),
    )
    .order("desc")
    .first();
  return latest?.status === "streaming";
}

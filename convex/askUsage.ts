import { paginationOptsValidator } from "convex/server";
import { query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { gulfDayStart, readAskDailyLimits } from "./lib/askLimits";
import { requireOrgAdmin } from "./lib/orgAuth";

/**
 * The org admin's AskFabric page (FR-8.3, D39, D50): activity and feedback,
 * never thread titles or content (D12), and no cost. Usage is billed to the
 * client, but amounts stay in the Fabric team's tenant console (D50).
 */

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_MESSAGES = 10_000;
const FEEDBACK_PAGE = 25;

/** Display names for org members, "Former member" for anyone removed. */
function memberNames(ctx: QueryCtx, orgId: string) {
  const cache = new Map<string, Promise<string>>();
  const resolve = async (userId: Id<"users">) => {
    const user = await ctx.db.get(userId);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(100);
    const active = memberships.find(
      (m) => m.clerkOrgId === orgId && m.removedAt === undefined && m.status !== "removed",
    );
    return active ? (user?.name ?? user?.email ?? "Member") : "Former member";
  };
  return (userId: Id<"users">) => {
    let name = cache.get(userId);
    if (!name) {
      name = resolve(userId);
      cache.set(userId, name);
    }
    return name;
  };
}

export const getOrgUsage = query({
  args: {},
  handler: async (ctx) => {
    const org = await requireOrgAdmin(ctx);
    const now = Date.now();
    const since30 = now - 30 * DAY_MS;
    const since7 = now - 7 * DAY_MS;

    const answers = await ctx.db
      .query("askMessages")
      .withIndex("by_clerkOrgId_and_role", (q) =>
        q.eq("clerkOrgId", org.orgId).eq("role", "assistant").gte("_creationTime", since30),
      )
      .take(MAX_MESSAGES);
    const window = (since: number) => {
      const rows = answers.filter((a) => a._creationTime >= since);
      return {
        questions: rows.length,
        threads: new Set(rows.map((a) => a.threadId)).size,
        activeUsers: new Set(rows.map((a) => a.userId)).size,
      };
    };
    const finished = answers.filter((a) => a.status !== "streaming");
    const errors = finished.filter((a) => a.status === "error").length;
    const stopped = finished.filter((a) => a.status === "stopped").length;

    const feedback = await ctx.db
      .query("askFeedback")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", org.orgId).gte("_creationTime", since30))
      .take(MAX_MESSAGES);

    // Beta limits (D51): member-days and org-days that reached today's limit,
    // judged against the current limits, from answers that didn't fail.
    const limits = readAskDailyLimits();
    const perUserDay = new Map<string, number>();
    const perOrgDay = new Map<number, number>();
    for (const answer of answers) {
      if (answer.status === "error") continue;
      const day = gulfDayStart(answer._creationTime);
      const key = `${answer.userId}:${day}`;
      perUserDay.set(key, (perUserDay.get(key) ?? 0) + 1);
      perOrgDay.set(day, (perOrgDay.get(day) ?? 0) + 1);
    }
    const userDaysAtLimit = new Map<string, number>();
    if (limits.user !== null) {
      for (const [key, count] of perUserDay) {
        if (count < limits.user) continue;
        const userId = key.slice(0, key.indexOf(":"));
        userDaysAtLimit.set(userId, (userDaysAtLimit.get(userId) ?? 0) + 1);
      }
    }
    const orgLimit = limits.org;
    const orgDaysAtLimit = orgLimit === null ? 0 : [...perOrgDay.values()].filter((count) => count >= orgLimit).length;

    const perUser = new Map<Id<"users">, { questions: number; thumbsUp: number; thumbsDown: number }>();
    const entry = (userId: Id<"users">) => {
      const current = perUser.get(userId) ?? { questions: 0, thumbsUp: 0, thumbsDown: 0 };
      perUser.set(userId, current);
      return current;
    };
    for (const answer of answers) entry(answer.userId).questions += 1;
    for (const row of feedback) {
      if (row.rating === "up") entry(row.userId).thumbsUp += 1;
      else entry(row.userId).thumbsDown += 1;
    }
    const nameOf = memberNames(ctx, org.orgId);
    const members = [];
    for (const [userId, stats] of perUser) {
      members.push({ userId, name: await nameOf(userId), ...stats, daysAtLimit: userDaysAtLimit.get(userId) ?? 0 });
    }
    members.sort((a, b) => b.questions - a.questions || a.name.localeCompare(b.name));

    return {
      last7Days: window(since7),
      last30Days: window(since30),
      thumbsUp: feedback.filter((f) => f.rating === "up").length,
      thumbsDown: feedback.filter((f) => f.rating === "down").length,
      errorRate: finished.length ? errors / finished.length : 0,
      stopRate: finished.length ? stopped / finished.length : 0,
      members: members.slice(0, 50),
      limits,
      membersAtLimit: userDaysAtLimit.size,
      orgDaysAtLimit,
      capped: answers.length === MAX_MESSAGES,
    };
  },
});

/**
 * Feedback, newest first: who rated, when, which way, and whether they shared
 * the answer with the Fabric team. Never the question or the answer (D12).
 */
export const listFeedback = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const org = await requireOrgAdmin(ctx);
    const result = await ctx.db
      .query("askFeedback")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", org.orgId))
      .order("desc")
      .paginate({ ...args.paginationOpts, numItems: Math.min(args.paginationOpts.numItems, FEEDBACK_PAGE) });
    const nameOf = memberNames(ctx, org.orgId);
    const page = [];
    for (const row of result.page) {
      const shared =
        row.rating === "down"
          ? (await ctx.db
              .query("askSharedExchanges")
              .withIndex("by_messageId", (q) => q.eq("messageId", row.messageId))
              .first()) !== null
          : false;
      page.push({
        _id: row._id,
        ratedAt: row._creationTime,
        member: await nameOf(row.userId),
        rating: row.rating,
        shared,
      });
    }
    return { ...result, page };
  },
});

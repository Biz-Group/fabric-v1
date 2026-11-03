import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOrgAdmin } from "./lib/orgAuth";

/**
 * The org admin's "AskFabric usage" card (FR-8.3, D39): counts and money only,
 * never titles or content. Questions and outcomes come from assistant
 * messages, tokens and cost from the usage ledger, which keeps rows for
 * removed members, so they read as "former member".
 */

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_MESSAGES = 10_000;
const MAX_LEDGER_ROWS = 20_000;

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

    const ledger = (
      await ctx.db
        .query("aiUsageEvents")
        .withIndex("by_clerkOrgId_and_createdAt", (q) => q.eq("clerkOrgId", org.orgId).gte("createdAt", since30))
        .take(MAX_LEDGER_ROWS)
    ).filter((row) => row.operation.startsWith("askfabric."));
    const tokens = ledger.reduce(
      (sum, row) => sum + (row.inputTokens ?? 0) + (row.cachedReadTokens ?? 0) + (row.cacheWriteTokens ?? 0) + (row.outputTokens ?? 0),
      0,
    );
    const costMicroUsd = ledger.reduce((sum, row) => sum + row.costMicroUsd, 0);

    // Per user: questions from answers, cost from the ledger (actor id).
    const perUser = new Map<string, { questions: number; costMicroUsd: number }>();
    for (const answer of answers) {
      const entry = perUser.get(answer.userId) ?? { questions: 0, costMicroUsd: 0 };
      entry.questions += 1;
      perUser.set(answer.userId, entry);
    }
    for (const row of ledger) {
      if (!row.actorUserId) continue;
      const entry = perUser.get(row.actorUserId) ?? { questions: 0, costMicroUsd: 0 };
      entry.costMicroUsd += row.costMicroUsd;
      perUser.set(row.actorUserId, entry);
    }
    const members = [];
    for (const [userId, stats] of perUser) {
      const id = ctx.db.normalizeId("users", userId);
      const user = id ? await ctx.db.get(id) : null;
      const membership = id
        ? (
            await ctx.db
              .query("memberships")
              .withIndex("by_userId", (q) => q.eq("userId", id as Id<"users">))
              .take(100)
          ).find((m) => m.clerkOrgId === org.orgId && m.removedAt === undefined && m.status !== "removed")
        : undefined;
      members.push({
        userId,
        name: membership ? (user?.name ?? user?.email ?? "Member") : "Former member",
        ...stats,
      });
    }
    members.sort((a, b) => b.questions - a.questions || b.costMicroUsd - a.costMicroUsd || a.name.localeCompare(b.name));

    return {
      last7Days: window(since7),
      last30Days: window(since30),
      tokens,
      costMicroUsd,
      thumbsUp: feedback.filter((f) => f.rating === "up").length,
      thumbsDown: feedback.filter((f) => f.rating === "down").length,
      errorRate: finished.length ? errors / finished.length : 0,
      stopRate: finished.length ? stopped / finished.length : 0,
      members: members.slice(0, 50),
      capped: answers.length === MAX_MESSAGES || ledger.length === MAX_LEDGER_ROWS,
    };
  },
});

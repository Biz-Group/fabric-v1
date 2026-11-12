import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { env, internalAction, internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { utcDayBounds, utcDayKey } from "./lib/aiUsageRollup";
import { requireOrgAdmin, requireSuperAdmin } from "./lib/orgAuth";
import { clientLabel, foldMcpCalls, sumDays, type McpDayCounts } from "./mcp/usageFold";

/**
 * Fabric MCP audit and metering (docs/fabric-mcp-build-task-list.md, Phase 3).
 *
 * Every tool call writes one `mcpCalls` row (who, which client, which tool,
 * the outcome; never input or output). A nightly fold turns each day into one
 * `mcpUsageDays` row per workspace, the add-on's billing record (B2: calls and
 * users, no price). Raw rows are pruned after RETENTION_DAYS once their day is
 * folded. Dev usage is not forwarded to the prod console (B2).
 */

const RETENTION_DAYS = 90;
const RETENTION_BATCH_SIZE = 500;
/** Raw rows read for one un-folded day (normally today) in a console query. */
const LIVE_DAY_CAP = 5_000;
/** Raw rows read for the per-member breakdown on the admin page. */
const MEMBER_SCAN_CAP = 10_000;
const MAX_RANGE_DAYS = 92;

const outcomeValidator = v.union(
  v.literal("ok"),
  v.literal("notFound"),
  v.literal("error"),
  v.literal("badArguments"),
  v.literal("rateLimited"),
);

const dayValidator = v.object({
  clerkOrgId: v.string(),
  period: v.string(),
  calls: v.number(),
  failures: v.number(),
  users: v.number(),
  tools: v.array(v.object({ tool: v.string(), calls: v.number(), failures: v.number() })),
  clients: v.array(v.object({ clientId: v.string(), calls: v.number() })),
});

// ---- Writing --------------------------------------------------------------------

export const record = internalMutation({
  args: {
    clerkOrgId: v.string(),
    userId: v.optional(v.id("users")),
    clientId: v.string(),
    tool: v.string(),
    outcome: outcomeValidator,
    resultCount: v.number(),
    truncated: v.boolean(),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("mcpCalls", { ...args, createdAt: Date.now() });
    return null;
  },
});

// ---- Nightly fold and pruning ----------------------------------------------------

export const pageCallsForDay = internalQuery({
  args: { start: v.number(), end: v.number(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) =>
    await ctx.db
      .query("mcpCalls")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", args.start).lt("createdAt", args.end))
      .paginate(args.paginationOpts),
});

export const writeDays = internalMutation({
  args: { days: v.array(dayValidator) },
  handler: async (ctx, { days }) => {
    const foldedAt = Date.now();
    for (const day of days) {
      const existing = await ctx.db
        .query("mcpUsageDays")
        .withIndex("by_clerkOrgId_and_period", (q) => q.eq("clerkOrgId", day.clerkOrgId).eq("period", day.period))
        .first();
      if (existing) await ctx.db.replace(existing._id, { ...day, foldedAt });
      else await ctx.db.insert("mcpUsageDays", { ...day, foldedAt });
    }
    return null;
  },
});

/** Folds one UTC day (default: yesterday). Idempotent: re-running replaces the day's rows. */
export const foldDay = internalAction({
  args: { period: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ period: string; workspaces: number; calls: number }> => {
    const period = args.period ?? utcDayKey(Date.now() - 24 * 60 * 60 * 1000);
    const { start, end } = utcDayBounds(period);
    const rows: Array<Doc<"mcpCalls">> = [];
    let cursor: string | null = null;
    for (;;) {
      const page: { page: Array<Doc<"mcpCalls">>; isDone: boolean; continueCursor: string } = await ctx.runQuery(
        internal.mcpUsage.pageCallsForDay,
        { start, end, paginationOpts: { numItems: 1000, cursor } },
      );
      rows.push(...page.page);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    const days = foldMcpCalls(period, rows);
    for (let i = 0; i < days.length; i += 100) {
      await ctx.runMutation(internal.mcpUsage.writeDays, { days: days.slice(i, i + 100) });
    }
    return { period, workspaces: days.length, calls: rows.length };
  },
});

/** Deletes raw calls past retention, skipping any day not yet folded (so a stalled fold never loses data). */
export const pruneOldCalls = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number; skipped: number }> => {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const rows = await ctx.db
      .query("mcpCalls")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .take(RETENTION_BATCH_SIZE);
    const folded = new Map<string, boolean>();
    let deleted = 0;
    let skipped = 0;
    for (const row of rows) {
      const period = utcDayKey(row.createdAt);
      let isFolded = folded.get(period);
      if (isFolded === undefined) {
        isFolded =
          (await ctx.db
            .query("mcpUsageDays")
            .withIndex("by_period", (q) => q.eq("period", period))
            .first()) !== null;
        folded.set(period, isFolded);
      }
      if (!isFolded) {
        skipped += 1;
        continue;
      }
      await ctx.db.delete(row._id);
      deleted += 1;
    }
    if (skipped > 0) console.warn("Skipped pruning MCP calls for un-folded days", { skipped });
    return { deleted, skipped };
  },
});

// ---- Reading ------------------------------------------------------------------

/** The UTC day keys from `from` to `to` inclusive (YYYY-MM-DD), at most MAX_RANGE_DAYS. */
function periodsBetween(from: string, to: string): string[] {
  const periods: string[] = [];
  let { start } = utcDayBounds(from);
  const { start: last } = utcDayBounds(to);
  while (start <= last && periods.length < MAX_RANGE_DAYS) {
    periods.push(utcDayKey(start));
    start += 24 * 60 * 60 * 1000;
  }
  return periods;
}

/**
 * One workspace's days in a range: the folded row where the fold has run,
 * otherwise a live fold of that day's raw calls (normally just today).
 */
async function workspaceDays(ctx: QueryCtx, clerkOrgId: string, from: string, to: string) {
  const days: McpDayCounts[] = [];
  let capped = false;
  for (const period of periodsBetween(from, to)) {
    const folded = await ctx.db
      .query("mcpUsageDays")
      .withIndex("by_clerkOrgId_and_period", (q) => q.eq("clerkOrgId", clerkOrgId).eq("period", period))
      .first();
    if (folded) {
      days.push(folded);
      continue;
    }
    const { start, end } = utcDayBounds(period);
    const rows = await ctx.db
      .query("mcpCalls")
      .withIndex("by_clerkOrgId_and_createdAt", (q) => q.eq("clerkOrgId", clerkOrgId).gte("createdAt", start).lt("createdAt", end))
      .take(LIVE_DAY_CAP);
    if (rows.length === LIVE_DAY_CAP) capped = true;
    days.push(foldMcpCalls(period, rows)[0] ?? { clerkOrgId, period, calls: 0, failures: 0, users: 0, tools: [], clients: [] });
  }
  return { days, capped };
}

function shape(days: McpDayCounts[]) {
  const totals = sumDays(days);
  return {
    byDay: days.map((day) => ({ period: day.period, calls: day.calls, failures: day.failures, users: day.users })),
    totals: {
      ...totals,
      clients: totals.clients.map((c) => ({ ...c, label: clientLabel(c.clientId, env.FABRIC_MCP_CLIENT_NAMES) })),
    },
  };
}

const rangeArgs = { from: v.string(), to: v.string() };

/** Tenants console → one workspace's MCP usage. */
export const tenantUsage = query({
  args: { clerkOrgId: v.string(), ...rangeArgs },
  handler: async (ctx, { clerkOrgId, from, to }) => {
    await requireSuperAdmin(ctx);
    const { days, capped } = await workspaceDays(ctx, clerkOrgId, from, to);
    return { ...shape(days), capped };
  },
});

/** Tenants console → usage overview: MCP calls per workspace in a range. */
export const usageOverview = query({
  args: rangeArgs,
  handler: async (ctx, { from, to }) => {
    await requireSuperAdmin(ctx);
    const folded = await ctx.db
      .query("mcpUsageDays")
      .withIndex("by_period", (q) => q.gte("period", from).lte("period", to))
      .take(10_000);
    const foldedPeriods = new Set(folded.map((day) => day.period));
    // Days in range with no folded row anywhere (normally today) are folded live.
    const live: McpDayCounts[] = [];
    let capped = false;
    for (const period of periodsBetween(from, to)) {
      if (foldedPeriods.has(period)) continue;
      const { start, end } = utcDayBounds(period);
      const rows = await ctx.db
        .query("mcpCalls")
        .withIndex("by_createdAt", (q) => q.gte("createdAt", start).lt("createdAt", end))
        .take(LIVE_DAY_CAP);
      if (rows.length === LIVE_DAY_CAP) capped = true;
      live.push(...foldMcpCalls(period, rows));
    }
    const byOrg = new Map<string, McpDayCounts[]>();
    for (const day of [...folded, ...live]) byOrg.set(day.clerkOrgId, [...(byOrg.get(day.clerkOrgId) ?? []), day]);
    const tenants = [];
    for (const [clerkOrgId, days] of byOrg) {
      const tenant = await ctx.db
        .query("tenants")
        .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", clerkOrgId))
        .first();
      const totals = sumDays(days);
      tenants.push({
        clerkOrgId,
        name: tenant?.name ?? clerkOrgId,
        calls: totals.calls,
        failures: totals.failures,
        peakDailyUsers: totals.peakDailyUsers,
        activeDays: totals.activeDays,
      });
    }
    tenants.sort((a, b) => b.calls - a.calls);
    return { tenants, capped };
  },
});

/** Admin → MCP: this workspace's usage, with a per-member breakdown. */
export const workspaceUsage = query({
  args: rangeArgs,
  handler: async (ctx, { from, to }) => {
    const org = await requireOrgAdmin(ctx);
    const { days, capped } = await workspaceDays(ctx, org.orgId, from, to);
    const start = utcDayBounds(from).start;
    const end = utcDayBounds(to).end;
    // Per member from the raw calls, which cover the last RETENTION_DAYS.
    const rows = await ctx.db
      .query("mcpCalls")
      .withIndex("by_clerkOrgId_and_createdAt", (q) => q.eq("clerkOrgId", org.orgId).gte("createdAt", start).lt("createdAt", end))
      .order("desc")
      .take(MEMBER_SCAN_CAP);
    const perUser = new Map<Id<"users">, { calls: number; lastAt: number }>();
    for (const row of rows) {
      if (!row.userId) continue;
      const acc = perUser.get(row.userId) ?? { calls: 0, lastAt: 0 };
      acc.calls += 1;
      acc.lastAt = Math.max(acc.lastAt, row.createdAt);
      perUser.set(row.userId, acc);
    }
    const members = [];
    for (const [userId, acc] of perUser) {
      const user = await ctx.db.get(userId);
      members.push({ userId, name: user?.name ?? user?.email ?? "Former member", ...acc });
    }
    members.sort((a, b) => b.calls - a.calls);
    return {
      ...shape(days),
      activeMembers: members.length,
      members,
      capped: capped || rows.length === MEMBER_SCAN_CAP,
    };
  },
});

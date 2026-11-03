import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { isoDate } from "./askTools/results";
import { loadScopeEvidence } from "./askTools/evidence";
import { loadHierarchy } from "./askTools/scope";
import { collectSignals } from "./askTools/signals";
import { summarizeSystems } from "./askTools/systems";
import { buildSuggestions, type Suggestion } from "./askfabric/suggestions";
import { askFabricAvailability } from "./lib/askFabricFeature";
import { isActiveMembership, requireOrgMember } from "./lib/orgAuth";

/**
 * Stored starter prompts (FR-6.1, FR-6.3): one set per recent visitor and an
 * org default for first visits. Built from readable, gated data only.
 */

const DAY_MS = 24 * 60 * 60 * 1_000;
/** Sets older than this are rebuilt when their owner opens AskFabric. */
const STALE_AFTER_MS = DAY_MS;
/** Pipeline completions in an org trigger at most one rebuild per window. */
const DEBOUNCE_MS = 15 * 60 * 1_000;
/** Only users who opened AskFabric this recently get rebuilt sets. */
const ACTIVE_WINDOW_MS = 30 * DAY_MS;
const MAX_VISITORS = 200;
const MAX_DONE_SCAN = 1_000;

type Inputs = Parameters<typeof buildSuggestions>[0];

async function orgDefaultRow(ctx: MutationCtx, clerkOrgId: string) {
  return await ctx.db
    .query("askSuggestions")
    .withIndex("by_clerkOrgId_and_userId", (q) => q.eq("clerkOrgId", clerkOrgId).eq("userId", undefined))
    .first();
}

async function userRow(ctx: MutationCtx, clerkOrgId: string, userId: Id<"users">) {
  return await ctx.db
    .query("askSuggestions")
    .withIndex("by_clerkOrgId_and_userId", (q) => q.eq("clerkOrgId", clerkOrgId).eq("userId", userId))
    .first();
}

/** The org-level part of the inputs: one evidence pass for the whole org. */
async function orgInputs(ctx: MutationCtx, clerkOrgId: string) {
  const hierarchy = await loadHierarchy(ctx, clerkOrgId);
  const evidence = await loadScopeEvidence(ctx, clerkOrgId, hierarchy.processes);
  const ranked = collectSignals(new Set(["bottleneck", "friction", "tribalKnowledge"] as const), evidence, []);
  let topSignal: Inputs["topSignal"] = null;
  for (const signal of ["bottleneck", "friction", "tribalKnowledge"] as const) {
    const item = ranked.get(signal)?.[0];
    if (item) {
      topSignal = { signal, processName: item.refs[0].processName };
      break;
    }
  }
  const done = await ctx.db
    .query("conversations")
    .withIndex("by_clerkOrgId_and_status", (q) => q.eq("clerkOrgId", clerkOrgId).eq("status", "done"))
    .order("desc")
    .take(MAX_DONE_SCAN);
  return {
    hierarchy,
    done,
    base: {
      completedContributions: done.length,
      topSignal,
      hasSystems: summarizeSystems(evidence).length > 0,
    },
  };
}

function signalKeys(prompts: Suggestion[]): string[] {
  return prompts.map((prompt) => `${prompt.category}:${prompt.text}`);
}

/**
 * Rebuilds the org default and the sets of recent visitors (or only
 * `onlyUserId`). Per-user parts: the role, the department prompt from the
 * member's placement, and "what's new" since their previous visit.
 */
export const recomputeForOrg = internalMutation({
  args: { clerkOrgId: v.string(), onlyUserId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    if (!askFabricAvailability(args.clerkOrgId).available) return null;
    const now = Date.now();
    const { hierarchy, done, base } = await orgInputs(ctx, args.clerkOrgId);

    const orgPrompts = buildSuggestions({ ...base, role: "viewer", department: null, newSince: null });
    const orgRow = await orgDefaultRow(ctx, args.clerkOrgId);
    const orgFields = { prompts: orgPrompts, signals: signalKeys(orgPrompts), generatedAt: now, refreshScheduledAt: undefined };
    if (orgRow) await ctx.db.patch("askSuggestions", orgRow._id, orgFields);
    else await ctx.db.insert("askSuggestions", { clerkOrgId: args.clerkOrgId, ...orgFields });

    let rows: Doc<"askSuggestions">[];
    if (args.onlyUserId) {
      const row = await userRow(ctx, args.clerkOrgId, args.onlyUserId);
      rows = row ? [row] : [];
    } else {
      rows = await ctx.db
        .query("askSuggestions")
        .withIndex("by_clerkOrgId_and_lastVisitedAt", (q) =>
          q.eq("clerkOrgId", args.clerkOrgId).gte("lastVisitedAt", now - ACTIVE_WINDOW_MS),
        )
        .take(MAX_VISITORS);
    }

    for (const row of rows) {
      if (!row.userId) continue;
      const userId = row.userId;
      const membership =
        (
          await ctx.db
            .query("memberships")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .take(100)
        ).find((m) => m.clerkOrgId === args.clerkOrgId) ?? null;
      if (!isActiveMembership(membership)) continue;
      const department = membership.departmentId ? hierarchy.departmentById.get(membership.departmentId) : undefined;
      const since = row.previousVisitedAt ?? null;
      const newCount = since === null ? 0 : done.filter((c) => c._creationTime > since).length;
      const prompts = buildSuggestions({
        ...base,
        role: membership.role,
        department: department?.name ?? null,
        newSince: since !== null && newCount > 0 ? { count: newCount, date: isoDate(since)! } : null,
      });
      await ctx.db.patch("askSuggestions", row._id, { prompts, signals: signalKeys(prompts), generatedAt: now });
    }
    return null;
  },
});

/**
 * Asks for a rebuild after pipeline work lands in the org (FR-6.3), at most
 * once per 15 minutes. A no-op where AskFabric has no visitors yet.
 */
export async function requestSuggestionsRefresh(ctx: MutationCtx, clerkOrgId: string): Promise<void> {
  const row = await orgDefaultRow(ctx, clerkOrgId);
  if (!row) return;
  const now = Date.now();
  if (row.refreshScheduledAt !== undefined && row.refreshScheduledAt > now) return;
  await ctx.db.patch("askSuggestions", row._id, { refreshScheduledAt: now + DEBOUNCE_MS });
  await ctx.scheduler.runAfter(DEBOUNCE_MS, internal.askSuggestions.recomputeForOrg, { clerkOrgId });
}

/** Daily rebuild for every org with a visitor in the last 30 days (FR-6.3). */
export const recomputeActiveOrgs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - ACTIVE_WINDOW_MS;
    const rows = await ctx.db.query("askSuggestions").take(5_000);
    const orgs = new Set(rows.filter((row) => (row.lastVisitedAt ?? 0) >= cutoff).map((row) => row.clerkOrgId));
    for (const clerkOrgId of orgs) {
      await ctx.scheduler.runAfter(0, internal.askSuggestions.recomputeForOrg, { clerkOrgId });
    }
    return orgs.size;
  },
});

/**
 * Called when the page opens (FR-6.3): records the visit, keeping the
 * previous one for "since your last visit", and rebuilds a set older than a
 * day. A first visit also builds the org default if there is none.
 */
export const markVisited = mutation({
  args: {},
  handler: async (ctx) => {
    const org = await requireOrgMember(ctx);
    if (!askFabricAvailability(org.orgId).available) return null;
    const now = Date.now();
    const row = await userRow(ctx, org.orgId, org.userId);
    if (row) {
      await ctx.db.patch("askSuggestions", row._id, { previousVisitedAt: row.lastVisitedAt, lastVisitedAt: now });
    } else {
      await ctx.db.insert("askSuggestions", {
        clerkOrgId: org.orgId,
        userId: org.userId,
        prompts: [],
        signals: [],
        generatedAt: 0,
        lastVisitedAt: now,
      });
    }
    if (!row || now - row.generatedAt > STALE_AFTER_MS) {
      await ctx.scheduler.runAfter(0, internal.askSuggestions.recomputeForOrg, {
        clerkOrgId: org.orgId,
        onlyUserId: org.userId,
      });
    }
    return null;
  },
});

/** The caller's prompts, else the org default while theirs is being built. */
export const getSuggestions = query({
  args: {},
  handler: async (ctx) => {
    const org = await requireOrgMember(ctx);
    const own = await ctx.db
      .query("askSuggestions")
      .withIndex("by_clerkOrgId_and_userId", (q) => q.eq("clerkOrgId", org.orgId).eq("userId", org.userId))
      .first();
    if (own && own.prompts.length > 0) return own.prompts;
    const fallback = await ctx.db
      .query("askSuggestions")
      .withIndex("by_clerkOrgId_and_userId", (q) => q.eq("clerkOrgId", org.orgId).eq("userId", undefined))
      .first();
    return fallback?.prompts ?? [];
  },
});

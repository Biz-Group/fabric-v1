import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * AskFabric data lifecycle beyond a single thread (FR-3.6, D37, FR-9.7).
 *
 * When a member leaves an org, by any path, their AskFabric content in that
 * org is deleted: threads (with messages, citations, feedback and shared
 * exchanges, through `askThreads.deleteThreadBatch`) and starter-prompt sets.
 * In-flight turns are told to stop first. Content-free `aiUsageEvents` rows
 * stay, for billing. Org deletion does the same for everyone in the org.
 */

/** Threads handed to the per-thread deleter per batch. */
const THREAD_BATCH = 50;
/** Suggestion and shared-exchange rows deleted per batch. */
const ROW_BATCH = 100;

/** Marks a thread `deleting`, stops its streaming answer, and schedules its rows. */
async function retireThread(ctx: MutationCtx, thread: Doc<"askThreads">) {
  await ctx.db.patch("askThreads", thread._id, { status: "deleting", pinnedAt: undefined });
  const latest = await ctx.db
    .query("askMessages")
    .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
    .order("desc")
    .first();
  if (latest?.status === "streaming") {
    await ctx.db.patch("askMessages", latest._id, { cancelRequested: true });
  }
  await ctx.scheduler.runAfter(0, internal.askThreads.deleteThreadBatch, { threadId: thread._id });
}

async function liveThreadsOf(ctx: MutationCtx, clerkOrgId: string, userId: Id<"users">) {
  const threads: Doc<"askThreads">[] = [];
  for (const status of ["active", "archived"] as const) {
    threads.push(
      ...(await ctx.db
        .query("askThreads")
        .withIndex("by_clerkOrgId_and_userId_and_status_and_lastMessageAt", (q) =>
          q.eq("clerkOrgId", clerkOrgId).eq("userId", userId).eq("status", status),
        )
        .take(THREAD_BATCH - threads.length)),
    );
  }
  return threads;
}

/**
 * Called from every membership-removal path, in the transaction that deletes
 * the membership. Stops the member's streaming answers and hides their first
 * threads at once; the rest goes in scheduled batches.
 */
export async function purgeAskFabricForMember(
  ctx: MutationCtx,
  clerkOrgId: string,
  userId: Id<"users">,
): Promise<void> {
  for (const thread of await liveThreadsOf(ctx, clerkOrgId, userId)) {
    await retireThread(ctx, thread);
  }
  await ctx.scheduler.runAfter(0, internal.askLifecycle.purgeMemberBatch, { clerkOrgId, userId });
}

/** Called when an org is deleted: the same purge for every member. */
export async function purgeAskFabricForOrg(ctx: MutationCtx, clerkOrgId: string): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.askLifecycle.purgeOrgBatch, { clerkOrgId });
}

// ---- Source deletion (FR-9.7) -----------------------------------------------

export type CitedSourceKind = "function" | "department" | "process" | "conversation";

/** Citations cleared per batch. */
const CITATION_BATCH = 200;
/** Shared exchanges are opt-in and few; one org's are scanned per pass. */
const SHARED_SCAN = 500;

/**
 * Called wherever a contribution, process, department or function is
 * hard-deleted: schedules clearing the text AskFabric quoted from it. The
 * citation rows stay (the answer's numbering depends on them) and read as
 * "Source no longer available" (FR-5.5).
 */
export async function clearCitedTextFor(
  ctx: MutationCtx,
  clerkOrgId: string,
  sourceKind: CitedSourceKind,
  sourceEntityId: string,
): Promise<void> {
  // Most deletions were never cited: schedule nothing for them.
  const cited = await ctx.db
    .query("askCitations")
    .withIndex("by_clerkOrgId_and_sourceKind_and_sourceEntityId", (q) =>
      q.eq("clerkOrgId", clerkOrgId).eq("sourceKind", sourceKind).eq("sourceEntityId", sourceEntityId),
    )
    .first();
  const shared = await ctx.db
    .query("askSharedExchanges")
    .withIndex("by_clerkOrgId_and_userId", (q) => q.eq("clerkOrgId", clerkOrgId))
    .first();
  if (!cited && !shared) return;
  await ctx.scheduler.runAfter(0, internal.askLifecycle.clearCitedTextBatch, {
    clerkOrgId,
    sourceKind,
    sourceEntityId,
    sharedDone: false,
  });
}

export const clearCitedTextBatch = internalMutation({
  args: {
    clerkOrgId: v.string(),
    sourceKind: v.union(v.literal("function"), v.literal("department"), v.literal("process"), v.literal("conversation")),
    sourceEntityId: v.string(),
    sharedDone: v.boolean(),
  },
  handler: async (ctx, args) => {
    const citations = await ctx.db
      .query("askCitations")
      .withIndex("by_clerkOrgId_and_sourceKind_and_sourceEntityId", (q) =>
        q.eq("clerkOrgId", args.clerkOrgId).eq("sourceKind", args.sourceKind).eq("sourceEntityId", args.sourceEntityId),
      )
      .take(CITATION_BATCH * 2);
    const withText = citations.filter((c) => c.citedText !== undefined).slice(0, CITATION_BATCH);
    for (const citation of withText) {
      await ctx.db.patch("askCitations", citation._id, { citedText: undefined });
    }

    if (!args.sharedDone) {
      // A shared snapshot keeps the source string only; match on its entity.
      const pattern =
        args.sourceKind === "conversation"
          ? new RegExp(`^fabric:conversation/[^/]+/${args.sourceEntityId}(\\?|$)`)
          : new RegExp(`/${args.sourceKind}/${args.sourceEntityId}(/|$)|^fabric:flow-node/${args.sourceEntityId}/`);
      const shared = await ctx.db
        .query("askSharedExchanges")
        .withIndex("by_clerkOrgId_and_userId", (q) => q.eq("clerkOrgId", args.clerkOrgId))
        .take(SHARED_SCAN);
      for (const exchange of shared) {
        let changed = false;
        const citations = exchange.citations.map((citation) => {
          if (citation.citedText === undefined || !pattern.test(citation.source)) return citation;
          changed = true;
          return { source: citation.source, title: citation.title };
        });
        if (changed) await ctx.db.patch("askSharedExchanges", exchange._id, { citations });
      }
    }

    if (withText.length === CITATION_BATCH) {
      await ctx.scheduler.runAfter(0, internal.askLifecycle.clearCitedTextBatch, { ...args, sharedDone: true });
    }
    return null;
  },
});

export const purgeMemberBatch = internalMutation({
  args: { clerkOrgId: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    const threads = await liveThreadsOf(ctx, args.clerkOrgId, args.userId);
    for (const thread of threads) await retireThread(ctx, thread);

    const suggestions = await ctx.db
      .query("askSuggestions")
      .withIndex("by_clerkOrgId_and_userId", (q) => q.eq("clerkOrgId", args.clerkOrgId).eq("userId", args.userId))
      .take(ROW_BATCH);
    for (const row of suggestions) await ctx.db.delete("askSuggestions", row._id);

    const shared = await ctx.db
      .query("askSharedExchanges")
      .withIndex("by_clerkOrgId_and_userId", (q) => q.eq("clerkOrgId", args.clerkOrgId).eq("userId", args.userId))
      .take(ROW_BATCH);
    for (const row of shared) await ctx.db.delete("askSharedExchanges", row._id);

    if (threads.length + suggestions.length + shared.length > 0) {
      await ctx.scheduler.runAfter(0, internal.askLifecycle.purgeMemberBatch, args);
    }
    return null;
  },
});

export const purgeOrgBatch = internalMutation({
  args: { clerkOrgId: v.string() },
  handler: async (ctx, args) => {
    // The org prefix of the thread index spans every user and status, so
    // threads already `deleting` are skipped here; their own batches remove them.
    const threads = await ctx.db
      .query("askThreads")
      .withIndex("by_clerkOrgId_and_userId_and_status_and_lastMessageAt", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .take(THREAD_BATCH * 4);
    const live = threads.filter((thread) => thread.status !== "deleting").slice(0, THREAD_BATCH);
    for (const thread of live) await retireThread(ctx, thread);

    const suggestions = await ctx.db
      .query("askSuggestions")
      .withIndex("by_clerkOrgId_and_userId", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .take(ROW_BATCH);
    for (const row of suggestions) await ctx.db.delete("askSuggestions", row._id);

    const shared = await ctx.db
      .query("askSharedExchanges")
      .withIndex("by_clerkOrgId_and_userId", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .take(ROW_BATCH);
    for (const row of shared) await ctx.db.delete("askSharedExchanges", row._id);

    if (live.length + suggestions.length + shared.length > 0) {
      await ctx.scheduler.runAfter(0, internal.askLifecycle.purgeOrgBatch, args);
    } else if (threads.length > 0) {
      // Only threads mid-deletion remain; look again once their batches ran.
      await ctx.scheduler.runAfter(5_000, internal.askLifecycle.purgeOrgBatch, args);
    }
    return null;
  },
});

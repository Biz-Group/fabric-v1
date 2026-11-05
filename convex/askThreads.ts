import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrgMember, type OrgContext } from "./lib/orgAuth";
import { userError } from "./lib/userError";

/**
 * AskFabric threads (FR-3). A thread belongs to one user in one org, and every
 * function here checks both; nobody else, admins included, can list, read or
 * change it (D12).
 */

export const MAX_PINNED = 10;
const THREAD_PAGE_SIZE = 25;
const MAX_TITLE_CHARS = 120;
/** Rows deleted per table per batch (FR-3.4). */
const DELETE_BATCH = 100;

/**
 * A thread as the list shows it, with the page it was started from (2B.3).
 * The context's name is read as the viewer each time: an entity since deleted
 * or moved out of the org shows nothing.
 */
async function threadRow(ctx: QueryCtx, orgId: string, thread: Doc<"askThreads">) {
  const context = thread.contextRef ? await ctx.db.get(thread.contextRef.id) : null;
  return {
    _id: thread._id,
    title: thread.title,
    status: thread.status,
    pinnedAt: thread.pinnedAt ?? null,
    lastMessageAt: thread.lastMessageAt,
    context: context && context.clerkOrgId === orgId ? { kind: thread.contextRef!.kind, name: context.name } : null,
  };
}

async function ownThread(ctx: MutationCtx, org: OrgContext, threadId: Id<"askThreads">) {
  const thread = await ctx.db.get(threadId);
  if (!thread || thread.clerkOrgId !== org.orgId || thread.userId !== org.userId || thread.status === "deleting") {
    throw userError("THREAD_NOT_FOUND", "This thread no longer exists.");
  }
  return thread;
}

/** One page of threads, newest activity first (FR-3.2). Pinned threads come from `listPinned`. */
export const listThreads = query({
  args: { paginationOpts: paginationOptsValidator, archived: v.boolean() },
  handler: async (ctx, args) => {
    const org = await requireOrgMember(ctx);
    const result = await ctx.db
      .query("askThreads")
      .withIndex("by_clerkOrgId_and_userId_and_status_and_lastMessageAt", (q) =>
        q.eq("clerkOrgId", org.orgId).eq("userId", org.userId).eq("status", args.archived ? "archived" : "active"),
      )
      .order("desc")
      .paginate({ ...args.paginationOpts, numItems: Math.min(args.paginationOpts.numItems, THREAD_PAGE_SIZE) });
    const page = result.page.filter((t) => args.archived || t.pinnedAt === undefined);
    return { ...result, page: await Promise.all(page.map((t) => threadRow(ctx, org.orgId, t))) };
  },
});

export const listPinned = query({
  args: {},
  handler: async (ctx) => {
    const org = await requireOrgMember(ctx);
    const pinned = await ctx.db
      .query("askThreads")
      .withIndex("by_clerkOrgId_and_userId_and_pinnedAt", (q) =>
        q.eq("clerkOrgId", org.orgId).eq("userId", org.userId).gt("pinnedAt", 0),
      )
      .order("desc")
      .take(MAX_PINNED);
    return await Promise.all(pinned.filter((t) => t.status === "active").map((t) => threadRow(ctx, org.orgId, t)));
  },
});

/** Title search over the caller's own threads (FR-3.5). */
export const searchThreads = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const org = await requireOrgMember(ctx);
    const text = args.query.trim();
    if (!text) return [];
    const hits = await ctx.db
      .query("askThreads")
      .withSearchIndex("search_title", (q) =>
        q.search("title", text).eq("clerkOrgId", org.orgId).eq("userId", org.userId),
      )
      .take(THREAD_PAGE_SIZE);
    return await Promise.all(hits.filter((t) => t.status !== "deleting").map((t) => threadRow(ctx, org.orgId, t)));
  },
});

export const renameThread = mutation({
  args: { threadId: v.id("askThreads"), title: v.string() },
  handler: async (ctx, args) => {
    const org = await requireOrgMember(ctx);
    const thread = await ownThread(ctx, org, args.threadId);
    const title = args.title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
    if (!title) throw userError("EMPTY_TITLE", "Give the thread a name.");
    await ctx.db.patch("askThreads", thread._id, { title });
    return null;
  },
});

export const setPinned = mutation({
  args: { threadId: v.id("askThreads"), pinned: v.boolean() },
  handler: async (ctx, args) => {
    const org = await requireOrgMember(ctx);
    const thread = await ownThread(ctx, org, args.threadId);
    if (!args.pinned) {
      await ctx.db.patch("askThreads", thread._id, { pinnedAt: undefined });
      return null;
    }
    if (thread.pinnedAt !== undefined) return null;
    const pinned = await ctx.db
      .query("askThreads")
      .withIndex("by_clerkOrgId_and_userId_and_pinnedAt", (q) =>
        q.eq("clerkOrgId", org.orgId).eq("userId", org.userId).gt("pinnedAt", 0),
      )
      .take(MAX_PINNED);
    if (pinned.length >= MAX_PINNED) throw userError("TOO_MANY_PINNED", "Unpin a thread first.");
    // Pinning an archived thread brings it back: pins only show among active ones.
    await ctx.db.patch("askThreads", thread._id, { pinnedAt: Date.now(), status: "active" });
    return null;
  },
});

export const setArchived = mutation({
  args: { threadId: v.id("askThreads"), archived: v.boolean() },
  handler: async (ctx, args) => {
    const org = await requireOrgMember(ctx);
    const thread = await ownThread(ctx, org, args.threadId);
    await ctx.db.patch("askThreads", thread._id, {
      status: args.archived ? "archived" : "active",
      ...(args.archived ? { pinnedAt: undefined } : {}),
    });
    return null;
  },
});

/**
 * Deletes a thread for good (FR-3.4). The thread disappears at once
 * (`deleting`); a streaming answer is told to stop (FR-2.12); the rows go in
 * scheduled batches.
 */
export const deleteThread = mutation({
  args: { threadId: v.id("askThreads") },
  handler: async (ctx, args) => {
    const org = await requireOrgMember(ctx);
    const thread = await ownThread(ctx, org, args.threadId);
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
    return null;
  },
});

/**
 * One batch of a thread's rows. Reschedules itself until nothing is left,
 * then removes the thread. A turn can't add citations meanwhile: `finishTurn`
 * is a no-op once the thread is `deleting`, so the last pass is the sweep.
 */
export const deleteThreadBatch = internalMutation({
  args: { threadId: v.id("askThreads") },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.status !== "deleting") return null;
    let removed = 0;
    const speech = await ctx.db
      .query("askSpeech")
      .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
      .take(DELETE_BATCH);
    for (const row of speech) {
      try {
        await ctx.storage.delete(row.storageId);
      } catch {
        // Already gone — fall through and delete the row.
      }
      await ctx.db.delete("askSpeech", row._id);
    }
    removed += speech.length;
    const tables = [
      ["askCitations", "by_threadId"],
      ["askFeedback", "by_threadId"],
      ["askSharedExchanges", "by_threadId"],
      ["askMessages", "by_threadId"],
    ] as const;
    for (const [table, index] of tables) {
      const rows = await ctx.db
        .query(table)
        .withIndex(index, (q) => q.eq("threadId", thread._id))
        .take(DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(table, row._id);
      removed += rows.length;
    }
    if (removed > 0) {
      await ctx.scheduler.runAfter(0, internal.askThreads.deleteThreadBatch, { threadId: thread._id });
      return null;
    }
    await ctx.db.delete("askThreads", thread._id);
    return null;
  },
});

import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  QueryCtx,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import {
  assertOrgOwns,
  isActiveMembership,
  requireOrgAdmin,
  requireOrgMember,
  resolveOrgForAction,
} from "./lib/orgAuth";
import { authError } from "./lib/authErrors";
import { userError } from "./lib/userError";
import { conversationTitle } from "./lib/conversationTitle";

const DEFAULT_COMPACT_CONVERSATION_LIMIT = 50;
const MAX_COMPACT_CONVERSATION_LIMIT = 100;
const MAX_CONVERSATION_PAGE_SIZE = 50;
const DEFAULT_MY_CONVERSATION_LIMIT = 6;
const MAX_MY_CONVERSATION_LIMIT = 50;
// Org-wide rows awaiting labels read to find the caller's own. Labelling is
// a short-lived state, so an org rarely has more than a handful.
const MAX_NEEDS_LABELS_SCAN = 500;
const DEFAULT_SEARCH_LIMIT = 50;
const MAX_SEARCH_LIMIT = 200;
// Processes whose name matches a search bring their contributions along.
const MAX_SEARCH_PROCESSES = 5;

export const listByProcess = query({
  args: { processId: v.id("processes") },
  handler: async (ctx, args) => {
    const caller = await requireOrgMember(ctx);
    const parent = await ctx.db.get(args.processId);
    if (!parent || parent.clerkOrgId !== caller.orgId) return [];
    return await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_processId", (q) =>
        q.eq("clerkOrgId", caller.orgId).eq("processId", args.processId),
      )
      .order("desc")
      .take(200);
  },
});

export const listCompactByProcess = query({
  args: {
    processId: v.id("processes"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const caller = await requireOrgMember(ctx);
    const parent = await ctx.db.get(args.processId);
    if (!parent || parent.clerkOrgId !== caller.orgId) return [];

    const requestedLimit =
      args.limit === undefined
        ? DEFAULT_COMPACT_CONVERSATION_LIMIT
        : Math.floor(args.limit);
    const limit = Math.min(
      Math.max(requestedLimit, 1),
      MAX_COMPACT_CONVERSATION_LIMIT,
    );

    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_processId", (q) =>
        q.eq("clerkOrgId", caller.orgId).eq("processId", args.processId),
      )
      .order("desc")
      .take(limit);

    return rows.map(compactConversation);
  },
});

/** A list row without the transcript, summary or analysis payloads. */
function compactConversation(conversation: Doc<"conversations">) {
  return {
    _id: conversation._id,
    _creationTime: conversation._creationTime,
    processId: conversation.processId,
    contributorName: conversation.contributorName,
    userId: conversation.userId ?? null,
    subjectUserId: conversation.subjectUserId ?? null,
    submittedByName: conversation.submittedByName ?? null,
    inputMode: conversation.inputMode ?? "agent",
    status: conversation.status,
    // Falls back to the analysis blob so rows written before the `title`
    // column existed are still titled by what was discussed.
    title: conversationTitle(conversation) ?? null,
    durationSeconds: conversation.durationSeconds ?? null,
    hasAudio: Boolean(
      conversation.elevenlabsConversationId || conversation.audioStorageId,
    ),
    hasTranscript: Boolean(conversation.transcript?.length),
    hasSummary: Boolean(conversation.summary?.trim()),
    needsSpeakerLabels: conversation.status === "needs_speaker_labels",
  };
}

/**
 * A process's contributions a page at a time, for the Contributions tab. The
 * status filter and sort order run on the index, so every contribution is
 * reachable however old. There is no `inputMode` index (legacy rows have no
 * mode), so the type filter drops rows from each page after reading it; a
 * filtered page can come back short, or empty while more remain.
 */
export const listPageByProcess = query({
  args: {
    processId: v.id("processes"),
    paginationOpts: paginationOptsValidator,
    status: v.optional(
      v.union(
        v.literal("processing"),
        v.literal("needs_speaker_labels"),
        v.literal("done"),
        v.literal("failed"),
      ),
    ),
    inputMode: v.optional(
      v.union(
        v.literal("agent"),
        v.literal("voiceRecord"),
        v.literal("audioUpload"),
      ),
    ),
    order: v.union(v.literal("newest"), v.literal("oldest")),
  },
  handler: async (ctx, args) => {
    const caller = await requireOrgMember(ctx);
    const parent = await ctx.db.get(args.processId);
    if (!parent || parent.clerkOrgId !== caller.orgId) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const paginationOpts = {
      ...args.paginationOpts,
      numItems: Math.min(
        Math.max(Math.floor(args.paginationOpts.numItems), 1),
        MAX_CONVERSATION_PAGE_SIZE,
      ),
    };
    const status = args.status;
    const indexed =
      status === undefined
        ? ctx.db
            .query("conversations")
            .withIndex("by_clerkOrgId_and_processId", (q) =>
              q.eq("clerkOrgId", caller.orgId).eq("processId", args.processId),
            )
        : ctx.db
            .query("conversations")
            .withIndex("by_clerkOrgId_and_processId_and_status", (q) =>
              q
                .eq("clerkOrgId", caller.orgId)
                .eq("processId", args.processId)
                .eq("status", status),
            );
    const result = await indexed
      .order(args.order === "newest" ? "desc" : "asc")
      .paginate(paginationOpts);

    const inputMode = args.inputMode;
    return {
      ...result,
      page: result.page
        .filter(
          (conversation) =>
            inputMode === undefined ||
            (conversation.inputMode ?? "agent") === inputMode,
        )
        .map(compactConversation),
    };
  },
});

/**
 * One contribution with its transcript and summary, for playback. Any member
 * may read it, as with `listByProcess`. Returns null when the row is gone,
 * belongs to another org, or isn't in `processId`, so a stale link shows as
 * unavailable rather than playing something else.
 */
export const getInProcess = query({
  args: {
    processId: v.id("processes"),
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const caller = await requireOrgMember(ctx);
    const conversation = await ctx.db.get(args.conversationId);
    if (
      !conversation ||
      conversation.clerkOrgId !== caller.orgId ||
      conversation.processId !== args.processId
    ) {
      return null;
    }
    return conversation;
  },
});

// Process ids in the caller's org that have at least one conversation awaiting
// speaker labels — the actionable state a contributor can resolve inline. Reads
// the `by_clerkOrgId_and_status` index, so it returns only the (typically few)
// pending rows rather than scanning every conversation. Used to flag rows with
// an "attention" dot in the navigator.
export const processIdsNeedingAttention = query({
  args: {},
  handler: async (ctx): Promise<Id<"processes">[]> => {
    const caller = await requireOrgMember(ctx);
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_status", (q) =>
        q.eq("clerkOrgId", caller.orgId).eq("status", "needs_speaker_labels"),
      )
      .take(500);
    const ids = new Set<Id<"processes">>();
    for (const row of rows) ids.add(row.processId);
    return [...ids];
  },
});

// The caller's own interviews, newest first, for the workspace home. "Own"
// covers both sides of the attribution: rows the caller submitted (their
// self-recordings, legacy rows, and an admin's on-behalf filings) and rows an
// admin filed about them. Each index read is bounded by the limit, so the merge
// reads at most twice that many rows.
export const listMine = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const caller = await requireOrgMember(ctx);
    const requestedLimit =
      args.limit === undefined
        ? DEFAULT_MY_CONVERSATION_LIMIT
        : Math.floor(args.limit);
    const limit = Math.min(
      Math.max(requestedLimit, 1),
      MAX_MY_CONVERSATION_LIMIT,
    );

    const [submitted, aboutCaller] = await Promise.all([
      ctx.db
        .query("conversations")
        .withIndex("by_clerkOrgId_and_userId", (q) =>
          q.eq("clerkOrgId", caller.orgId).eq("userId", caller.userId),
        )
        .order("desc")
        .take(limit),
      ctx.db
        .query("conversations")
        .withIndex("by_clerkOrgId_and_subjectUserId", (q) =>
          q.eq("clerkOrgId", caller.orgId).eq("subjectUserId", caller.userId),
        )
        .order("desc")
        .take(limit),
    ]);

    const byId = new Map<Id<"conversations">, Doc<"conversations">>();
    for (const row of [...submitted, ...aboutCaller]) byId.set(row._id, row);
    const newest = [...byId.values()]
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, limit);

    return await myConversationRows(ctx, caller, newest);
  },
});

/**
 * How many of the caller's own contributions are waiting for speaker labels,
 * and the oldest of them to open first. Home's feed shows only the newest
 * few, so it can't count these itself. Reads the org's (typically few)
 * awaiting rows through the status index and keeps the caller's.
 */
export const myNeedsLabelsSummary = query({
  args: {},
  handler: async (ctx) => {
    const caller = await requireOrgMember(ctx);
    const awaiting = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_status", (q) =>
        q.eq("clerkOrgId", caller.orgId).eq("status", "needs_speaker_labels"),
      )
      .take(MAX_NEEDS_LABELS_SCAN);
    const mine = awaiting.filter(
      (row) =>
        row.userId === caller.userId || row.subjectUserId === caller.userId,
    );
    const [oldest] = await myConversationRows(ctx, caller, mine.slice(0, 1));
    return { count: mine.length, oldest: oldest ?? null };
  },
});

/** Home rows for the caller's conversations, joined with their hierarchy.
 * Rows whose process, department or function is gone or foreign drop out. */
async function myConversationRows(
  ctx: QueryCtx,
  caller: { orgId: string; userId: Id<"users"> },
  conversations: Doc<"conversations">[],
) {
  const processes = new Map<Id<"processes">, Doc<"processes"> | null>();
  const departments = new Map<Id<"departments">, Doc<"departments"> | null>();
  const functions = new Map<Id<"functions">, Doc<"functions"> | null>();
  const rows = [];
  for (const conversation of conversations) {
    if (!processes.has(conversation.processId)) {
      processes.set(
        conversation.processId,
        await ctx.db.get(conversation.processId),
      );
    }
    const process = processes.get(conversation.processId);
    if (!process || process.clerkOrgId !== caller.orgId) continue;

    if (!departments.has(process.departmentId)) {
      departments.set(
        process.departmentId,
        await ctx.db.get(process.departmentId),
      );
    }
    const department = departments.get(process.departmentId);
    if (!department || department.clerkOrgId !== caller.orgId) continue;

    if (!functions.has(department.functionId)) {
      functions.set(
        department.functionId,
        await ctx.db.get(department.functionId),
      );
    }
    const fn = functions.get(department.functionId);
    if (!fn || fn.clerkOrgId !== caller.orgId) continue;

    // Rows the caller filed about someone else carry that person's name;
    // rows filed about the caller carry the submitter's.
    const attribution: "self" | "filedForOther" | "filedForCaller" =
      !conversation.submittedByName
        ? "self"
        : conversation.userId === caller.userId
          ? "filedForOther"
          : "filedForCaller";

    rows.push({
      _id: conversation._id,
      _creationTime: conversation._creationTime,
      status: conversation.status,
      inputMode: conversation.inputMode ?? "agent",
      title: conversationTitle(conversation) ?? null,
      durationSeconds: conversation.durationSeconds ?? null,
      attribution,
      contributorName: conversation.contributorName,
      submittedByName: conversation.submittedByName ?? null,
      processId: process._id,
      processName: process.name,
      departmentId: department._id,
      departmentName: department.name,
      functionId: fn._id,
      functionName: fn.name,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Admin surface — org-wide listing, delete, retry. Every query/mutation/action
// is gated by `requireOrgAdmin` (or equivalent) and filters strictly by
// `caller.orgId` derived from the JWT.
// ---------------------------------------------------------------------------

type ConversationRow = Doc<"conversations"> & {
  processName: string | null;
  departmentId: Id<"departments"> | null;
  departmentName: string | null;
  functionId: Id<"functions"> | null;
  functionName: string | null;
};

/** Joins each admin row with its process, department and function, so the
 * table can name them and link into the process. A join that crosses org
 * boundaries leaves the names blank rather than leaking another tenant's. */
async function withHierarchy(
  ctx: QueryCtx,
  orgId: string,
  conversations: Doc<"conversations">[],
): Promise<ConversationRow[]> {
  const processCache = new Map<Id<"processes">, Doc<"processes"> | null>();
  const departmentCache = new Map<
    Id<"departments">,
    Doc<"departments"> | null
  >();
  const functionCache = new Map<Id<"functions">, Doc<"functions"> | null>();

  return await Promise.all(
    conversations.map(async (conv) => {
      const row: ConversationRow = {
        ...conv,
        processName: null,
        departmentId: null,
        departmentName: null,
        functionId: null,
        functionName: null,
      };

      let process = processCache.get(conv.processId);
      if (process === undefined) {
        process = await ctx.db.get(conv.processId);
        processCache.set(conv.processId, process);
      }
      if (!process || process.clerkOrgId !== orgId) return row;
      row.processName = process.name;

      let department = departmentCache.get(process.departmentId);
      if (department === undefined) {
        department = await ctx.db.get(process.departmentId);
        departmentCache.set(process.departmentId, department);
      }
      if (!department || department.clerkOrgId !== orgId) return row;
      row.departmentId = department._id;
      row.departmentName = department.name;

      let fn = functionCache.get(department.functionId);
      if (fn === undefined) {
        fn = await ctx.db.get(department.functionId);
        functionCache.set(department.functionId, fn);
      }
      if (fn && fn.clerkOrgId === orgId) {
        row.functionId = fn._id;
        row.functionName = fn.name;
      }
      return row;
    }),
  );
}

const conversationStatusArg = v.optional(
  v.union(
    v.literal("processing"),
    v.literal("needs_speaker_labels"),
    v.literal("done"),
    v.literal("failed"),
  ),
);

/**
 * Admin-only. Paginated listing of every conversation in the caller's org,
 * joined with process/department/function names. Optional `status` filter uses
 * the existing `by_clerkOrgId_and_status` index. Optional `processId` filter
 * uses `by_clerkOrgId_and_processId` and assert-owns the process before
 * applying.
 */
export const listAllForOrg = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: conversationStatusArg,
    processId: v.optional(v.id("processes")),
  },
  handler: async (ctx, args) => {
    const caller = await requireOrgAdmin(ctx);

    // If a processId is supplied, assert it belongs to the caller's org first.
    // This prevents a malicious caller from confirming a cross-tenant id exists
    // via an empty result vs. a thrown error — instead we normalize to empty.
    if (args.processId) {
      const process = await ctx.db.get(args.processId);
      if (!process || process.clerkOrgId !== caller.orgId) {
        return { page: [], isDone: true, continueCursor: "" };
      }
    }

    // Pick the narrowest index available given the provided filters.
    const base =
      args.processId !== undefined
        ? ctx.db
            .query("conversations")
            .withIndex("by_clerkOrgId_and_processId", (q) =>
              q.eq("clerkOrgId", caller.orgId).eq("processId", args.processId!),
            )
        : args.status !== undefined
          ? ctx.db
              .query("conversations")
              .withIndex("by_clerkOrgId_and_status", (q) =>
                q.eq("clerkOrgId", caller.orgId).eq("status", args.status!),
              )
          : ctx.db
              .query("conversations")
              .withIndex("by_clerkOrgId", (q) =>
                q.eq("clerkOrgId", caller.orgId),
              );

    // If both processId and status are provided, drop to a post-filter for the
    // remaining dimension.
    const filtered =
      args.processId !== undefined && args.status !== undefined
        ? base.filter((q) => q.eq(q.field("status"), args.status))
        : base;

    const result = await filtered.order("desc").paginate(args.paginationOpts);
    return {
      ...result,
      page: await withHierarchy(ctx, caller.orgId, result.page),
    };
  },
});

/**
 * Admin-only. Searches every contribution in the caller's org, not just the
 * loaded page: by contributor name, title and summary through their search
 * indexes, plus every contribution to a process whose name matches. Search
 * indexes take one field each and can't share a cursor, so this returns the
 * newest `limit` matches across all of them instead of a paginated stream;
 * `truncated` says there were more. Honours the same status and process
 * filters as `listAllForOrg`.
 */
export const searchForOrg = query({
  args: {
    search: v.string(),
    status: conversationStatusArg,
    processId: v.optional(v.id("processes")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const caller = await requireOrgAdmin(ctx);
    const search = args.search.trim();
    const empty = { page: [] as ConversationRow[], truncated: false };
    if (!search) return empty;
    if (args.processId) {
      const process = await ctx.db.get(args.processId);
      if (!process || process.clerkOrgId !== caller.orgId) return empty;
    }
    const limit = Math.min(
      Math.max(Math.floor(args.limit ?? DEFAULT_SEARCH_LIMIT), 1),
      MAX_SEARCH_LIMIT,
    );
    const { status, processId } = args;

    const bySearchIndex = (
      index: "search_contributor" | "search_title" | "search_summary",
      field: "contributorName" | "title" | "summary",
    ) =>
      ctx.db
        .query("conversations")
        .withSearchIndex(index, (q) => {
          let filter = q.search(field, search).eq("clerkOrgId", caller.orgId);
          if (status) filter = filter.eq("status", status);
          if (processId) filter = filter.eq("processId", processId);
          return filter;
        })
        .take(limit + 1);

    const matchingProcesses = processId
      ? []
      : await ctx.db
          .query("processes")
          .withSearchIndex("search_name", (q) =>
            q.search("name", search).eq("clerkOrgId", caller.orgId),
          )
          .take(MAX_SEARCH_PROCESSES);

    const batches = await Promise.all([
      bySearchIndex("search_contributor", "contributorName"),
      bySearchIndex("search_title", "title"),
      bySearchIndex("search_summary", "summary"),
      ...matchingProcesses.map((process) =>
        status
          ? ctx.db
              .query("conversations")
              .withIndex("by_clerkOrgId_and_processId_and_status", (q) =>
                q
                  .eq("clerkOrgId", caller.orgId)
                  .eq("processId", process._id)
                  .eq("status", status),
              )
              .order("desc")
              .take(limit + 1)
          : ctx.db
              .query("conversations")
              .withIndex("by_clerkOrgId_and_processId", (q) =>
                q.eq("clerkOrgId", caller.orgId).eq("processId", process._id),
              )
              .order("desc")
              .take(limit + 1),
      ),
    ]);

    const byId = new Map<Id<"conversations">, Doc<"conversations">>();
    for (const row of batches.flat()) byId.set(row._id, row);
    const newest = [...byId.values()].sort(
      (a, b) => b._creationTime - a._creationTime,
    );
    return {
      page: await withHierarchy(ctx, caller.orgId, newest.slice(0, limit)),
      truncated: newest.length > limit,
    };
  },
});

/**
 * Admin-only. Single-conversation fetch for the transcript viewer. Ownership
 * is enforced via `assertOrgOwns`, which throws "Not found" (never leaks
 * existence) when the conversation belongs to a different org.
 */
export const getForAdmin = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const caller = await requireOrgAdmin(ctx);
    const conv = await ctx.db.get(args.conversationId);
    assertOrgOwns(caller, conv);
    const [row] = await withHierarchy(ctx, caller.orgId, [conv]);
    return row;
  },
});

/**
 * Admin-only. Count conversations for the caller's org — optionally filtered
 * by status and/or a `since` creation timestamp. Used by the overview
 * dashboard's stat cards.
 */
export const countForOrg = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("processing"),
        v.literal("needs_speaker_labels"),
        v.literal("done"),
        v.literal("failed"),
      ),
    ),
    since: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const caller = await requireOrgAdmin(ctx);
    const rows =
      args.status !== undefined
        ? await ctx.db
            .query("conversations")
            .withIndex("by_clerkOrgId_and_status", (q) =>
              q.eq("clerkOrgId", caller.orgId).eq("status", args.status!),
            )
            .collect()
        : await ctx.db
            .query("conversations")
            .withIndex("by_clerkOrgId_and_processId", (q) =>
              q.eq("clerkOrgId", caller.orgId),
            )
            .collect();

    const since = args.since;
    if (since === undefined) return rows.length;
    return rows.filter((r) => r._creationTime >= since).length;
  },
});

/**
 * Admin-only. Deletes a conversation. Re-asserts org ownership even though the
 * caller's admin role is already verified — `assertOrgOwns` is the
 * defense-in-depth layer that prevents a caller from targeting a different
 * org's row by id. After deletion we schedule a full summary rebuild for the
 * parent process so the rolling summary stays consistent.
 */
export const deleteForAdmin = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const caller = await requireOrgAdmin(ctx);
    const conv = await ctx.db.get(args.conversationId);
    assertOrgOwns(caller, conv);

    const processId = conv.processId;
    const deletedDoneConversation = conv.status === "done";
    if (conv.audioStorageId) {
      try {
        await ctx.storage.delete(conv.audioStorageId);
      } catch {
        // Storage may already have been removed by an abandonment/retry path.
        // The conversation row is the access-control source of truth.
      }
    }
    await ctx.db.delete(args.conversationId);

    if (!deletedDoneConversation) return;

    const remainingDone = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_processId_and_status", (q) =>
        q
          .eq("clerkOrgId", caller.orgId)
          .eq("processId", processId)
          .eq("status", "done"),
      )
      .take(1);

    if (remainingDone.length > 0) {
      await ctx.runMutation(internal.processFlows.markFlowStale, {
        processId,
        clerkOrgId: caller.orgId,
        // Unconditional: the flow may cite the interview that just went away,
        // and a count check could miss it if another was added meanwhile.
        trigger: "evidenceChanged",
      });
      const process = await ctx.db.get(processId);
      if (process && process.clerkOrgId === caller.orgId) {
        await ctx.runMutation(
          internal.summariesHelpers.markDepartmentSummaryStale,
          { departmentId: process.departmentId },
        );
      }
      // Stale, not rebuilt. The deleted conversation may have contributed
      // citations, so the overview needs regenerating — but bulk-deleting test
      // recordings is exactly when an automatic rebuild per deletion would burn
      // the most tokens for the least value. The summary keeps citing the
      // removed conversation until a contributor rebuilds; its source chip
      // resolves against loaded conversations and fails safe.
      await ctx.runMutation(internal.summaryEvidence.markProcessSummaryStale, {
        processId,
        clerkOrgId: caller.orgId,
      });
      return;
    }

    const process = await ctx.db.get(processId);
    if (!process || process.clerkOrgId !== caller.orgId) return;

    await ctx.db.patch(processId, {
      rollingSummary: undefined,
      summaryV2: undefined,
      summaryUpdatedAt: undefined,
      summaryEvidenceRevision: (process.summaryEvidenceRevision ?? 0) + 1,
      ...(process.summaryV2GenerationId
        ? { summaryRegenRequestedAgain: true }
        : {}),
    });
    await ctx.runMutation(internal.processFlows.deleteForProcess, {
      processId,
      clerkOrgId: caller.orgId,
    });

    const department = await ctx.db.get(process.departmentId);
    if (!department || department.clerkOrgId !== caller.orgId) return;

    const siblingProcesses = await ctx.db
      .query("processes")
      .withIndex("by_clerkOrgId_and_departmentId", (q) =>
        q
          .eq("clerkOrgId", caller.orgId)
          .eq("departmentId", process.departmentId),
      )
      .take(1000);
    const hasSummaries = siblingProcesses.some((p) => p.rollingSummary);
    if (hasSummaries) {
      await ctx.runMutation(
        internal.summariesHelpers.markDepartmentSummaryStale,
        {
          departmentId: process.departmentId,
        },
      );
    } else {
      await ctx.db.patch(process.departmentId, {
        summary: undefined,
        summaryV2: undefined,
        summaryUpdatedAt: undefined,
        summaryStale: undefined,
        summarySourceRevision: (department.summarySourceRevision ?? 0) + 1,
        ...(department.summaryV2GenerationId
          ? { summaryRegenRequestedAgain: true }
          : {}),
      });
      await ctx.runMutation(
        internal.summariesHelpers.markFunctionSummaryStale,
        {
          functionId: department.functionId,
        },
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Retry flow for failed conversations.
// ---------------------------------------------------------------------------

/** Internal. Loads a failed conversation for retry — verifies admin and
 * ownership, returns the fields needed to re-trigger the fetch. */
export const getFailedForRetry = internalQuery({
  args: {
    conversationId: v.id("conversations"),
    orgId: v.string(),
    callerTokenIdentifier: v.string(),
  },
  handler: async (ctx, args) => {
    const callerMembership = await ctx.db
      .query("memberships")
      .withIndex("by_tokenIdentifier_and_clerkOrgId", (q) =>
        q
          .eq("tokenIdentifier", args.callerTokenIdentifier)
          .eq("clerkOrgId", args.orgId),
      )
      .unique();
    if (
      !isActiveMembership(callerMembership) ||
      callerMembership.role !== "admin"
    ) {
      throw authError("INSUFFICIENT_ROLE", "Insufficient permissions");
    }

    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.clerkOrgId !== args.orgId) {
      throw userError("NOT_FOUND", "Not found. It may already have been deleted.");
    }
    if (conv.status !== "failed") {
      throw userError(
        "NOT_RETRYABLE",
        "Only failed contributions can be retried.",
      );
    }
    if (
      (conv.inputMode ?? "agent") !== "agent" ||
      !conv.elevenlabsConversationId
    ) {
      throw userError(
        "NOT_RETRYABLE",
        "Only failed AI interviews can be retried this way.",
      );
    }

    return {
      conversationId: conv._id,
      processId: conv.processId,
      elevenlabsConversationId: conv.elevenlabsConversationId,
      // Carry the original on-behalf-of attribution across the retry. The retry
      // deletes and re-inserts the row, so without this the contributor would
      // be re-derived from the retrying admin's account and the interview would
      // be silently reattributed to them.
      wasOnBehalf: Boolean(conv.submittedByName),
      contributorName: conv.submittedByName ? conv.contributorName : undefined,
      subjectUserId: conv.submittedByName ? conv.subjectUserId : undefined,
    };
  },
});

/** Internal. Deletes the failed row so the retry can insert a fresh one. */
export const deleteFailedRow = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    orgId: v.string(),
  },
  handler: async (ctx, args) => {
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.clerkOrgId !== args.orgId) {
      throw new Error("Not found");
    }
    if (conv.status !== "failed") {
      throw new Error("Only failed conversations can be retried");
    }
    await ctx.db.delete(args.conversationId);
  },
});

/**
 * Admin-only. Retries fetching a failed conversation from ElevenLabs.
 * Implementation: verify admin + ownership → delete the stale failed row →
 * call the existing `fetchConversation` action, which handles the polling,
 * insert, and summary rebuild end-to-end.
 */
type FetchResult = { status: "done" | "failed" | "processing" | "timeout" };

export const retryFetch = action({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args): Promise<FetchResult> => {
    const { orgId, tokenIdentifier } = await resolveOrgForAction(ctx);
    const target = await ctx.runQuery(
      internal.conversations.getFailedForRetry,
      {
        conversationId: args.conversationId,
        orgId,
        callerTokenIdentifier: tokenIdentifier,
      },
    );

    // Delete the failed placeholder so fetchConversation can insert a fresh
    // row. The internal cleanup inherits the admin + ownership checks from
    // `getFailedForRetry` and re-validates org ownership before deleting.
    await ctx.runMutation(internal.conversations.deleteFailedRow, {
      conversationId: target.conversationId,
      orgId,
    });

    // Re-trigger the normal fetch pipeline. fetchConversation re-reads auth and
    // validates the caller is at least a contributor in the active org — which
    // admins already are.
    return (await ctx.runAction(api.postCall.fetchConversation, {
      elevenlabsConversationId: target.elevenlabsConversationId,
      processId: target.processId,
      contributorName: target.contributorName,
      subjectUserId: target.subjectUserId,
      // The original submitter already attested; a retry re-files an existing
      // record rather than making a fresh consent decision. The new row's
      // `submittedByName` becomes the retrying admin, which is accurate — theirs
      // is the account that re-filed it.
      consentAttested: target.wasOnBehalf ? true : undefined,
    })) as FetchResult;
  },
});

import { v, type Infer } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  ASKFABRIC_OPERATIONS,
  ASKFABRIC_PROVIDER,
  askFabricAvailability,
  readAskFabricConfig,
  type AskFabricConfig,
} from "./lib/askFabricFeature";
import {
  askEntityRefValidator,
  askErrorReasonValidator,
  askMessagePartValidator,
  askToolTelemetryValidator,
  askTurnQualityValidator,
  askTurnUsageValidator,
  type AskMessagePart,
} from "./lib/askSchema";
import { authErrorCode } from "./lib/authErrors";
import {
  gulfDayStart,
  hasStreamingAnswer,
  orgQuestionsToday,
  readAskDailyLimits,
  userQuestionsToday,
} from "./lib/askLimits";
import { meteredStream, type UsageAttribution } from "./lib/aiUsageMeter";
import { orgViewerValidator, requireOrgMember, requireOrgViewer } from "./lib/orgAuth";
import { readableSummaryV2 } from "./lib/summaryV2Feature";
import { userError } from "./lib/userError";
import { ASK_TOOLS } from "./askTools/catalog";
import { isoDate } from "./askTools/results";
import { loadHierarchy } from "./askTools/scope";
import {
  buildHistoryMessages,
  buildTableOfContents,
  displayNote,
  userTurnMessage,
  type HistoryTurn,
  type TocFunction,
  type TurnContext,
} from "./askfabric/context";
import { citationChecker, citationPathResolver } from "./askfabric/citationAccess";
import { runTurnLoop } from "./askfabric/loop";
import { AskModelError, askModelClientFor } from "./askfabric/modelClient";
import {
  FOLLOW_UP_COUNT,
  FOLLOW_UP_MAX_TOKENS,
  FOLLOW_UP_SYSTEM_PROMPT,
  followUpPrompt,
  parseFollowUps,
} from "./askfabric/followUps";
import { ASK_SYSTEM_PROMPT, ASK_SYSTEM_PROMPT_VERSION } from "./askfabric/systemPrompt";

const unavailableReasonValidator = v.union(
  v.literal("switchOff"),
  v.literal("missingConfig"),
  v.literal("invalidConfig"),
);

/** Long enough for pasted strategy notes (D30), short of a document. */
export const MAX_QUESTION_CHARS = 8_000;
const MAX_MENTIONS = 10;
/** Messages read per thread when assembling a turn or showing a thread. */
const MAX_THREAD_MESSAGES = 400;
/** A turn still streaming after this is marked unfinished (FR-2.11). */
export const WATCHDOG_AFTER_MS = 5 * 60_000;

type EntityRef = Infer<typeof askEntityRefValidator>;

/**
 * Whether AskFabric is available in the caller's active org (FR-9.6). Members
 * see only "unavailable"; admins also get the reason, which `/admin` shows.
 */
export const getAvailability = query({
  args: {},
  returns: v.object({
    available: v.boolean(),
    reason: v.union(unavailableReasonValidator, v.null()),
  }),
  handler: async (ctx) => {
    // The shell asks on every page; losing access mid-visit must hide the
    // item, not throw into the layout (the workspace layout handles access).
    let org;
    try {
      org = await requireOrgMember(ctx);
    } catch {
      return { available: false, reason: null };
    }
    const availability = askFabricAvailability(org.orgId);
    if (availability.available) return { available: true, reason: null };
    return {
      available: false,
      reason: org.role === "admin" ? availability.reason : null,
    };
  },
});

// ---- References ------------------------------------------------------------------

/**
 * A client-sent reference, checked against the viewer's org (FR-4.2). Invalid
 * references come back null and are dropped silently, never shown to the model.
 */
async function resolveRef(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  ref: EntityRef,
): Promise<{ ref: EntityRef; name: string } | null> {
  const doc = await ctx.db.get(ref.id as Id<"functions">);
  if (!doc || (doc as { clerkOrgId?: string }).clerkOrgId !== orgId) return null;
  return { ref, name: (doc as { name: string }).name };
}

/** The question's first 60 characters, cut at a word: the title until the model's (FR-2.10). */
export function fallbackTitle(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= 60) return flat;
  const cut = flat.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

async function latestMessage(ctx: QueryCtx | MutationCtx, threadId: Id<"askThreads">) {
  return await ctx.db
    .query("askMessages")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .order("desc")
    .first();
}

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Refuses a question over the beta limits (D51). Checked after the thread
 * checks, so a missing thread or a busy one reads as that, not as a limit.
 */
async function enforceBetaLimits(ctx: MutationCtx, orgId: string, userId: Id<"users">, now: number) {
  if (await hasStreamingAnswer(ctx, orgId, userId)) {
    throw userError("ANSWER_IN_PROGRESS", "Wait for your other answer to finish, or stop it.");
  }
  const limits = readAskDailyLimits();
  if (limits.user !== null && (await userQuestionsToday(ctx, orgId, userId, now, limits.user)) >= limits.user) {
    throw userError(
      "DAILY_LIMIT_REACHED",
      `AskFabric is in beta, with ${limits.user} questions per person per day. You can ask again after midnight Gulf time.`,
    );
  }
  if (limits.org !== null && (await orgQuestionsToday(ctx, orgId, now, limits.org)) >= limits.org) {
    throw userError(
      "ORG_DAILY_LIMIT_REACHED",
      `Your workspace has used today's ${limits.org} AskFabric beta questions. You can ask again after midnight Gulf time.`,
    );
  }
}

// ---- Public API -----------------------------------------------------------------

/**
 * The member's beta allowance for today (D51), for the composer. Null where
 * AskFabric is unavailable. `remaining` is null with no per-member limit.
 */
export const getDailyAllowance = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      limit: v.union(v.number(), v.null()),
      remaining: v.union(v.number(), v.null()),
      orgLimitReached: v.boolean(),
      resetsAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    let org;
    try {
      org = await requireOrgMember(ctx);
    } catch {
      return null;
    }
    if (!askFabricAvailability(org.orgId).available) return null;
    const now = Date.now();
    const limits = readAskDailyLimits();
    const used = limits.user === null ? 0 : await userQuestionsToday(ctx, org.orgId, org.userId, now, limits.user);
    const orgUsed = limits.org === null ? 0 : await orgQuestionsToday(ctx, org.orgId, now, limits.org);
    return {
      limit: limits.user,
      remaining: limits.user === null ? null : Math.max(0, limits.user - used),
      orgLimitReached: limits.org !== null && orgUsed >= limits.org,
      resetsAt: gulfDayStart(now) + DAY_MS,
    };
  },
});

/**
 * Asks a question (FR-2.1). One transaction resolves the viewer, checks the
 * switch, creates or validates the thread, inserts the question and a
 * streaming answer, and schedules the turn with the server-resolved viewer.
 */
export const sendMessage = mutation({
  args: {
    threadId: v.optional(v.id("askThreads")),
    text: v.string(),
    contextRef: v.optional(askEntityRefValidator),
    mentions: v.optional(v.array(askEntityRefValidator)),
  },
  handler: async (ctx, args) => {
    const org = await requireOrgMember(ctx);
    const config = readAskFabricConfig();
    if (!askFabricAvailability(org.orgId).available || !config.ok) {
      throw userError("ASKFABRIC_UNAVAILABLE", "AskFabric is unavailable.");
    }
    const text = args.text.trim();
    if (!text) throw userError("EMPTY_QUESTION", "Type a question first.");
    if (text.length > MAX_QUESTION_CHARS) {
      throw userError("QUESTION_TOO_LONG", `Questions can be up to ${MAX_QUESTION_CHARS.toLocaleString("en")} characters.`);
    }

    const contextRef = args.contextRef ? await resolveRef(ctx, org.orgId, args.contextRef) : null;
    const mentions: EntityRef[] = [];
    for (const mention of (args.mentions ?? []).slice(0, MAX_MENTIONS)) {
      if (mentions.some((m) => m.id === mention.id)) continue;
      if (await resolveRef(ctx, org.orgId, mention)) mentions.push(mention);
    }

    const now = Date.now();
    let threadId: Id<"askThreads">;
    if (args.threadId) {
      const thread = await ctx.db.get(args.threadId);
      if (!thread || thread.clerkOrgId !== org.orgId || thread.userId !== org.userId || thread.status === "deleting") {
        throw userError("THREAD_NOT_FOUND", "This thread no longer exists.");
      }
      // One active turn per thread (FR-2.2).
      if ((await latestMessage(ctx, thread._id))?.status === "streaming") {
        throw userError("TURN_IN_PROGRESS", "Wait for the current answer to finish, or stop it.");
      }
      await enforceBetaLimits(ctx, org.orgId, org.userId, now);
      threadId = thread._id;
      await ctx.db.patch("askThreads", threadId, { lastMessageAt: now, status: "active" });
    } else {
      await enforceBetaLimits(ctx, org.orgId, org.userId, now);
      threadId = await ctx.db.insert("askThreads", {
        clerkOrgId: org.orgId,
        userId: org.userId,
        title: fallbackTitle(text),
        status: "active",
        lastMessageAt: now,
        ...(contextRef ? { contextRef: contextRef.ref } : {}),
      });
    }

    await ctx.db.insert("askMessages", {
      threadId,
      clerkOrgId: org.orgId,
      userId: org.userId,
      role: "user",
      parts: [{ type: "text", text }],
      ...(contextRef ? { contextRef: contextRef.ref } : {}),
      ...(mentions.length ? { mentions } : {}),
    });
    const assistantMessageId = await ctx.db.insert("askMessages", {
      threadId,
      clerkOrgId: org.orgId,
      userId: org.userId,
      role: "assistant",
      parts: [],
      status: "streaming",
      promptVersion: ASK_SYSTEM_PROMPT_VERSION,
      model: config.config.meteredModel,
    });
    await ctx.scheduler.runAfter(0, internal.ask.runTurn, {
      threadId,
      assistantMessageId,
      viewer: { tokenIdentifier: org.tokenIdentifier, orgId: org.orgId },
    });
    return { threadId, assistantMessageId };
  },
});

/** Stops a streaming answer (FR-2.4). The turn keeps its partial text. */
export const stopTurn = mutation({
  args: { messageId: v.id("askMessages") },
  handler: async (ctx, args) => {
    const org = await requireOrgMember(ctx);
    const message = await ctx.db.get(args.messageId);
    if (!message || message.clerkOrgId !== org.orgId || message.userId !== org.userId) {
      throw userError("MESSAGE_NOT_FOUND", "This answer no longer exists.");
    }
    if (message.status === "streaming") {
      await ctx.db.patch("askMessages", message._id, { cancelRequested: true });
    }
    return null;
  },
});

/**
 * A thread's messages and citations, for its owner only (FR-3.1): any other
 * member, org admin or platform admin gets null, as for a missing thread.
 */
export const getThread = query({
  args: { threadId: v.id("askThreads") },
  handler: async (ctx, args) => {
    const org = await requireOrgMember(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.clerkOrgId !== org.orgId || thread.userId !== org.userId || thread.status === "deleting") {
      return null;
    }
    const messages = await ctx.db
      .query("askMessages")
      .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
      .take(MAX_THREAD_MESSAGES);
    // Re-authorized on every read (FR-5.5): access may have changed since.
    const availability = citationChecker(ctx, org.orgId, org.role);
    const pathOf = citationPathResolver(ctx, org.orgId);
    const withCitations = [];
    for (const message of messages) {
      const citations =
        message.role === "assistant"
          ? await ctx.db
              .query("askCitations")
              .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
              .take(200)
          : [];
      const feedback =
        message.role === "assistant"
          ? await ctx.db
              .query("askFeedback")
              .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
              .first()
          : null;
      const shared =
        feedback?.rating === "down"
          ? await ctx.db
              .query("askSharedExchanges")
              .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
              .first()
          : null;
      withCitations.push({
        _id: message._id,
        feedback: feedback ? { rating: feedback.rating, shared: shared !== null } : null,
        _creationTime: message._creationTime,
        role: message.role,
        parts: message.parts,
        status: message.status ?? null,
        errorReason: message.errorReason ?? null,
        completedAt: message.completedAt ?? null,
        followUps: message.followUps ?? null,
        citations: await Promise.all(
          citations
            .sort((a, b) => a.ordinal - b.ordinal)
            .map(async (c) => {
              const state = await availability(c.source);
              return {
                ordinal: c.ordinal,
                source: c.source,
                sourceKind: c.sourceKind,
                availability: state,
                path: state === "unavailable" ? { fn: null, dept: null, proc: null } : await pathOf(c.source),
                // Withheld when the viewer can no longer open the source.
                title: state === "unavailable" ? "Source no longer available" : c.title,
                citedText: state === "unavailable" ? null : (c.citedText ?? null),
              };
            }),
        ),
      });
    }
    return {
      _id: thread._id,
      title: thread.title,
      status: thread.status,
      pinnedAt: thread.pinnedAt ?? null,
      messages: withCitations,
    };
  },
});

// ---- Turn internals -------------------------------------------------------------

function messageText(message: Doc<"askMessages">): string {
  return message.parts
    .filter((part): part is Extract<AskMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

/**
 * Everything a turn needs, read as the viewer (FR-2.6). Throws the access
 * error when the viewer is no longer a member, which ends the turn.
 */
export const loadTurnContext = internalQuery({
  args: {
    threadId: v.id("askThreads"),
    assistantMessageId: v.id("askMessages"),
    viewer: orgViewerValidator,
  },
  handler: async (ctx, args) => {
    const viewer = await requireOrgViewer(ctx, args.viewer);
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.clerkOrgId !== viewer.orgId || thread.userId !== viewer.user._id || thread.status === "deleting") {
      return null;
    }
    const messages = await ctx.db
      .query("askMessages")
      .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
      .take(MAX_THREAD_MESSAGES);
    const index = messages.findIndex((m) => m._id === args.assistantMessageId);
    const question = index > 0 ? messages[index - 1] : null;
    if (!question || question.role !== "user") return null;

    const names = async (refs: EntityRef[] | undefined) => {
      const resolved = [];
      for (const ref of refs ?? []) {
        const found = await resolveRef(ctx, viewer.orgId, ref);
        if (found) resolved.push({ kind: ref.kind, id: ref.id as string, name: found.name });
      }
      return resolved;
    };

    // Earlier turns: each user message with the answer that followed it.
    const history: HistoryTurn[] = [];
    for (let i = 0; i < index - 1; i++) {
      const message = messages[i];
      if (message.role !== "user") continue;
      const answer = messages[i + 1]?.role === "assistant" ? messages[i + 1] : null;
      const mentioned = await names(message.mentions);
      const shown: string[] = [];
      for (const part of answer?.parts ?? []) {
        if (part.type !== "display") continue;
        const note = displayNote(part, (await names(part.refs)).map((ref) => `${ref.name} [${ref.id}]`));
        if (note) shown.push(note);
      }
      history.push({
        user: `${messageText(message)}${mentioned.length ? `\n(Mentioned: ${mentioned.map((m) => `${m.kind} "${m.name}" [${m.id}]`).join(", ")})` : ""}`,
        assistant: answer ? messageText(answer) || null : null,
        ...(shown.length ? { shown } : {}),
      });
    }

    const hierarchy = await loadHierarchy(ctx, viewer.orgId);
    const toc: TocFunction[] = hierarchy.functions.map((fn) => ({
      id: fn._id,
      name: fn.name,
      departments: hierarchy.departments
        .filter((dept) => dept.functionId === fn._id)
        .map((dept) => ({
          id: dept._id,
          name: dept.name,
          processes: hierarchy.processes
            .filter((process) => process.departmentId === dept._id)
            .map((process) => {
              const overview = readableSummaryV2(process.clerkOrgId, process.summaryV2);
              return {
                id: process._id,
                name: process.name,
                headline: overview?.headline ?? null,
                generatedAt: overview?.provenance.generatedAt ?? null,
              };
            }),
        })),
    }));

    const placementDept = viewer.membership.departmentId
      ? hierarchy.departmentById.get(viewer.membership.departmentId)
      : undefined;
    const contextRef = question.contextRef ? (await names([question.contextRef]))[0] ?? null : null;
    const turnContext: TurnContext = {
      today: isoDate(Date.now())!,
      role: viewer.role,
      placement: placementDept
        ? {
            department: placementDept.name,
            function: hierarchy.functionById.get(placementDept.functionId)?.name ?? "Unknown",
          }
        : null,
      contextRef,
      mentions: await names(question.mentions),
    };

    return {
      userId: viewer.user._id,
      toc: buildTableOfContents(toc),
      history,
      question: messageText(question),
      turnContext,
      isFirstTurn: index === 1,
    };
  },
});

/** The stop flag, also raised by deletion (FR-2.12). */
export const isCancelled = internalQuery({
  args: { assistantMessageId: v.id("askMessages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.assistantMessageId);
    if (!message || message.status !== "streaming") return true;
    if (message.cancelRequested) return true;
    const thread = await ctx.db.get(message.threadId);
    return !thread || thread.status === "deleting";
  },
});

/** Progress patch; a no-op once the thread is being deleted (FR-2.12). */
export const writeProgress = internalMutation({
  args: { assistantMessageId: v.id("askMessages"), parts: v.array(askMessagePartValidator) },
  handler: async (ctx, args): Promise<"ok" | "deleting"> => {
    const message = await ctx.db.get(args.assistantMessageId);
    if (!message) return "deleting";
    const thread = await ctx.db.get(message.threadId);
    if (!thread || thread.status === "deleting") return "deleting";
    if (message.status !== "streaming") return "ok";
    await ctx.db.patch("askMessages", message._id, { parts: args.parts });
    return "ok";
  },
});

const citationValidator = v.object({
  ordinal: v.number(),
  source: v.string(),
  sourceKind: v.union(
    v.literal("function"),
    v.literal("department"),
    v.literal("process"),
    v.literal("conversation"),
    v.literal("org"),
    v.literal("help"),
  ),
  sourceEntityId: v.string(),
  title: v.string(),
  citedText: v.string(),
});

/** Ends a turn: final parts, status, metadata and citations in one write. */
export const finishTurn = internalMutation({
  args: {
    assistantMessageId: v.id("askMessages"),
    status: v.union(v.literal("complete"), v.literal("stopped"), v.literal("error")),
    errorReason: v.optional(askErrorReasonValidator),
    parts: v.array(askMessagePartValidator),
    usage: askTurnUsageValidator,
    toolTelemetry: v.array(askToolTelemetryValidator),
    quality: askTurnQualityValidator,
    citations: v.array(citationValidator),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.assistantMessageId);
    if (!message || message.status !== "streaming") return null;
    const thread = await ctx.db.get(message.threadId);
    if (!thread || thread.status === "deleting") return null;
    const now = Date.now();
    await ctx.db.patch("askMessages", message._id, {
      status: args.status,
      ...(args.errorReason ? { errorReason: args.errorReason } : {}),
      parts: args.parts,
      usage: args.usage,
      toolTelemetry: args.toolTelemetry,
      quality: args.quality,
      completedAt: now,
      cancelRequested: false,
      // The turn writes suggestions next; this keeps the page from asking twice.
      ...(args.status === "complete" ? { followUpsRequestedAt: now } : {}),
    });
    for (const citation of args.citations) {
      await ctx.db.insert("askCitations", {
        messageId: message._id,
        threadId: message.threadId,
        clerkOrgId: message.clerkOrgId,
        userId: message.userId,
        ...citation,
      });
    }
    await ctx.db.patch("askThreads", thread._id, { lastMessageAt: now });
    return null;
  },
});

export const setThreadTitle = internalMutation({
  args: { threadId: v.id("askThreads"), title: v.string() },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.status === "deleting") return null;
    await ctx.db.patch("askThreads", thread._id, { title: args.title });
    return null;
  },
});

/** A missing set is asked for again only after this, in case a call failed. */
const FOLLOW_UP_RETRY_MS = 2 * 60 * 1_000;

/**
 * What a follow-up call needs, or null when the answer shouldn't get one:
 * only the owner's latest answer, complete and without a set yet. Source
 * titles are re-checked, so a source the viewer can no longer open isn't
 * named in a suggestion.
 */
export const loadFollowUpContext = internalQuery({
  args: { assistantMessageId: v.id("askMessages"), viewer: orgViewerValidator },
  handler: async (ctx, args) => {
    const viewer = await requireOrgViewer(ctx, args.viewer);
    const message = await ctx.db.get(args.assistantMessageId);
    if (!message || message.role !== "assistant" || message.status !== "complete" || message.followUps !== undefined) {
      return null;
    }
    const thread = await ctx.db.get(message.threadId);
    if (!thread || thread.clerkOrgId !== viewer.orgId || thread.userId !== viewer.user._id || thread.status === "deleting") {
      return null;
    }
    const messages = await ctx.db
      .query("askMessages")
      .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
      .take(MAX_THREAD_MESSAGES);
    const index = messages.findIndex((m) => m._id === message._id);
    const question = index > 0 ? messages[index - 1] : null;
    if (index !== messages.length - 1 || !question || question.role !== "user") return null;
    const answer = messageText(message);
    if (!answer) return null;

    const availability = citationChecker(ctx, viewer.orgId, viewer.role);
    const citations = await ctx.db
      .query("askCitations")
      .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
      .take(200);
    const sources: string[] = [];
    for (const citation of citations) {
      if ((await availability(citation.source)) !== "unavailable") sources.push(citation.title);
    }
    return {
      threadId: thread._id,
      userId: viewer.user._id,
      question: messageText(question),
      answer,
      sources,
      asked: messages.filter((m) => m.role === "user").map(messageText),
    };
  },
});

export const setFollowUps = internalMutation({
  args: { assistantMessageId: v.id("askMessages"), followUps: v.array(v.string()) },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.assistantMessageId);
    if (!message || message.status !== "complete" || message.followUps !== undefined) return null;
    const thread = await ctx.db.get(message.threadId);
    if (!thread || thread.status === "deleting") return null;
    await ctx.db.patch("askMessages", message._id, { followUps: args.followUps.slice(0, FOLLOW_UP_COUNT) });
    return null;
  },
});

/**
 * Writes suggested follow-ups for an answer (one metered call). Never throws:
 * a failed call leaves the set unset, and reopening the thread asks again.
 */
async function generateFollowUps(
  ctx: ActionCtx,
  config: AskFabricConfig,
  assistantMessageId: Id<"askMessages">,
  viewer: Infer<typeof orgViewerValidator>,
): Promise<void> {
  try {
    const input = await ctx.runQuery(internal.ask.loadFollowUpContext, { assistantMessageId, viewer });
    if (!input) return;
    const model = askModelClientFor(config);
    const attribution: UsageAttribution = {
      clerkOrgId: viewer.orgId,
      entityType: "askThread",
      entityId: input.threadId,
      actorUserId: input.userId,
      runId: assistantMessageId,
    };
    const final = await meteredStream(
      ctx,
      attribution,
      {
        operation: ASKFABRIC_OPERATIONS.followUps,
        provider: ASKFABRIC_PROVIDER,
        model: config.meteredModel,
        providerDeployment: config.deployment,
        stepIndex: 0,
        partialUsage: (error: unknown) => (error instanceof AskModelError ? error.partialUsage : undefined),
      },
      async () => {
        const result = await model.complete({
          system: FOLLOW_UP_SYSTEM_PROMPT,
          user: followUpPrompt(input),
          maxTokens: FOLLOW_UP_MAX_TOKENS,
        });
        return { ...result, finishReason: result.stopReason };
      },
    );
    const raw = final.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
    await ctx.runMutation(internal.ask.setFollowUps, {
      assistantMessageId,
      followUps: parseFollowUps(raw, input.asked),
    });
  } catch (error) {
    console.warn("AskFabric follow-ups call failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

export const fillFollowUps = internalAction({
  args: { assistantMessageId: v.id("askMessages"), viewer: orgViewerValidator },
  handler: async (ctx, args) => {
    const config = readAskFabricConfig();
    if (!config.ok) return null;
    await generateFollowUps(ctx, config.config, args.assistantMessageId, args.viewer);
    return null;
  },
});

/**
 * Asks for suggestions on a thread's latest answer when it has none: answers
 * from before suggestions existed get them the first time their thread is
 * opened. A no-op while a call for it may still be running.
 */
export const requestFollowUps = mutation({
  args: { messageId: v.id("askMessages") },
  handler: async (ctx, args) => {
    const org = await requireOrgMember(ctx);
    const message = await ctx.db.get(args.messageId);
    // Anyone but the owner gets not-found, as for Stop (FR-3.1).
    if (!message || message.clerkOrgId !== org.orgId || message.userId !== org.userId) {
      throw userError("MESSAGE_NOT_FOUND", "This answer no longer exists.");
    }
    if (!askFabricAvailability(org.orgId).available) return null;
    if (message.role !== "assistant" || message.status !== "complete" || message.followUps !== undefined) return null;
    const now = Date.now();
    if (message.followUpsRequestedAt !== undefined && now - message.followUpsRequestedAt < FOLLOW_UP_RETRY_MS) return null;
    const thread = await ctx.db.get(message.threadId);
    if (!thread || thread.status === "deleting") return null;
    const latest = await ctx.db
      .query("askMessages")
      .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
      .order("desc")
      .first();
    if (latest?._id !== message._id) return null;
    await ctx.db.patch("askMessages", message._id, { followUpsRequestedAt: now });
    await ctx.scheduler.runAfter(0, internal.ask.fillFollowUps, {
      assistantMessageId: message._id,
      viewer: { tokenIdentifier: org.tokenIdentifier, orgId: org.orgId },
    });
    return null;
  },
});

/** FR-2.11: unlocks any thread whose answer is still streaming after 5 minutes. */
export const markStaleTurns = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - WATCHDOG_AFTER_MS;
    const stale = await ctx.db
      .query("askMessages")
      .withIndex("by_status", (q) => q.eq("status", "streaming").lt("_creationTime", cutoff))
      .take(100);
    for (const message of stale) {
      await ctx.db.patch("askMessages", message._id, {
        status: "error",
        errorReason: "unfinished",
        cancelRequested: false,
        completedAt: Date.now(),
      });
    }
    return stale.length;
  },
});

/** Six words or fewer, no quotes or trailing punctuation. */
export function cleanTitle(raw: string): string | null {
  const words = raw.replace(/["“”'`*#]/g, "").replace(/[.!?:;,\s]+$/, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return words.slice(0, 6).join(" ").slice(0, 60);
}

type TurnArgs = {
  threadId: Id<"askThreads">;
  assistantMessageId: Id<"askMessages">;
  viewer: Infer<typeof orgViewerValidator>;
};

export type TurnOptions = {
  config: AskFabricConfig;
  /** The ledger operation for the turn's model calls (FR-8.1). */
  operation: string;
  /** Title the thread after its first complete answer (FR-2.10). */
  title: boolean;
  /** Suggest follow-up questions after a complete answer. */
  followUps?: boolean;
};

/**
 * One turn's work (FR-2.1–2.5), shared by `runTurn` and the eval harness
 * (FR-10.5a), so an eval measures exactly what users get. It acts as
 * `args.viewer`, and every tool re-resolves them.
 */
export async function executeTurn(ctx: ActionCtx, args: TurnArgs, options: TurnOptions): Promise<null> {
  const { config } = options;
  const empty = {
    parts: [] as AskMessagePart[],
    usage: { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cacheWriteTokens: 0 },
    toolTelemetry: [],
    citations: [],
    quality: { modelCalls: 0, toolCalls: 0, citations: 0, zeroCitations: true, durationMs: 0, stopReason: "error" as const },
  };
  const fail = async (errorReason: "modelError" | "accessLost") => {
    await ctx.runMutation(internal.ask.finishTurn, {
      assistantMessageId: args.assistantMessageId,
      status: "error",
      errorReason,
      ...empty,
    });
    return null;
  };

  let context;
  try {
    context = await ctx.runQuery(internal.ask.loadTurnContext, args);
  } catch (error) {
    const code = authErrorCode(error);
    if (!code) {
      console.error("AskFabric turn context failed", {
        errorType: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : undefined,
      });
    }
    return await fail(code ? "accessLost" : "modelError");
  }
  if (!context) return null;

  const model = askModelClientFor(config);
  const attribution: UsageAttribution = {
    clerkOrgId: args.viewer.orgId,
    entityType: "askThread",
    entityId: args.threadId,
    actorUserId: context.userId,
    runId: args.assistantMessageId,
  };
  const meta = (operation: string, stepIndex: number) => ({
    operation,
    provider: ASKFABRIC_PROVIDER,
    model: config.meteredModel,
    providerDeployment: config.deployment,
    stepIndex,
    partialUsage: (error: unknown) => (error instanceof AskModelError ? error.partialUsage : undefined),
  });

  const outcome = await runTurnLoop(
    {
      model,
      tools: ASK_TOOLS,
      runTool: (tool, input) => ctx.runQuery(tool.executorRef, { viewer: args.viewer, ...input }),
      meter: (stepIndex, run) => meteredStream(ctx, attribution, meta(options.operation, stepIndex), run),
      write: (parts) => ctx.runMutation(internal.ask.writeProgress, { assistantMessageId: args.assistantMessageId, parts }),
      isCancelled: () => ctx.runQuery(internal.ask.isCancelled, { assistantMessageId: args.assistantMessageId }),
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
    {
      system: [
        { type: "text", text: ASK_SYSTEM_PROMPT },
        // The breakpoint caches tools, system prompt and table of contents.
        { type: "text", text: context.toc, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        ...buildHistoryMessages(context.history),
        userTurnMessage(context.turnContext, context.question),
      ],
    },
  );
  if (outcome.status === "deleted") return null;
  if (outcome.diagnostic) {
    console.error("AskFabric turn failed", { errorReason: outcome.errorReason, ...outcome.diagnostic });
  }

  await ctx.runMutation(internal.ask.finishTurn, {
    assistantMessageId: args.assistantMessageId,
    status: outcome.status,
    ...(outcome.errorReason ? { errorReason: outcome.errorReason } : {}),
    parts: outcome.parts,
    usage: outcome.usage,
    toolTelemetry: outcome.telemetry,
    quality: outcome.quality,
    citations: outcome.citations.map((c) => ({
      ordinal: c.ordinal,
      source: c.source,
      sourceKind: c.parsed.sourceKind,
      sourceEntityId: c.parsed.sourceEntityId,
      title: c.title,
      citedText: c.citedText,
    })),
  });

  // Suggestions first: they show under the answer, the title only in the list.
  if (options.followUps && outcome.status === "complete") {
    await generateFollowUps(ctx, config, args.assistantMessageId, args.viewer);
  }

  // FR-2.10: a short title after the first complete answer. The fallback
  // title (the question's start) stays if this fails.
  if (options.title && outcome.status === "complete" && context.isFirstTurn) {
    try {
      const final = await meteredStream(ctx, attribution, meta(ASKFABRIC_OPERATIONS.title, 0), async () => {
        const result = await model.complete({
          system: "You write titles for chat threads. Reply with a title of six words or fewer, nothing else.",
          user: `Question: ${context.question.slice(0, 1_000)}`,
          maxTokens: 30,
        });
        return { ...result, finishReason: result.stopReason };
      });
      const raw = final.content.find((b) => b.type === "text") as { text?: string } | undefined;
      const title = cleanTitle(raw?.text ?? "");
      if (title) await ctx.runMutation(internal.ask.setThreadTitle, { threadId: args.threadId, title });
    } catch (error) {
      console.warn("AskFabric title call failed", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  return null;
}

/**
 * Runs one turn. Scheduled, so it has no auth identity: it acts as the viewer
 * `sendMessage` resolved.
 */
export const runTurn = internalAction({
  args: {
    threadId: v.id("askThreads"),
    assistantMessageId: v.id("askMessages"),
    viewer: orgViewerValidator,
  },
  handler: async (ctx, args) => {
    // Fail closed: configuration can change between sendMessage and here.
    const config = readAskFabricConfig();
    if (!config.ok) {
      await ctx.runMutation(internal.ask.finishTurn, {
        assistantMessageId: args.assistantMessageId,
        status: "error",
        errorReason: "modelError",
        parts: [],
        usage: { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cacheWriteTokens: 0 },
        toolTelemetry: [],
        citations: [],
        quality: { modelCalls: 0, toolCalls: 0, citations: 0, zeroCitations: true, durationMs: 0, stopReason: "error" },
      });
      return null;
    }
    return await executeTurn(ctx, args, {
      config: config.config,
      operation: ASKFABRIC_OPERATIONS.turn,
      title: true,
      followUps: true,
    });
  },
});

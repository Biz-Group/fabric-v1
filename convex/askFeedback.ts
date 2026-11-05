import { v } from "convex/values";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { AskMessagePart } from "./lib/askSchema";
import { requireOrgMember, type OrgContext } from "./lib/orgAuth";
import { userError } from "./lib/userError";

/**
 * Feedback on answers and opt-in sharing with the Fabric team (FR-7). The
 * rating is binary and content-free, so admins can count it (FR-8.3); a
 * shared exchange holds content and only the Fabric team can read it (FR-7.3).
 */

export const SHARE_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const MAX_NOTE_CHARS = 1_000;
const EXPIRE_BATCH = 200;

async function ownAnswer(ctx: MutationCtx, org: OrgContext, messageId: Id<"askMessages">) {
  const message = await ctx.db.get(messageId);
  if (!message || message.clerkOrgId !== org.orgId || message.userId !== org.userId || message.role !== "assistant") {
    throw userError("MESSAGE_NOT_FOUND", "This answer no longer exists.");
  }
  const thread = await ctx.db.get(message.threadId);
  if (!thread || thread.status === "deleting") throw userError("MESSAGE_NOT_FOUND", "This answer no longer exists.");
  return message;
}

async function sharedFor(ctx: MutationCtx, messageId: Id<"askMessages">) {
  return await ctx.db
    .query("askSharedExchanges")
    .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
    .take(10);
}

async function unshare(ctx: MutationCtx, messageId: Id<"askMessages">) {
  for (const row of await sharedFor(ctx, messageId)) await ctx.db.delete("askSharedExchanges", row._id);
}

/** Thumbs up or down, or null to clear (FR-7.1). Thumbs-up also unshares (FR-7.2). */
export const setFeedback = mutation({
  args: { messageId: v.id("askMessages"), rating: v.union(v.literal("up"), v.literal("down"), v.null()) },
  handler: async (ctx, args) => {
    const org = await requireOrgMember(ctx);
    const message = await ownAnswer(ctx, org, args.messageId);
    const existing = await ctx.db
      .query("askFeedback")
      .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
      .first();
    if (args.rating === null) {
      if (existing) await ctx.db.delete("askFeedback", existing._id);
    } else if (existing) {
      await ctx.db.patch("askFeedback", existing._id, { rating: args.rating });
    } else {
      await ctx.db.insert("askFeedback", {
        messageId: message._id,
        threadId: message.threadId,
        clerkOrgId: message.clerkOrgId,
        userId: message.userId,
        rating: args.rating,
      });
    }
    if (args.rating !== "down") await unshare(ctx, message._id);
    return null;
  },
});

function partsText(parts: AskMessagePart[], type: "text" | "reasoning"): string[] {
  return parts.flatMap((part) => (part.type === type ? [part.text] : []));
}

/**
 * Copies the exchange for the Fabric team, after the user ticked the box on a
 * thumbs-down (FR-7.2): question, answer, reasoning summaries, citations with
 * the text they quoted, and the tool calls made. No raw tool results: they
 * never outlive the turn (FR-9.7). Tool inputs aren't stored anywhere, so
 * each call is described by its trace label.
 */
export const shareExchange = mutation({
  args: { messageId: v.id("askMessages"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const org = await requireOrgMember(ctx);
    const message = await ownAnswer(ctx, org, args.messageId);
    const feedback = await ctx.db
      .query("askFeedback")
      .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
      .first();
    if (feedback?.rating !== "down") {
      throw userError("NOT_DOWNVOTED", "Only an answer you marked unhelpful can be shared.");
    }

    const recent = await ctx.db
      .query("askMessages")
      .withIndex("by_threadId", (q) => q.eq("threadId", message.threadId).lt("_creationTime", message._creationTime))
      .order("desc")
      .first();
    const question = recent?.role === "user" ? partsText(recent.parts, "text").join("\n") : "";
    const citations = await ctx.db
      .query("askCitations")
      .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
      .take(200);
    const toolParts = message.parts.filter(
      (part): part is Extract<AskMessagePart, { type: "tool" }> => part.type === "tool",
    );
    // Telemetry is recorded as calls finish, not in trace order: pair each
    // trace step with the next unused entry for the same tool.
    const telemetry = [...(message.toolTelemetry ?? [])];
    const toolCalls = toolParts.map((part) => {
      const index = telemetry.findIndex((entry) => entry.name === part.name);
      const entry = index === -1 ? undefined : telemetry.splice(index, 1)[0];
      return {
        name: part.name,
        input: part.label,
        found: entry?.found ?? false,
        resultTokens: entry?.resultTokens ?? 0,
      };
    });

    const note = args.note?.trim().slice(0, MAX_NOTE_CHARS);
    const now = Date.now();
    await unshare(ctx, message._id);
    await ctx.db.insert("askSharedExchanges", {
      clerkOrgId: message.clerkOrgId,
      userId: message.userId,
      threadId: message.threadId,
      messageId: message._id,
      question,
      answer: partsText(message.parts, "text").join("\n\n"),
      reasoning: partsText(message.parts, "reasoning"),
      citations: citations
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((c: Doc<"askCitations">) => ({
          source: c.source,
          title: c.title,
          ...(c.citedText !== undefined ? { citedText: c.citedText } : {}),
        })),
      toolCalls,
      displays: message.parts.flatMap((part) =>
        part.type === "display" ? [{ display: part.display, count: part.refs.length }] : [],
      ),
      ...(note ? { note } : {}),
      sharedAt: now,
      expiresAt: now + SHARE_RETENTION_MS,
    });
    return null;
  },
});

export const unshareExchange = mutation({
  args: { messageId: v.id("askMessages") },
  handler: async (ctx, args) => {
    const org = await requireOrgMember(ctx);
    const message = await ownAnswer(ctx, org, args.messageId);
    await unshare(ctx, message._id);
    return null;
  },
});

/** FR-7.4: a daily cron deletes shared exchanges 90 days after sharing. */
export const expireSharedExchanges = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("askSharedExchanges")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", Date.now()))
      .take(EXPIRE_BATCH);
    for (const row of expired) await ctx.db.delete("askSharedExchanges", row._id);
    return expired.length;
  },
});

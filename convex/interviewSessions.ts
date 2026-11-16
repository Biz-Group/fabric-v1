import { v } from "convex/values";
import { action, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrgContributor, requireOrgMember } from "./lib/orgAuth";
import { userError } from "./lib/userError";
import {
  buildElevenLabsConversationTokenUrl,
  buildElevenLabsConversationUrl,
  isElevenLabsConversationId,
} from "./lib/elevenLabsConversation";
import { INTERVIEW_OPEN_WINDOW_MS, takeInterviewQuota } from "./lib/interviewLimits";

/**
 * Starting an AI interview (docs/security-hardening-task-list.md, Phase 3).
 *
 * The browser used to start ElevenLabs sessions with the public agent ID, so
 * anyone who copied it could run interviews on Fabric's account. Now Fabric
 * checks the member, the process, the daily caps and "one open interview at a
 * time", then fetches a short-lived conversation token with the server-side
 * key. The token's conversation id is recorded, and `postCall.fetchConversation`
 * only imports conversations issued to the caller (or, for admins, to anyone
 * in their workspace).
 */

async function latestOpenSession(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  userId: Id<"users">,
  now: number,
): Promise<Doc<"interviewSessions"> | null> {
  const recent = await ctx.db
    .query("interviewSessions")
    .withIndex("by_clerkOrgId_and_userId_and_issuedAt", (q) =>
      q.eq("clerkOrgId", orgId).eq("userId", userId).gt("issuedAt", now - INTERVIEW_OPEN_WINDOW_MS),
    )
    .order("desc")
    .take(20);
  return recent.find((session) => session.status === "issued") ?? null;
}

/** The caller's interview that may still be running, if any. */
export const openSessionForCaller = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args): Promise<OpenSession | null> => {
    const caller = await requireOrgContributor(ctx);
    const open = await latestOpenSession(ctx, caller.orgId, caller.userId, args.now);
    return open
      ? { sessionId: open._id, elevenlabsConversationId: open.elevenlabsConversationId ?? null, issuedAt: open.issuedAt }
      : null;
  },
});

type OpenSession = {
  sessionId: Id<"interviewSessions">;
  elevenlabsConversationId: string | null;
  issuedAt: number;
};

/** Marks a session closed: its interview ended, never started, or failed to start. */
export const expireSession = internalMutation({
  args: { sessionId: v.id("interviewSessions") },
  handler: async (ctx, args): Promise<null> => {
    const session = await ctx.db.get(args.sessionId);
    if (session?.status === "issued") await ctx.db.patch("interviewSessions", session._id, { status: "expired" });
    return null;
  },
});

const LIMIT_MESSAGES = {
  user: "You've reached today's limit for AI interviews. Try again tomorrow.",
  org: "Your workspace has reached today's limit for AI interviews. Try again tomorrow.",
} as const;

/**
 * Authorises one interview for the caller: contributor role, the process in
 * their workspace, nothing else open, and within both daily caps. All in one
 * transaction, so two parallel starts can't both slip under a cap.
 */
export const issueSession = internalMutation({
  args: { processId: v.id("processes") },
  handler: async (ctx, args): Promise<Id<"interviewSessions">> => {
    const caller = await requireOrgContributor(ctx);
    const process = await ctx.db.get(args.processId);
    if (!process || process.clerkOrgId !== caller.orgId) {
      throw userError("PROCESS_NOT_FOUND", "This process no longer exists.");
    }
    const now = Date.now();
    if (await latestOpenSession(ctx, caller.orgId, caller.userId, now)) {
      throw userError(
        "INTERVIEW_ALREADY_OPEN",
        "You already have an AI interview open. Finish or close it, then try again in a minute.",
      );
    }
    const quota = await takeInterviewQuota(ctx, { orgId: caller.orgId, userId: caller.userId });
    if (!quota.ok) throw userError("INTERVIEW_LIMIT_REACHED", LIMIT_MESSAGES[quota.scope]);
    return await ctx.db.insert("interviewSessions", {
      clerkOrgId: caller.orgId,
      userId: caller.userId,
      processId: args.processId,
      status: "issued",
      issuedAt: now,
    });
  },
});

export const attachConversation = internalMutation({
  args: { sessionId: v.id("interviewSessions"), elevenlabsConversationId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch("interviewSessions", args.sessionId, { elevenlabsConversationId: args.elevenlabsConversationId });
    return null;
  },
});

/**
 * A session this new always counts as open, whatever ElevenLabs says: a token
 * that hasn't connected yet is unknown there (404, checked on dev 2026-11-16),
 * so without this a script could fetch tokens back to back, each closing the
 * last, and then connect them all at once. Long enough to connect; short
 * enough that a member whose microphone was refused can retry within a minute.
 */
export const NEW_SESSION_GRACE_MS = 60_000;

/** ElevenLabs says the conversation is running. */
async function isLiveAtElevenLabs(apiKey: string, conversationId: string): Promise<boolean> {
  if (!isElevenLabsConversationId(conversationId)) return false;
  try {
    const response = await fetch(buildElevenLabsConversationUrl(conversationId), {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    // Not found: the token was never used, so nothing is running.
    if (response.status === 404) return false;
    // Can't tell (outage, rate limit): assume it may be live rather than
    // letting a failed lookup open a second session.
    if (!response.ok) return true;
    const data = (await response.json()) as { status?: unknown };
    return data.status === "in-progress" || data.status === "initiated";
  } catch {
    return true;
  }
}

/**
 * Called by the recording modal instead of starting ElevenLabs with the agent
 * ID. Returns a conversation token for `startSession({ conversationToken })`.
 */
export const startInterview = action({
  args: { processId: v.id("processes") },
  handler: async (ctx, args): Promise<{ conversationToken: string }> => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const agentId = process.env.ELEVENLABS_AGENT_ID;
    if (!apiKey || !agentId) {
      throw userError("INTERVIEW_UNAVAILABLE", "AI interviews aren't available right now.");
    }

    // A session the member left open (closed tab, crashed browser) shouldn't
    // block them for the agent's full maximum: ask ElevenLabs whether it is
    // actually running, and close it here if not.
    const open: OpenSession | null = await ctx.runQuery(internal.interviewSessions.openSessionForCaller, {
      now: Date.now(),
    });
    if (
      open &&
      Date.now() - open.issuedAt >= NEW_SESSION_GRACE_MS &&
      !(open.elevenlabsConversationId && (await isLiveAtElevenLabs(apiKey, open.elevenlabsConversationId)))
    ) {
      await ctx.runMutation(internal.interviewSessions.expireSession, { sessionId: open.sessionId });
    }

    const sessionId: Id<"interviewSessions"> = await ctx.runMutation(internal.interviewSessions.issueSession, {
      processId: args.processId,
    });

    let body: { token?: unknown; conversation_id?: unknown };
    try {
      const response = await fetch(buildElevenLabsConversationTokenUrl(agentId), {
        headers: { "xi-api-key": apiKey },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        console.error("ElevenLabs conversation token refused", { status: response.status });
        throw new Error(`token_http_${response.status}`);
      }
      body = (await response.json()) as typeof body;
    } catch (error) {
      await ctx.runMutation(internal.interviewSessions.expireSession, { sessionId });
      console.error("Couldn't start interview", { errorType: error instanceof Error ? error.message : "unknown" });
      throw userError("INTERVIEW_START_FAILED", "Couldn't start the interview. Please try again.");
    }
    if (typeof body.token !== "string" || !body.token) {
      await ctx.runMutation(internal.interviewSessions.expireSession, { sessionId });
      throw userError("INTERVIEW_START_FAILED", "Couldn't start the interview. Please try again.");
    }
    if (typeof body.conversation_id === "string" && isElevenLabsConversationId(body.conversation_id)) {
      await ctx.runMutation(internal.interviewSessions.attachConversation, {
        sessionId,
        elevenlabsConversationId: body.conversation_id,
      });
    } else {
      // Import binding needs it; flag loudly rather than fail the interview.
      console.error("ElevenLabs conversation token came without a conversation id");
    }
    return { conversationToken: body.token };
  },
});

/**
 * Whether the caller may import this ElevenLabs conversation: Fabric issued
 * it in their workspace, to them, or the caller is an admin there (on-behalf
 * submissions and retries of someone else's failed import).
 */
export const isIssuedToCaller = internalQuery({
  args: { elevenlabsConversationId: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const caller = await requireOrgMember(ctx);
    const sessions = await ctx.db
      .query("interviewSessions")
      .withIndex("by_elevenlabsConversationId", (q) => q.eq("elevenlabsConversationId", args.elevenlabsConversationId))
      .take(5);
    return sessions.some(
      (session) =>
        session.clerkOrgId === caller.orgId && (session.userId === caller.userId || caller.role === "admin"),
    );
  },
});


import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { executeTurn } from "./ask";
import { ASK_TOOLS } from "./askTools/catalog";
import { citationChecker } from "./askfabric/citationAccess";
import { askModelClientFor } from "./askfabric/modelClient";
import { ASK_SYSTEM_PROMPT_VERSION } from "./askfabric/systemPrompt";
import {
  casePasses,
  deterministicChecks,
  expectedSourceCoverage,
  goldenCaseValidator,
  JUDGE_SYSTEM,
  judgePrompt,
  parseJudgeReply,
  type EvalCheck,
  type EvalCitation,
  type EvalTurn,
  type JudgeVerdict,
} from "./askfabric/evalChecks";
import { isoDate } from "./askTools/results";
import { ASKFABRIC_OPERATIONS, ASKFABRIC_PROVIDER, readAskFabricEvalConfig } from "./lib/askFabricFeature";
import { priceTokenUsage } from "./lib/aiPricing";
import { meteredStream } from "./lib/aiUsageMeter";
import type { AskMessagePart } from "./lib/askSchema";
import { userError } from "./lib/userError";

/**
 * The AskFabric eval harness's Convex half (FR-10.5a); `scripts/eval-askfabric.mjs`
 * drives it. Dev only: every entry point resolves its deployment through
 * `readAskFabricEvalConfig`, which refuses prod and any unlisted deployment.
 *
 * Turns run through `executeTurn`, the same code as `ask.runTurn`, as fixed
 * eval members of the org, and skip the beta limits (they never go through
 * `sendMessage`). Each case's thread is deleted after grading; its usage rows
 * stay, metered as `askfabric.eval` and `askfabric.judge`.
 */

const roleValidator = v.union(v.literal("viewer"), v.literal("contributor"), v.literal("admin"));
const effortValidator = v.union(v.literal("low"), v.literal("medium"), v.literal("high"));
const JUDGE_MAX_TOKENS = 8_000;

/** The answer's text, with citation markers as the [n] the judge reads. */
function answerText(parts: AskMessagePart[]): string {
  return parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n")
    .replace(/\[\[cite:(\d+)\]\]/g, "[$1]");
}

function evalConfigOrThrow(deployment: string, effort?: "low" | "medium" | "high") {
  const result = readAskFabricEvalConfig(deployment, effort);
  if (!result.ok) throw userError("EVAL_REFUSED", result.reason);
  return result.config;
}

/** The fixed eval member for a role, created on first use. */
export const ensureEvalMember = internalMutation({
  args: { clerkOrgId: v.string(), role: roleValidator },
  returns: v.object({ tokenIdentifier: v.string(), userId: v.id("users") }),
  handler: async (ctx, args) => {
    const tokenIdentifier = `askfabric-eval|${args.role}`;
    const name = `AskFabric Eval (${args.role})`;
    const email = `askfabric-eval+${args.role}@fabric.invalid`;
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", tokenIdentifier))
      .unique();
    const userId = user?._id ?? (await ctx.db.insert("users", { tokenIdentifier, name, email, profileComplete: true }));
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_tokenIdentifier_and_clerkOrgId", (q) => q.eq("tokenIdentifier", tokenIdentifier).eq("clerkOrgId", args.clerkOrgId))
      .unique();
    if (!membership) {
      await ctx.db.insert("memberships", {
        tokenIdentifier,
        userId,
        clerkOrgId: args.clerkOrgId,
        role: args.role,
        createdAt: Date.now(),
        name,
        email,
        emailLower: email,
      });
    } else if (membership.role !== args.role || membership.removedAt !== undefined || membership.status === "removed") {
      await ctx.db.patch("memberships", membership._id, { role: args.role, removedAt: undefined, status: undefined });
    }
    return { tokenIdentifier, userId };
  },
});

/** Inserts a question and its streaming answer, as `sendMessage` does. */
export const startEvalTurn = internalMutation({
  args: {
    clerkOrgId: v.string(),
    userId: v.id("users"),
    threadId: v.optional(v.id("askThreads")),
    text: v.string(),
    model: v.string(),
  },
  returns: v.object({ threadId: v.id("askThreads"), assistantMessageId: v.id("askMessages") }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let threadId: Id<"askThreads">;
    if (args.threadId) {
      threadId = args.threadId;
      await ctx.db.patch("askThreads", threadId, { lastMessageAt: now });
    } else {
      threadId = await ctx.db.insert("askThreads", {
        clerkOrgId: args.clerkOrgId,
        userId: args.userId,
        title: `[eval] ${args.text.slice(0, 50)}`,
        status: "active",
        lastMessageAt: now,
      });
    }
    await ctx.db.insert("askMessages", {
      threadId,
      clerkOrgId: args.clerkOrgId,
      userId: args.userId,
      role: "user",
      parts: [{ type: "text", text: args.text }],
    });
    const assistantMessageId = await ctx.db.insert("askMessages", {
      threadId,
      clerkOrgId: args.clerkOrgId,
      userId: args.userId,
      role: "assistant",
      parts: [],
      status: "streaming",
      promptVersion: ASK_SYSTEM_PROMPT_VERSION,
      model: args.model,
    });
    return { threadId, assistantMessageId };
  },
});

type EvalTurnResult = {
  status: string;
  errorReason: string | null;
  text: string;
  citations: EvalCitation[];
  usage: Doc<"askMessages">["usage"] | null;
  toolTelemetry: NonNullable<Doc<"askMessages">["toolTelemetry"]>;
  quality: Doc<"askMessages">["quality"] | null;
  model: string | null;
};

type CaseTurnResult = EvalTurnResult & {
  threadId: Id<"askThreads">;
  assistantMessageId: Id<"askMessages">;
  wallMs: number;
  costMicroUsd: number | null;
};

type GradeResult = {
  checks: EvalCheck[];
  expectedSources: { type: string; cited: boolean }[];
  verdict: JudgeVerdict | null;
  judgeError: string | null;
  judgeCostMicroUsd: number | null;
  pass: boolean;
};

/** One finished turn as the grader sees it, citations re-checked for the role. */
export const evalTurnResult = internalQuery({
  args: { assistantMessageId: v.id("askMessages"), role: roleValidator },
  handler: async (ctx, args): Promise<EvalTurnResult> => {
    const message = await ctx.db.get(args.assistantMessageId);
    if (!message) throw new Error("Eval answer not found");
    const availability = citationChecker(ctx, message.clerkOrgId, args.role);
    const rows = await ctx.db
      .query("askCitations")
      .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
      .take(200);
    const citations = [];
    for (const row of rows) {
      citations.push({
        ordinal: row.ordinal,
        source: row.source,
        title: row.title,
        citedText: row.citedText ?? null,
        availability: await availability(row.source),
      });
    }
    return {
      status: message.status ?? "complete",
      errorReason: message.errorReason ?? null,
      text: answerText(message.parts),
      citations,
      usage: message.usage ?? null,
      toolTelemetry: message.toolTelemetry ?? [],
      quality: message.quality ?? null,
      model: message.model ?? null,
    };
  },
});

/** Runs one user turn of a case on the eval deployment, and reports it. */
export const runCaseTurn = internalAction({
  args: {
    clerkOrgId: v.string(),
    deployment: v.string(),
    effort: v.optional(effortValidator),
    role: roleValidator,
    text: v.string(),
    threadId: v.optional(v.id("askThreads")),
  },
  handler: async (ctx, args): Promise<CaseTurnResult> => {
    const config = evalConfigOrThrow(args.deployment, args.effort);
    const member: { tokenIdentifier: string; userId: Id<"users"> } = await ctx.runMutation(internal.askEval.ensureEvalMember, { clerkOrgId: args.clerkOrgId, role: args.role });
    const ids: { threadId: Id<"askThreads">; assistantMessageId: Id<"askMessages"> } = await ctx.runMutation(internal.askEval.startEvalTurn, {
      clerkOrgId: args.clerkOrgId,
      userId: member.userId,
      text: args.text,
      model: config.meteredModel,
      ...(args.threadId ? { threadId: args.threadId } : {}),
    });
    const startedAt = Date.now();
    await executeTurn(
      ctx,
      { ...ids, viewer: { tokenIdentifier: member.tokenIdentifier, orgId: args.clerkOrgId } },
      { config, operation: ASKFABRIC_OPERATIONS.eval, title: false },
    );
    const wallMs = Date.now() - startedAt;
    const result: EvalTurnResult = await ctx.runQuery(internal.askEval.evalTurnResult, {
      assistantMessageId: ids.assistantMessageId,
      role: args.role,
    });
    const cost = result.usage ? priceTokenUsage(ASKFABRIC_PROVIDER, config.meteredModel, result.usage) : null;
    return { ...ids, wallMs, costMicroUsd: cost?.costMicroUsd ?? null, ...result };
  },
});

/**
 * Grades a case from its stored answers: the deterministic checks, then the
 * blinded judge (FR-10.3). The judge never sees the thought trace.
 */
export const gradeCase = internalAction({
  args: {
    case: goldenCaseValidator,
    assistantMessageIds: v.array(v.id("askMessages")),
    judgeDeployment: v.string(),
  },
  handler: async (ctx, args): Promise<GradeResult> => {
    const config = evalConfigOrThrow(args.judgeDeployment, "medium");
    const turns: EvalTurn[] = [];
    let clerkOrgId = "";
    for (const assistantMessageId of args.assistantMessageIds) {
      const result: EvalTurnResult = await ctx.runQuery(internal.askEval.evalTurnResult, { assistantMessageId, role: args.case.role });
      turns.push({
        status: result.status,
        text: result.text,
        citations: result.citations,
        toolCalls: result.quality?.toolCalls ?? 0,
        tools: result.toolTelemetry.map((entry) => ({ name: entry.name, resultTokens: entry.resultTokens })),
      });
      const orgOf: string | null = await ctx.runQuery(internal.askEval.messageOrg, { assistantMessageId });
      clerkOrgId ||= orgOf ?? "";
    }
    const budgets = new Map(ASK_TOOLS.map((tool) => [tool.telemetryName, tool.budgetTokens]));
    const checks = deterministicChecks(args.case, turns, budgets);

    let verdict: JudgeVerdict | null = null;
    let judgeError: string | null = null;
    let judgeCostMicroUsd: number | null = null;
    if (turns.length > 0 && turns[turns.length - 1].status === "complete") {
      const model = askModelClientFor(config);
      try {
        const final = await meteredStream(
          ctx,
          { clerkOrgId, entityType: "askEval", entityId: args.case.id, runId: args.assistantMessageIds[0] },
          {
            operation: ASKFABRIC_OPERATIONS.judge,
            provider: ASKFABRIC_PROVIDER,
            model: config.meteredModel,
            providerDeployment: config.deployment,
            stepIndex: 0,
          },
          async () => {
            const result = await model.complete({
              system: JUDGE_SYSTEM,
              // Graded straight after the run, so today is the date the turns saw.
              user: judgePrompt(args.case, turns, isoDate(Date.now())!),
              maxTokens: JUDGE_MAX_TOKENS,
              reasoning: true,
            });
            return { ...result, finishReason: result.stopReason };
          },
        );
        judgeCostMicroUsd = priceTokenUsage(ASKFABRIC_PROVIDER, config.meteredModel, final.usage).costMicroUsd;
        const text = final.content.flatMap((block) => (block.type === "text" ? [(block as { text: string }).text] : [])).join("");
        verdict = parseJudgeReply(text);
      } catch (error) {
        judgeError = error instanceof Error ? error.message : String(error);
      }
    } else {
      judgeError = "Not judged: the case didn't finish.";
    }

    return {
      checks,
      expectedSources: expectedSourceCoverage(args.case, turns),
      verdict,
      judgeError,
      judgeCostMicroUsd,
      pass: casePasses(checks, verdict),
    };
  },
});

export const messageOrg = internalQuery({
  args: { assistantMessageId: v.id("askMessages") },
  handler: async (ctx, args): Promise<string | null> => (await ctx.db.get(args.assistantMessageId))?.clerkOrgId ?? null,
});

/** Deletes a case's thread once graded; usage rows stay. */
export const cleanupCase = internalMutation({
  args: { threadId: v.id("askThreads") },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || !thread.title.startsWith("[eval]")) return null;
    await ctx.db.patch("askThreads", thread._id, { status: "deleting", pinnedAt: undefined });
    await ctx.scheduler.runAfter(0, internal.askThreads.deleteThreadBatch, { threadId: thread._id });
    return null;
  },
});

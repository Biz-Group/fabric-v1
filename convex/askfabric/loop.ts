import type { AskDisplayKind, AskToolName } from "../lib/askSchema";
import { authErrorCode } from "../lib/authErrors";
import { isTokenLimitFinishReason } from "../lib/aiProvider";
import type { StreamedCallResult } from "../lib/aiUsageMeter";
import type { AskDisplayResult } from "../askTools/display";
import { isHierarchyKind, parseFabricSource, type AskToolResult } from "../askTools/results";
import { toApiTools, type RegisteredAskTool } from "../askTools/registry";
import {
  AskModelError,
  type AskContentBlock,
  type AskFinalMessage,
  type AskModelClient,
  type AskModelRequest,
} from "./modelClient";
import { TurnParts, answerFromBlocks, stepText, type AnswerCitation } from "./parts";
import type { AskMessagePart } from "../lib/askSchema";

/**
 * The AskFabric tool loop (FR-2.3–2.5, FR-2.9), free of Convex so it runs
 * against a scripted model in tests. `ask.runTurn` supplies the real
 * dependencies.
 */

export const MAX_MODEL_CALLS = 8;
/** Whole-turn deadline (FR-2.5). The watchdog (5 min) stays above it. */
export const TURN_DEADLINE_MS = 240_000;
/** A call started with less than this left runs with tools off. */
export const TOOLS_OFF_MARGIN_MS = 30_000;
/** Progress patches are at most this frequent, plus one at every tool boundary. */
export const PATCH_INTERVAL_MS = 250;
/** How often the stop flag is polled during a stream (FR-2.4). */
export const CANCEL_POLL_MS = 1_000;
/** Components per answer (D56), of which at most one picker. */
export const MAX_DISPLAYS = 3;
/** Appended to a display's acknowledgement when no answer text exists yet. */
export const ANSWER_STILL_DUE =
  "You haven't written your answer yet. Write it now in full, citing every claim as usual: the component sits under your answer and replaces none of it, so don't refer to it.";
/** The same, for a picker: the question is due, not an answer. */
export const QUESTION_STILL_DUE =
  "Now write one short sentence asking which one the user means, and nothing else: don't answer until they choose.";

export type ErrorReason =
  | "modelError"
  | "busy"
  | "refusal"
  | "truncated"
  | "accessLost"
  | "deadline";

export type ToolTelemetry = {
  name: AskToolName;
  latencyMs: number;
  found: boolean;
  resultTokens: number;
  truncated: boolean;
};

export type TurnUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cacheWriteTokens: number;
};

export type TurnOutcome = {
  status: "complete" | "stopped" | "error" | "deleted";
  errorReason?: ErrorReason;
  /** For logs only, never stored: what failed, from the provider's response. */
  diagnostic?: { name: string; status?: number; message: string };
  parts: AskMessagePart[];
  citations: AnswerCitation[];
  usage: TurnUsage;
  telemetry: ToolTelemetry[];
  quality: {
    modelCalls: number;
    toolCalls: number;
    citations: number;
    zeroCitations: boolean;
    durationMs: number;
    firstVisibleMs?: number;
    stopReason: "end_turn" | "max_tokens" | "refusal" | "stepCap" | "stopped" | "error";
  };
};

export type TurnDeps = {
  model: AskModelClient;
  tools: readonly RegisteredAskTool[];
  /** Runs a tool executor as the viewer. Throws the auth error on lost access. */
  runTool: (tool: RegisteredAskTool, input: Record<string, unknown>) => Promise<AskToolResult>;
  /** Runs a display tool's executor as the viewer, with the turn's grounding set (D56). */
  runDisplayTool: (tool: RegisteredAskTool, input: Record<string, unknown>, allowed: string[]) => Promise<AskDisplayResult>;
  /** Meters one model call (`meteredStream`). */
  meter: <T extends StreamedCallResult>(stepIndex: number, run: () => Promise<T>) => Promise<T>;
  /** Writes progress; "deleting" means the thread is being deleted: stop at once. */
  write: (parts: AskMessagePart[]) => Promise<"ok" | "deleting">;
  isCancelled: () => Promise<boolean>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
};

export type TurnInput = {
  system: AskModelRequest["system"];
  /** History and the current user turn, as API messages. */
  messages: unknown[];
  /**
   * Entity ids a display may show before any tool runs this turn: the
   * thread's context and mentions, and what the thread cited or showed.
   */
  groundedIds?: readonly string[];
};

const DISPLAY_KINDS = new Set<string>(["entities", "flow", "chart", "choices", "contribute"]);

/** The component a `show` call asks for, or null for anything else. */
export function displayKindOf(input: unknown): AskDisplayKind | null {
  const kind = (input as { kind?: unknown } | null)?.kind;
  return typeof kind === "string" && DISPLAY_KINDS.has(kind) ? (kind as AskDisplayKind) : null;
}

/** Function, department and process ids a tool result names in its sources. */
export function entityIdsIn(result: AskToolResult): string[] {
  if (!result.found) return [];
  const ids: string[] = [];
  for (const block of result.content) {
    if (block.type !== "search_result") continue;
    const parsed = parseFabricSource(block.source);
    if (parsed && isHierarchyKind(parsed.sourceKind)) ids.push(parsed.sourceEntityId);
  }
  return ids;
}

const EMPTY_USAGE = (): TurnUsage => ({ inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cacheWriteTokens: 0 });

/**
 * Adds cache breakpoints to the last two user messages (FR-2.7): this step's
 * tool results are written to the cache and read back on the next step. The
 * stored messages stay unmarked, so every step's prefix is byte-identical.
 */
export function withCacheBreakpoints(messages: unknown[]): unknown[] {
  const marked = structuredClone(messages) as Array<{ role: string; content: unknown }>;
  let remaining = 2;
  for (let i = marked.length - 1; i >= 0 && remaining > 0; i--) {
    const message = marked[i];
    if (message.role !== "user") continue;
    if (typeof message.content === "string") {
      message.content = [{ type: "text", text: message.content }];
    }
    const blocks = message.content as Array<Record<string, unknown>>;
    const last = blocks[blocks.length - 1];
    if (last) last.cache_control = { type: "ephemeral" };
    remaining -= 1;
  }
  return marked;
}

function toolResultContent(result: AskToolResult) {
  if (!result.found) return [{ type: "text", text: '{"found":false}' }];
  return result.content;
}

class TurnStopped extends Error {
  constructor(readonly why: "cancelled" | "deadline" | "deleted") {
    super(why);
  }
}

export async function runTurnLoop(deps: TurnDeps, input: TurnInput): Promise<TurnOutcome> {
  const startedAt = deps.now();
  const deadline = startedAt + TURN_DEADLINE_MS;
  const pollMs = deps.pollIntervalMs ?? CANCEL_POLL_MS;
  const parts = new TurnParts();
  const usage = EMPTY_USAGE();
  const telemetry: ToolTelemetry[] = [];
  const messages = [...input.messages];
  const apiTools = toApiTools(deps.tools);
  const byName = new Map(deps.tools.map((tool) => [tool.name as string, tool]));
  let modelCalls = 0;
  let lastWrite = 0;
  let citations: AnswerCitation[] = [];

  // Writes run one at a time, in order, so a slow patch can never land after
  // a newer one and roll the visible trace back.
  let writes: Promise<void> = Promise.resolve();
  let deleting = false;
  const write = (force: boolean): Promise<void> => {
    const now = deps.now();
    if (!force && now - lastWrite < PATCH_INTERVAL_MS) return writes;
    lastWrite = now;
    const snapshot = parts.snapshot();
    writes = writes.then(async () => {
      if (deleting) return;
      if ((await deps.write(snapshot)) === "deleting") deleting = true;
    });
    return writes.then(() => {
      if (deleting) throw new TurnStopped("deleted");
    });
  };

  const finish = (
    status: TurnOutcome["status"],
    stopReason: TurnOutcome["quality"]["stopReason"],
    errorReason?: ErrorReason,
    error?: unknown,
  ): TurnOutcome => {
    parts.closeOpen(deps.now());
    return {
      status,
      ...(errorReason ? { errorReason } : {}),
      ...(error instanceof Error
        ? {
            diagnostic: {
              name: error.name,
              ...(error instanceof AskModelError && error.status !== undefined ? { status: error.status } : {}),
              message: error.message.slice(0, 500),
            },
          }
        : {}),
      parts: parts.snapshot(),
      citations,
      usage,
      telemetry,
      quality: {
        modelCalls,
        toolCalls: telemetry.length,
        citations: citations.length,
        zeroCitations: citations.length === 0,
        durationMs: deps.now() - startedAt,
        ...(parts.firstVisibleAt !== null ? { firstVisibleMs: parts.firstVisibleAt - startedAt } : {}),
        stopReason,
      },
    };
  };

  const grounded = new Set<string>(input.groundedIds ?? []);

  /**
   * Places one component (D56) and returns what the model is told. Caps are
   * checked here; references are checked by the executor, as the viewer.
   */
  const runDisplay = async (tool: RegisteredAskTool, toolInput: Record<string, unknown>): Promise<string> => {
    const startedAt = deps.now();
    const kind = displayKindOf(toolInput);
    if (parts.displayCount >= MAX_DISPLAYS) return `Nothing shown: at most ${MAX_DISPLAYS} components per answer.`;
    if (kind === "choices" && parts.hasDisplay("choices")) return "Nothing shown: one picker per answer.";
    let result: AskDisplayResult;
    try {
      result = await deps.runDisplayTool(tool, toolInput, [...grounded]);
    } catch (error) {
      if (authErrorCode(error)) throw error;
      result = { part: null, note: "Nothing shown: the component failed. Your answer stands without it." };
    }
    if (result.part) parts.addDisplay(result.part);
    telemetry.push({
      // Each component under its own name, so telemetry tells them apart.
      name: (kind && tool.display?.telemetry[kind]) || tool.telemetryName,
      latencyMs: deps.now() - startedAt,
      found: result.part !== null,
      resultTokens: 0,
      truncated: false,
    });
    return result.note;
  };

  const addUsage = (final: Pick<AskFinalMessage, "usage">) => {
    usage.inputTokens += final.usage.inputTokens;
    usage.outputTokens += final.usage.outputTokens;
    usage.cachedReadTokens += final.usage.cachedReadTokens;
    usage.cacheWriteTokens += final.usage.cacheWriteTokens;
  };

  /** One model call, polling the stop flag and the deadline while it streams. */
  const callModel = async (stepIndex: number, toolsOff: boolean): Promise<AskFinalMessage> => {
    const controller = new AbortController();
    let stoppedFor: "cancelled" | "deadline" | null = null;
    let streaming = true;
    // The poll's sleep races `done`, so a finished stream never waits out the
    // rest of a poll interval.
    let markDone!: () => void;
    const done = new Promise<void>((resolve) => (markDone = resolve));
    const poller = (async () => {
      while (streaming) {
        await Promise.race([deps.sleep(pollMs), done]);
        if (!streaming) break;
        if (deps.now() >= deadline) stoppedFor = "deadline";
        else if (await deps.isCancelled()) stoppedFor = "cancelled";
        if (stoppedFor) {
          controller.abort();
          break;
        }
      }
    })();
    const request: AskModelRequest = {
      system: input.system,
      tools: apiTools,
      messages: withCacheBreakpoints(messages),
      toolChoice: toolsOff ? "none" : "auto",
    };
    try {
      return await deps.meter(stepIndex, async () => {
        const final = await deps.model.stream(request, {
          signal: controller.signal,
          onEvent: (event) => {
            const now = deps.now();
            if (event.type === "thinking_start") parts.startReasoning(now);
            else if (event.type === "thinking_delta") parts.appendReasoning(event.text, now);
            else if (event.type === "block_stop") parts.endReasoning(now);
            void write(false).catch(() => {});
          },
        });
        return { ...final, finishReason: final.stopReason };
      });
    } catch (error) {
      if (stoppedFor) throw new TurnStopped(stoppedFor);
      throw error;
    } finally {
      streaming = false;
      markDone();
      await poller;
    }
  };

  try {
    for (let step = 0; step < MAX_MODEL_CALLS; step++) {
      if (await deps.isCancelled()) throw new TurnStopped("cancelled");
      const remaining = deadline - deps.now();
      if (remaining <= 0) throw new TurnStopped("deadline");
      const toolsOff = step === MAX_MODEL_CALLS - 1 || remaining < TOOLS_OFF_MARGIN_MS;
      const stepStartedAt = deps.now();

      let final: AskFinalMessage;
      try {
        modelCalls += 1;
        final = await callModel(step, toolsOff);
      } catch (error) {
        if (!(error instanceof AskModelError) || error.aborted) throw error;
        const retryable = error.status === 429 || (error.status ?? 0) >= 500;
        const wait = Math.min(error.retryAfterMs ?? 2_000, deadline - deps.now() - TOOLS_OFF_MARGIN_MS);
        if (!retryable || wait < 0) throw error;
        // One retry, counted against the deadline (FR-2.5).
        await deps.sleep(wait);
        modelCalls += 1;
        final = await callModel(step, toolsOff);
      }
      addUsage(final);
      messages.push({ role: "assistant", content: final.content });

      if (final.stopReason === "refusal") {
        parts.setAnswer("", deps.now());
        return finish("error", "refusal", "refusal");
      }
      const toolUses = final.content.filter(
        (block): block is Extract<AskContentBlock, { type: "tool_use" }> => block.type === "tool_use",
      );

      if (final.stopReason !== "tool_use" || toolUses.length === 0) {
        const answer = answerFromBlocks(final.content);
        citations = answer.citations;
        parts.setAnswer(answer.text, deps.now());
        if (isTokenLimitFinishReason(final.stopReason)) return finish("error", "max_tokens", "truncated");
        return finish("complete", toolsOff && step === MAX_MODEL_CALLS - 1 ? "stepCap" : "end_turn");
      }

      const dataUses = toolUses.filter((use) => byName.get(use.name)?.display === undefined);
      const displayUses = toolUses.filter((use) => byName.get(use.name)?.display !== undefined);
      // A step that wrote its answer and only placed components ends the turn
      // (D56): no further model call, and history replays text only, so no
      // tool call is left unanswered. Without text, the model still has to
      // write the answer, so the loop goes on.
      const answersNow = dataUses.length === 0 && stepText(final.content).trim() !== "";
      if (!answersNow) parts.addProgressNote(stepText(final.content), stepStartedAt, deps.now());

      const runs = dataUses.map((use) => {
        const tool = byName.get(use.name);
        const toolInput = (use.input ?? {}) as Record<string, unknown>;
        let label = `Using ${use.name}`;
        try {
          if (tool) label = tool.label(toolInput as never);
        } catch {
          // A label must never break the turn; the tool's name is the fallback.
        }
        const partIndex = tool ? parts.startTool(tool.name, label, deps.now()) : -1;
        return { use, tool, toolInput, partIndex, startedAt: deps.now() };
      });
      if (runs.length > 0) await write(true);

      const results = await Promise.all(
        runs.map(async (run) => {
          if (!run.tool) {
            return { type: "tool_result", tool_use_id: run.use.id, is_error: true, content: [{ type: "text", text: `Unknown tool ${run.use.name}` }] };
          }
          try {
            const result = await deps.runTool(run.tool, run.toolInput);
            for (const id of entityIdsIn(result)) grounded.add(id);
            parts.endTool(run.partIndex, "done", result.found ? result.resultCount : 0, deps.now());
            telemetry.push({
              name: run.tool.telemetryName,
              latencyMs: deps.now() - run.startedAt,
              found: result.found,
              resultTokens: result.found ? result.resultTokens : 0,
              truncated: result.found ? result.truncated : false,
            });
            return { type: "tool_result", tool_use_id: run.use.id, content: toolResultContent(result) };
          } catch (error) {
            if (authErrorCode(error)) throw error;
            parts.endTool(run.partIndex, "failed", undefined, deps.now());
            telemetry.push({ name: run.tool.telemetryName, latencyMs: deps.now() - run.startedAt, found: false, resultTokens: 0, truncated: false });
            return { type: "tool_result", tool_use_id: run.use.id, is_error: true, content: [{ type: "text", text: "The tool failed. Answer from what you have, or try a different tool." }] };
          }
        }),
      );

      // Displays run after the step's data tools, so the model can fetch and
      // show in one step: their references are checked against what came back.
      for (const use of displayUses) {
        const tool = byName.get(use.name)!;
        const note = await runDisplay(tool, (use.input ?? {}) as Record<string, unknown>);
        // Shown before any answer was written: the model must not take the
        // component as the answer (found on dev, 2026-11-05).
        const due = displayKindOf(use.input) === "choices" ? QUESTION_STILL_DUE : ANSWER_STILL_DUE;
        const text = answersNow ? note : `${note} ${due}`;
        results.push({ type: "tool_result", tool_use_id: use.id, content: [{ type: "text", text }] });
      }

      if (answersNow) {
        const answer = answerFromBlocks(final.content);
        citations = answer.citations;
        parts.setAnswer(answer.text, deps.now());
        return finish("complete", "end_turn");
      }
      messages.push({ role: "user", content: results });
      await write(true);
    }
    // Unreachable: the last call runs with tools off and returns above.
    return finish("complete", "stepCap");
  } catch (error) {
    if (error instanceof TurnStopped) {
      if (error.why === "deleted") return finish("deleted", "stopped");
      if (error.why === "cancelled") return finish("stopped", "stopped");
      return finish("error", "error", "deadline");
    }
    if (authErrorCode(error)) return finish("error", "error", "accessLost");
    if (error instanceof AskModelError) {
      return finish("error", "error", error.status === 429 ? "busy" : "modelError", error);
    }
    return finish("error", "error", "modelError", error);
  }
}

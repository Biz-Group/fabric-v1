import AnthropicFoundry from "@anthropic-ai/foundry-sdk";
import { AIRequestError } from "../lib/aiProvider";
import type { TokenUsageForPricing } from "../lib/aiPricing";
import type { AskFabricConfig } from "../lib/askFabricFeature";
import { FOLLOW_UP_SYSTEM_PROMPT } from "./followUps";

/**
 * AskFabric's model client (FR-2.5, FR-2.8): a thin interface over the native
 * Foundry SDK, separate from the pipeline client. It reads only the AskFabric
 * deployment, so chat traffic can never land on pipeline capacity. Tests use
 * `createScriptedAskClient` instead.
 */

/** Per-call timeout (FR-2.5; S2 measured 2–8.5 s per step). */
export const ASK_CALL_TIMEOUT_MS = 90_000;
/** Per-call output ceiling. Thinking counts toward it; S2 found it is not reserved. */
export const ASK_MAX_TOKENS = 16_000;
/** S2 confirmed Foundry accepts this beta and reports dropped blocks. */
export const THINKING_BINDING_BETA = "thinking-binding-controls-2026-08-01";

export type AskStreamEvent =
  | { type: "thinking_start" }
  | { type: "thinking_delta"; text: string }
  | { type: "block_stop" }
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; id: string; name: string };

export type AskModelRequest = {
  system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  tools: ReadonlyArray<Record<string, unknown>>;
  /** Raw Messages API messages, passed back unchanged step to step. */
  messages: unknown[];
  /** `none` for the final call of a capped turn (FR-2.5). */
  toolChoice: "auto" | "none";
};

/** The final message's fields the loop needs; `content` stays raw. */
export type AskFinalMessage = {
  content: AskContentBlock[];
  stopReason: string | null;
  usage: Required<TokenUsageForPricing>;
  requestId: string | null;
};

export type AskCitation = {
  type: string;
  source?: string;
  title?: string | null;
  cited_text?: string;
};

export type AskContentBlock =
  | { type: "text"; text: string; citations?: AskCitation[] | null }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: string; [key: string]: unknown };

/**
 * A failed call. `retryAfterMs` comes from the 429 response; `partialUsage`
 * from `message_start`, so a stopped or failed call still meters its input.
 */
export class AskModelError extends AIRequestError {
  readonly aborted: boolean;
  readonly retryAfterMs: number | null;
  readonly partialUsage: TokenUsageForPricing | undefined;

  constructor(
    message: string,
    details: {
      status?: number;
      requestId?: string | null;
      aborted?: boolean;
      retryAfterMs?: number | null;
      partialUsage?: TokenUsageForPricing;
      cause?: unknown;
    },
  ) {
    super(message, { provider: "foundry-claude", ...details });
    this.name = details.aborted ? "AskModelAborted" : "AskModelError";
    this.aborted = details.aborted ?? false;
    this.retryAfterMs = details.retryAfterMs ?? null;
    this.partialUsage = details.partialUsage;
  }
}

export interface AskModelClient {
  stream(
    request: AskModelRequest,
    options: { signal: AbortSignal; onEvent: (event: AskStreamEvent) => void },
  ): Promise<AskFinalMessage>;
  /**
   * A non-streamed call: without thinking for the thread title (FR-2.10), or
   * with it for the eval judge (FR-10.3).
   */
  complete(request: { system: string; user: string; maxTokens: number; reasoning?: boolean }): Promise<AskFinalMessage>;
}

type RawUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

function usageOf(raw: RawUsage | undefined | null): Required<TokenUsageForPricing> {
  return {
    inputTokens: raw?.input_tokens ?? 0,
    outputTokens: raw?.output_tokens ?? 0,
    cachedReadTokens: raw?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: raw?.cache_creation_input_tokens ?? 0,
  };
}

function retryAfterMs(headers: unknown): number | null {
  const get = (headers as { get?: (name: string) => string | null } | undefined)?.get;
  const value = get?.call(headers, "retry-after");
  const seconds = value ? Number(value) : NaN;
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

function toAskError(error: unknown, partialUsage?: TokenUsageForPricing): AskModelError {
  if (error instanceof AskModelError) return error;
  const e = error as { name?: string; status?: number; headers?: unknown; requestID?: string | null; message?: string };
  return new AskModelError(e.message ?? "AskFabric model call failed", {
    status: e.status,
    requestId: e.requestID ?? null,
    aborted: e.name === "APIUserAbortError" || e.name === "AbortError",
    retryAfterMs: retryAfterMs(e.headers),
    partialUsage,
    cause: error,
  });
}

export function createFoundryAskClient(config: AskFabricConfig): AskModelClient {
  const client = new AnthropicFoundry({
    apiKey: config.apiKey,
    baseURL: `${config.endpoint}/anthropic`,
    // The loop owns retries, so they count against the turn deadline.
    maxRetries: 0,
    timeout: ASK_CALL_TIMEOUT_MS,
  });

  return {
    async stream(request, { signal, onEvent }) {
      const body = {
        model: config.deployment,
        max_tokens: ASK_MAX_TOKENS,
        system: request.system,
        tools: request.tools,
        tool_choice: { type: request.toolChoice },
        // Summarized thinking streams reasoning for the trace (D47). Clearing
        // an earlier tool result edits history, so mismatched thinking blocks
        // are dropped rather than failing the call (FR-2.7).
        thinking: {
          type: "adaptive",
          display: "summarized",
          block_binding: { prefix_mismatch_behavior: "drop_block" },
        },
        output_config: { effort: config.effort ?? "medium" },
        messages: request.messages,
      };
      const stream = client.messages.stream(body as never, {
        signal,
        headers: { "anthropic-beta": THINKING_BINDING_BETA },
      });
      stream.on("streamEvent", (event) => {
        if (event.type === "content_block_start") {
          const block = event.content_block as { type: string; id?: string; name?: string };
          if (block.type === "thinking") onEvent({ type: "thinking_start" });
          if (block.type === "tool_use") onEvent({ type: "tool_use_start", id: block.id ?? "", name: block.name ?? "" });
        } else if (event.type === "content_block_delta") {
          const delta = event.delta as { type: string; thinking?: string; text?: string };
          if (delta.type === "thinking_delta" && delta.thinking) onEvent({ type: "thinking_delta", text: delta.thinking });
          if (delta.type === "text_delta" && delta.text) onEvent({ type: "text_delta", text: delta.text });
        } else if (event.type === "content_block_stop") {
          onEvent({ type: "block_stop" });
        }
      });
      try {
        const final = await stream.finalMessage();
        return {
          content: final.content as AskContentBlock[],
          stopReason: final.stop_reason ?? null,
          usage: usageOf(final.usage as RawUsage),
          requestId: (final as { _request_id?: string | null })._request_id ?? null,
        };
      } catch (error) {
        throw toAskError(error, usageOf(stream.currentMessage?.usage as RawUsage | undefined));
      }
    },

    async complete({ system, user, maxTokens, reasoning = false }) {
      try {
        const message = await client.messages.create({
          model: config.deployment,
          max_tokens: maxTokens,
          system,
          // Sonnet 5.5 rejects `disabled`; `between_tools` is its off switch.
          thinking: reasoning ? { type: "adaptive" } : { type: "between_tools" },
          output_config: { effort: reasoning ? (config.effort ?? "medium") : "low" },
          messages: [{ role: "user", content: user }],
        } as never);
        const final = message as unknown as {
          content: AskContentBlock[];
          stop_reason: string | null;
          usage: RawUsage;
          _request_id?: string | null;
        };
        return {
          content: final.content,
          stopReason: final.stop_reason,
          usage: usageOf(final.usage),
          requestId: final._request_id ?? null,
        };
      } catch (error) {
        throw toAskError(error);
      }
    },
  };
}

let clientFactory: (config: AskFabricConfig) => AskModelClient = createFoundryAskClient;

/** The client `ask.runTurn` uses: Foundry, unless a test has swapped it. */
export function askModelClientFor(config: AskFabricConfig): AskModelClient {
  return clientFactory(config);
}

/** Test seam: convex-test runs functions in-process, so this reaches `runTurn`. */
export function setAskModelClientFactory(factory: ((config: AskFabricConfig) => AskModelClient) | null) {
  clientFactory = factory ?? createFoundryAskClient;
}

// ---- Scripted client for tests ---------------------------------------------------

export type ScriptedStep =
  | {
      events?: AskStreamEvent[];
      content: AskContentBlock[];
      stopReason?: string;
      usage?: Partial<TokenUsageForPricing>;
      /** Called before the step resolves, e.g. to request a stop mid-stream. */
      during?: () => Promise<void> | void;
      /** Resolve only when aborted, to simulate a long stream. */
      hangUntilAborted?: boolean;
    }
  | { error: { status?: number; message?: string; retryAfterMs?: number } };

/**
 * A fake model that plays back scripted steps and records every request. Its
 * non-streamed calls answer with `followUpsText` for the follow-up prompt and
 * `titleText` otherwise.
 */
export function createScriptedAskClient(steps: ScriptedStep[], titleText = "Scripted thread title", followUpsText = "") {
  const requests: AskModelRequest[] = [];
  let index = 0;
  const client: AskModelClient = {
    async stream(request, { signal, onEvent }) {
      requests.push(structuredClone(request));
      const step = steps[index++];
      if (!step) throw new Error(`Scripted client ran out of steps at call ${index}`);
      if ("error" in step) {
        throw new AskModelError(step.error.message ?? "scripted failure", {
          status: step.error.status,
          retryAfterMs: step.error.retryAfterMs ?? null,
          partialUsage: { inputTokens: 100, outputTokens: 0 },
        });
      }
      for (const event of step.events ?? []) onEvent(event);
      await step.during?.();
      if (step.hangUntilAborted) {
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      }
      if (signal.aborted) {
        throw new AskModelError("Request was aborted.", {
          aborted: true,
          partialUsage: { inputTokens: 100, outputTokens: 5 },
        });
      }
      return {
        content: step.content,
        stopReason: step.stopReason ?? (step.content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn"),
        usage: { inputTokens: 100, outputTokens: 50, cachedReadTokens: 0, cacheWriteTokens: 0, ...step.usage },
        requestId: `req_${index}`,
      };
    },
    async complete({ system }) {
      return {
        content: [{ type: "text", text: system === FOLLOW_UP_SYSTEM_PROMPT ? followUpsText : titleText }],
        stopReason: "end_turn",
        usage: { inputTokens: 40, outputTokens: 6, cachedReadTokens: 0, cacheWriteTokens: 0 },
        requestId: "req_title",
      };
    },
  };
  return { client, requests, callCount: () => index };
}

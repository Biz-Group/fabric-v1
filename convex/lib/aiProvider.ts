import Anthropic from "@anthropic-ai/sdk";
import AnthropicFoundry from "@anthropic-ai/foundry-sdk";
import OpenAI from "openai";
import { env } from "../_generated/server";

export type AICapability = "synthesis" | "safety";
export type AIProvider = "openrouter" | "foundry-claude" | "foundry-openai";
export type PersistedAIProvider = "fabric-openrouter" | "fabric-foundry";

export const FOUNDRY_CLAUDE_MODEL = "foundry:claude-haiku-4-5@2";
export const FOUNDRY_FALLBACK_MODEL = "foundry:gpt-5-mini@2025-08-07";
export const FOUNDRY_SAFETY_MODEL = "foundry:gpt-5-nano@2025-08-07";
export const OPENROUTER_CLAUDE_MODEL =
  "openrouter:anthropic/claude-haiku-4.5";
export const OPENROUTER_SAFETY_MODEL =
  "openrouter:google/gemma-4-26b-a4b-it";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;

export type AIJsonSchema = Readonly<Record<string, unknown>> & {
  readonly type: "object";
};

export type AITool = {
  name: string;
  description: string;
  inputSchema: AIJsonSchema;
};

export type AIRequest = {
  capability: AICapability;
  operation: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
  tool?: AITool;
};

export type AIUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type AICompletion = {
  provider: AIProvider;
  model: string;
  deployment: string;
  text: string | null;
  toolInput: unknown | null;
  finishReason: string | null;
  usage: AIUsage | null;
  requestId: string | null;
};

type ResolvedAIBackend = {
  provider: AIProvider;
  model: string;
  deployment: string;
  endpoint: string;
  apiKey: string;
};

type OpenRouterChoice = {
  finish_reason?: unknown;
  native_finish_reason?: unknown;
  message?: {
    content?: unknown;
    tool_calls?: Array<{
      function?: { name?: unknown; arguments?: unknown };
    }>;
  };
};

type OpenRouterResponse = {
  id?: unknown;
  choices?: OpenRouterChoice[];
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  };
};

export class AIConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIConfigurationError";
  }
}

export class AIRequestError extends Error {
  readonly provider: AIProvider;
  readonly status: number | undefined;
  readonly requestId: string | null;

  constructor(
    message: string,
    details: {
      provider: AIProvider;
      status?: number;
      requestId?: string | null;
      cause?: unknown;
    },
  ) {
    super(message, { cause: details.cause });
    this.name = "AIRequestError";
    this.provider = details.provider;
    this.status = details.status;
    this.requestId = details.requestId ?? null;
  }
}

function requireSetting(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new AIConfigurationError(
      `AI is not configured: missing ${name}.`,
    );
  }
  return value.trim();
}

function normalizeEndpoint(value: string): string {
  const endpoint = value.trim().replace(/\/+$/, "");
  return endpoint
    .replace(/\/anthropic$/i, "")
    .replace(/\/openai\/v1$/i, "");
}

function resolveBackend(capability: AICapability): ResolvedAIBackend {
  const provider = env.AI_PROVIDER ?? "openrouter";

  if (provider === "openrouter") {
    const apiKey = requireSetting(
      "OPENROUTER_API_KEY",
      env.OPENROUTER_API_KEY,
    );
    const isSafety = capability === "safety";
    return {
      provider: "openrouter",
      model: isSafety ? OPENROUTER_SAFETY_MODEL : OPENROUTER_CLAUDE_MODEL,
      deployment: isSafety
        ? "google/gemma-4-26b-a4b-it"
        : "anthropic/claude-haiku-4.5",
      endpoint: OPENROUTER_URL,
      apiKey,
    };
  }

  const endpoint = normalizeEndpoint(
    requireSetting("FOUNDRY_ENDPOINT", env.FOUNDRY_ENDPOINT),
  );
  const apiKey = requireSetting("FOUNDRY_API_KEY", env.FOUNDRY_API_KEY);

  if (capability === "safety") {
    return {
      provider: "foundry-openai",
      model: FOUNDRY_SAFETY_MODEL,
      deployment: requireSetting(
        "FOUNDRY_SAFETY_DEPLOYMENT",
        env.FOUNDRY_SAFETY_DEPLOYMENT,
      ),
      endpoint,
      apiKey,
    };
  }

  if ((env.FOUNDRY_SYNTHESIS_BACKEND ?? "claude") === "gpt5mini") {
    return {
      provider: "foundry-openai",
      model: FOUNDRY_FALLBACK_MODEL,
      deployment: requireSetting(
        "FOUNDRY_OPENAI_FALLBACK_DEPLOYMENT",
        env.FOUNDRY_OPENAI_FALLBACK_DEPLOYMENT,
      ),
      endpoint,
      apiKey,
    };
  }

  return {
    provider: "foundry-claude",
    model: FOUNDRY_CLAUDE_MODEL,
    deployment: requireSetting(
      "FOUNDRY_CLAUDE_DEPLOYMENT",
      env.FOUNDRY_CLAUDE_DEPLOYMENT,
    ),
    endpoint,
    apiKey,
  };
}

export function isAIConfigured(capability: AICapability): boolean {
  try {
    resolveBackend(capability);
    return true;
  } catch (error) {
    if (error instanceof AIConfigurationError) return false;
    throw error;
  }
}

export function getPersistedAIProvider(): PersistedAIProvider {
  return (env.AI_PROVIDER ?? "openrouter") === "foundry"
    ? "fabric-foundry"
    : "fabric-openrouter";
}

function asNonEmptyText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asFiniteTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseToolArguments(value: unknown): unknown | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch (error) {
    throw new Error(
      `AI tool arguments contained invalid JSON: ${
        error instanceof Error ? error.message : "unknown parse error"
      }`,
      { cause: error },
    );
  }
}

function requestIdFrom(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return (
    asNonEmptyText(record._request_id) ??
    asNonEmptyText(record.request_id) ??
    asNonEmptyText(record.id)
  );
}

function logSuccess(
  request: AIRequest,
  completion: AICompletion,
  startedAt: number,
): void {
  console.info("AI request completed", {
    operation: request.operation,
    provider: completion.provider,
    model: completion.model,
    deployment: completion.deployment,
    latencyMs: Date.now() - startedAt,
    finishReason: completion.finishReason,
    inputTokens: completion.usage?.inputTokens,
    outputTokens: completion.usage?.outputTokens,
    requestId: completion.requestId,
  });
}

function errorStatus(error: unknown): number | undefined {
  if (error instanceof Anthropic.APIError || error instanceof OpenAI.APIError) {
    return error.status;
  }
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function errorRequestId(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  return requestIdFrom(error);
}

function logFailure(
  request: AIRequest,
  backend: ResolvedAIBackend,
  startedAt: number,
  error: unknown,
): void {
  console.error("AI request failed", {
    operation: request.operation,
    provider: backend.provider,
    model: backend.model,
    deployment: backend.deployment,
    latencyMs: Date.now() - startedAt,
    status: errorStatus(error),
    requestId: errorRequestId(error),
    errorType: error instanceof Error ? error.name : "UnknownError",
  });
}

function anthropicText(message: Anthropic.Message): string | null {
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  return text || null;
}

function anthropicToolInput(
  message: Anthropic.Message,
  toolName: string | undefined,
): unknown | null {
  const block = message.content.find(
    (item): item is Anthropic.ToolUseBlock =>
      item.type === "tool_use" && (!toolName || item.name === toolName),
  );
  return block?.input ?? null;
}

async function callFoundryClaude(
  backend: ResolvedAIBackend,
  request: AIRequest,
): Promise<AICompletion> {
  const client = new AnthropicFoundry({
    apiKey: backend.apiKey,
    baseURL: `${backend.endpoint}/anthropic`,
    maxRetries: DEFAULT_MAX_RETRIES,
    timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  const tools: Anthropic.Tool[] | undefined = request.tool
    ? [
        {
          name: request.tool.name,
          description: request.tool.description,
          input_schema: request.tool.inputSchema as Anthropic.Tool.InputSchema,
        },
      ]
    : undefined;

  const message = await client.messages.create({
    model: backend.deployment,
    system: request.system,
    messages: [{ role: "user", content: request.user }],
    max_tokens: request.maxTokens,
    ...(request.temperature === undefined
      ? {}
      : { temperature: request.temperature }),
    ...(tools
      ? {
          tools,
          tool_choice: { type: "tool" as const, name: request.tool!.name },
        }
      : {}),
  });

  return {
    provider: backend.provider,
    model: backend.model,
    deployment: backend.deployment,
    text: anthropicText(message),
    toolInput: anthropicToolInput(message, request.tool?.name),
    finishReason: message.stop_reason,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
    requestId: requestIdFrom(message),
  };
}

async function callFoundryOpenAI(
  backend: ResolvedAIBackend,
  request: AIRequest,
): Promise<AICompletion> {
  const client = new OpenAI({
    apiKey: backend.apiKey,
    baseURL: `${backend.endpoint}/openai/v1/`,
    maxRetries: DEFAULT_MAX_RETRIES,
    timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  const completion = await client.chat.completions.create({
    model: backend.deployment,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
    max_completion_tokens: request.maxTokens,
    reasoning_effort: "minimal",
    ...(request.tool
      ? {
          tools: [
            {
              type: "function" as const,
              function: {
                name: request.tool.name,
                description: request.tool.description,
                parameters: request.tool.inputSchema as Record<string, unknown>,
                strict: true,
              },
            },
          ],
          tool_choice: {
            type: "function" as const,
            function: { name: request.tool.name },
          },
          parallel_tool_calls: false,
        }
      : {}),
  });

  const choice = completion.choices[0];
  const toolCall = choice?.message.tool_calls?.find(
    (item) =>
      item.type === "function" &&
      (!request.tool || item.function.name === request.tool.name),
  );

  return {
    provider: backend.provider,
    model: backend.model,
    deployment: backend.deployment,
    text: asNonEmptyText(choice?.message.content),
    toolInput: parseToolArguments(
      toolCall?.type === "function" ? toolCall.function.arguments : undefined,
    ),
    finishReason: choice?.finish_reason ?? null,
    usage: completion.usage
      ? {
          inputTokens: completion.usage.prompt_tokens,
          outputTokens: completion.usage.completion_tokens,
        }
      : null,
    requestId: requestIdFrom(completion),
  };
}

function retryDelayMs(response: Response, retryNumber: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 10_000);
    }
  }
  return Math.min(250 * 2 ** retryNumber, 4_000);
}

function shouldRetry(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOpenRouter(
  backend: ResolvedAIBackend,
  request: AIRequest,
  body: Record<string, unknown>,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= DEFAULT_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    try {
      const response = await fetch(backend.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${backend.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (response.ok || !shouldRetry(response.status)) return response;
      lastError = new AIRequestError(
        `OpenRouter request failed with status ${response.status}.`,
        { provider: backend.provider, status: response.status },
      );
      if (attempt < DEFAULT_MAX_RETRIES) {
        await response.body?.cancel();
        await wait(retryDelayMs(response, attempt));
      }
    } catch (error) {
      lastError = error;
      if (attempt < DEFAULT_MAX_RETRIES) {
        await wait(Math.min(250 * 2 ** attempt, 4_000));
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new Error("OpenRouter request failed.");
}

async function callOpenRouter(
  backend: ResolvedAIBackend,
  request: AIRequest,
): Promise<AICompletion> {
  const body: Record<string, unknown> = {
    model: backend.deployment,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
    max_tokens: request.maxTokens,
    ...(request.temperature === undefined
      ? {}
      : { temperature: request.temperature }),
    ...(request.tool
      ? {
          tools: [
            {
              type: "function",
              function: {
                name: request.tool.name,
                description: request.tool.description,
                parameters: request.tool.inputSchema,
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: request.tool.name },
          },
        }
      : {}),
  };

  const response = await fetchOpenRouter(backend, request, body);
  if (!response.ok) {
    await response.body?.cancel();
    throw new AIRequestError(
      `OpenRouter request failed with status ${response.status}.`,
      { provider: backend.provider, status: response.status },
    );
  }

  const result = (await response.json()) as OpenRouterResponse;
  const choice = result.choices?.[0];
  const toolCall = choice?.message?.tool_calls?.find(
    (item) =>
      !request.tool || item.function?.name === request.tool.name,
  );
  const finishReason =
    asNonEmptyText(choice?.finish_reason) ??
    asNonEmptyText(choice?.native_finish_reason);

  return {
    provider: backend.provider,
    model: backend.model,
    deployment: backend.deployment,
    text: asNonEmptyText(choice?.message?.content),
    toolInput: parseToolArguments(toolCall?.function?.arguments),
    finishReason,
    usage: result.usage
      ? {
          inputTokens: asFiniteTokenCount(result.usage.prompt_tokens),
          outputTokens: asFiniteTokenCount(result.usage.completion_tokens),
        }
      : null,
    requestId: requestIdFrom(result),
  };
}

export async function generateAICompletion(
  request: AIRequest,
): Promise<AICompletion> {
  const backend = resolveBackend(request.capability);
  const startedAt = Date.now();

  try {
    const completion =
      backend.provider === "foundry-claude"
        ? await callFoundryClaude(backend, request)
        : backend.provider === "foundry-openai"
          ? await callFoundryOpenAI(backend, request)
          : await callOpenRouter(backend, request);
    logSuccess(request, completion, startedAt);
    return completion;
  } catch (error) {
    logFailure(request, backend, startedAt, error);
    if (error instanceof AIRequestError) throw error;
    throw new AIRequestError("AI request failed.", {
      provider: backend.provider,
      status: errorStatus(error),
      requestId: errorRequestId(error),
      cause: error,
    });
  }
}

export function isTokenLimitFinishReason(reason: string | null): boolean {
  if (!reason) return false;
  const normalized = reason.toLowerCase();
  return (
    normalized === "length" ||
    normalized === "max_tokens" ||
    normalized.includes("max_token") ||
    normalized.includes("token_limit")
  );
}

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  FOUNDRY_CLAUDE_MODEL,
  FOUNDRY_SAFETY_MODEL,
  OPENROUTER_CLAUDE_MODEL,
  generateAICompletion,
  getPersistedAIProvider,
} from "./aiProvider";

const AI_ENV_NAMES = [
  "AI_PROVIDER",
  "OPENROUTER_API_KEY",
  "FOUNDRY_ENDPOINT",
  "FOUNDRY_API_KEY",
  "FOUNDRY_SYNTHESIS_BACKEND",
  "FOUNDRY_CLAUDE_DEPLOYMENT",
  "FOUNDRY_OPENAI_FALLBACK_DEPLOYMENT",
  "FOUNDRY_SAFETY_DEPLOYMENT",
] as const;

type ObservedRequest = {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
};

async function observeRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<ObservedRequest> {
  const request = input instanceof Request ? input : new Request(input, init);
  return {
    url: request.url,
    headers: request.headers,
    body: (await request.clone().json()) as Record<string, unknown>,
  };
}

describe("AI provider adapter", () => {
  beforeEach(() => {
    for (const name of AI_ENV_NAMES) delete process.env[name];
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const name of AI_ENV_NAMES) delete process.env[name];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("uses the Foundry Claude Messages API for synthesis", async () => {
    process.env.AI_PROVIDER = "foundry";
    process.env.FOUNDRY_ENDPOINT =
      "https://fabric-test.services.ai.azure.com/";
    process.env.FOUNDRY_API_KEY = "foundry-test-key";
    process.env.FOUNDRY_CLAUDE_DEPLOYMENT = "fabric-claude-haiku-4-5";

    let observed: ObservedRequest | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        observed = await observeRequest(input, init);
        return new Response(
          JSON.stringify({
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: "fabric-claude-haiku-4-5",
            content: [{ type: "text", text: "Generated summary" }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 12, output_tokens: 4 },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "request-id": "msg_request_test",
            },
          },
        );
      }),
    );

    const completion = await generateAICompletion({
      capability: "synthesis",
      operation: "adapter-test-claude",
      system: "System prompt",
      user: "User prompt",
      maxTokens: 8192,
    });

    expect(observed?.url).toBe(
      "https://fabric-test.services.ai.azure.com/anthropic/v1/messages",
    );
    expect(observed?.headers.get("x-api-key")).toBe("foundry-test-key");
    expect(observed?.body).toMatchObject({
      model: "fabric-claude-haiku-4-5",
      system: "System prompt",
      max_tokens: 8192,
    });
    expect(completion).toMatchObject({
      provider: "foundry-claude",
      model: FOUNDRY_CLAUDE_MODEL,
      deployment: "fabric-claude-haiku-4-5",
      text: "Generated summary",
      toolInput: null,
      finishReason: "end_turn",
      usage: { inputTokens: 12, outputTokens: 4 },
    });
    expect(getPersistedAIProvider()).toBe("fabric-foundry");
  });

  test("uses Foundry OpenAI strict tool calling for safety", async () => {
    process.env.AI_PROVIDER = "foundry";
    process.env.FOUNDRY_ENDPOINT =
      "https://fabric-test.services.ai.azure.com/openai/v1";
    process.env.FOUNDRY_API_KEY = "foundry-test-key";
    process.env.FOUNDRY_SAFETY_DEPLOYMENT = "fabric-description-safety";

    let observed: ObservedRequest | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        observed = await observeRequest(input, init);
        return new Response(
          JSON.stringify({
            id: "chatcmpl_test",
            object: "chat.completion",
            created: 1,
            model: "fabric-description-safety",
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_test",
                      type: "function",
                      function: {
                        name: "classify",
                        arguments: '{"decision":"allow"}',
                      },
                    },
                  ],
                },
              },
            ],
            usage: {
              prompt_tokens: 20,
              completion_tokens: 5,
              total_tokens: 25,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const completion = await generateAICompletion({
      capability: "safety",
      operation: "adapter-test-safety",
      system: "Classify safely",
      user: "Business context",
      maxTokens: 1000,
      tool: {
        name: "classify",
        description: "Classify the input",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { decision: { type: "string" } },
          required: ["decision"],
        },
      },
    });

    expect(observed?.url).toBe(
      "https://fabric-test.services.ai.azure.com/openai/v1/chat/completions",
    );
    expect(observed?.headers.get("authorization")).toBe(
      "Bearer foundry-test-key",
    );
    expect(observed?.body).toMatchObject({
      model: "fabric-description-safety",
      max_completion_tokens: 1000,
      reasoning_effort: "minimal",
      parallel_tool_calls: false,
      tools: [{ function: { name: "classify", strict: true } }],
    });
    expect(completion).toMatchObject({
      provider: "foundry-openai",
      model: FOUNDRY_SAFETY_MODEL,
      toolInput: { decision: "allow" },
      finishReason: "tool_calls",
    });
  });

  test("keeps OpenRouter available as an explicit rollback backend", async () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "openrouter-test-key";

    let observed: ObservedRequest | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        observed = await observeRequest(input, init);
        return new Response(
          JSON.stringify({
            id: "or_test",
            choices: [
              {
                finish_reason: "stop",
                message: { content: "Rollback summary" },
              },
            ],
            usage: { prompt_tokens: 8, completion_tokens: 3 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const completion = await generateAICompletion({
      capability: "synthesis",
      operation: "adapter-test-openrouter",
      system: "System prompt",
      user: "User prompt",
      maxTokens: 100,
    });

    expect(observed?.url).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    expect(observed?.body).toMatchObject({
      model: "anthropic/claude-haiku-4.5",
      max_tokens: 100,
    });
    expect(completion).toMatchObject({
      provider: "openrouter",
      model: OPENROUTER_CLAUDE_MODEL,
      text: "Rollback summary",
    });
    expect(getPersistedAIProvider()).toBe("fabric-openrouter");
  });
});

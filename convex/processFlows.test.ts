import { describe, expect, test } from "vitest";
import {
  buildFlowGenerationRequestBody,
  extractFlowResponsePayload,
  getFlowFinishReason,
  isTokenLimitFinishReason,
  normalizeFlowResponse,
  parseFlowResponsePayload,
} from "./processFlows";

const sampleFlowPayload = {
  nodes: [
    {
      id: "start-request",
      label: "Start Request",
      description: "The request enters the process.",
      category: "start",
      actors: ["Requester"],
      tools: ["Portal"],
      painPoints: [],
      automationPotential: "medium",
      confidence: "high",
      isBottleneck: false,
      isTribalKnowledge: false,
      riskIndicators: [],
      sources: ["Conversation 1"],
    },
    {
      id: "approve-request",
      label: "Approve Request",
      description: "A manager approves the request.",
      category: "handoff",
      actors: ["Manager"],
      tools: ["Email"],
      painPoints: ["Approvals can sit in inboxes."],
      automationPotential: "high",
      confidence: "medium",
      isBottleneck: true,
      isTribalKnowledge: false,
      riskIndicators: ["Delayed approval"],
      sources: ["Conversation 1"],
    },
  ],
  edges: [
    {
      id: "start-request-approve-request",
      source: "start-request",
      target: "approve-request",
      type: "sequential",
      isHappyPath: true,
    },
  ],
  insights: {
    criticalPath: ["start-request", "approve-request"],
    handoffCount: 1,
    toolCount: 2,
    automationOpportunities: ["Automate approval reminders."],
    topBottlenecks: ["Approve Request"],
  },
};

describe("process flow generation helpers", () => {
  test("builds a forced structured OpenRouter tool request", () => {
    const body = buildFlowGenerationRequestBody("Conversation data");

    expect(body.model).toBe("anthropic/claude-haiku-4.5");
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(32768);
    expect(body.stream).toBe(false);
    expect(body.tools[0].function.name).toBe("return_process_flow");
    expect(body.tool_choice.function.name).toBe("return_process_flow");
    expect(body.tools[0].function.parameters.required).toEqual([
      "nodes",
      "edges",
      "insights",
    ]);
  });

  test("extracts forced tool-call arguments before assistant content", () => {
    const argsJson = JSON.stringify(sampleFlowPayload);

    const payload = extractFlowResponsePayload({
      choices: [
        {
          message: {
            content: "This should not be parsed.",
            tool_calls: [
              {
                function: {
                  name: "return_process_flow",
                  arguments: argsJson,
                },
              },
            ],
          },
        },
      ],
    });

    expect(payload).toBe(argsJson);
  });

  test("detects token-limit finish reasons before parsing", () => {
    expect(
      isTokenLimitFinishReason(
        getFlowFinishReason({ choices: [{ finish_reason: "length" }] }),
      ),
    ).toBe(true);
    expect(
      isTokenLimitFinishReason(
        getFlowFinishReason({
          choices: [{ native_finish_reason: "max_tokens" }],
        }),
      ),
    ).toBe(true);
    expect(
      isTokenLimitFinishReason(
        getFlowFinishReason({ choices: [{ finish_reason: "stop" }] }),
      ),
    ).toBe(false);
  });

  test("parses fenced and prose-wrapped JSON content as a fallback", () => {
    const parsed = parseFlowResponsePayload(
      `Here is the flow:\n\n\`\`\`json\n${JSON.stringify(sampleFlowPayload)}\n\`\`\`\n`,
    );

    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.insights?.criticalPath).toEqual([
      "start-request",
      "approve-request",
    ]);
  });

  test("parses OpenRouter content block arrays", () => {
    const parsed = parseFlowResponsePayload([
      { type: "text", text: JSON.stringify(sampleFlowPayload) },
    ]);

    expect(parsed.edges).toHaveLength(1);
  });

  test("rejects content with no JSON object", () => {
    expect(() => parseFlowResponsePayload("No JSON here.")).toThrow();
  });

  test("normalizes nodes, edges, and insights defensively", () => {
    const normalized = normalizeFlowResponse({
      nodes: [
        ...sampleFlowPayload.nodes,
        { id: "bad-node", label: "", category: "unknown" },
      ],
      edges: [
        ...sampleFlowPayload.edges,
        {
          id: "missing-target",
          source: "start-request",
          target: "missing",
          type: "weird",
          isHappyPath: true,
        },
      ],
      insights: {
        criticalPath: ["start-request", "missing"],
        automationOpportunities: ["Automate approval reminders."],
      },
    });

    expect(normalized.nodes).toHaveLength(2);
    expect(normalized.edges).toHaveLength(1);
    expect(normalized.insights.criticalPath).toEqual(["start-request"]);
    expect(normalized.insights.handoffCount).toBe(1);
    expect(normalized.insights.toolCount).toBe(2);
    expect(normalized.insights.topBottlenecks).toEqual(["Approve Request"]);
  });
});

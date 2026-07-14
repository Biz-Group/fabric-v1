import { describe, expect, test } from "vitest";
import {
  buildFlowGenerationAIRequest,
  normalizeFlowResponse,
  parseFlowResponsePayload,
} from "./processFlows";
import { isTokenLimitFinishReason } from "./lib/aiProvider";

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
  test("builds a provider-neutral forced structured tool request", () => {
    const request = buildFlowGenerationAIRequest("Conversation data");

    expect(request.capability).toBe("synthesis");
    expect(request.operation).toBe("process-flow-generation");
    expect(request.user).toBe("Conversation data");
    expect(request.temperature).toBe(0);
    expect(request.maxTokens).toBe(32768);
    expect(request.tool.name).toBe("return_process_flow");
    expect(request.tool.inputSchema.required).toEqual([
      "nodes",
      "edges",
      "insights",
    ]);
  });

  test("detects provider token-limit finish reasons before parsing", () => {
    expect(isTokenLimitFinishReason("length")).toBe(true);
    expect(isTokenLimitFinishReason("max_tokens")).toBe(true);
    expect(isTokenLimitFinishReason("stop")).toBe(false);
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

  test("defaults missing automation potential to low, not none", () => {
    const normalized = normalizeFlowResponse({
      nodes: [
        {
          id: "do-thing",
          label: "Do Thing",
          description: "A step with no automationPotential field.",
          category: "action",
          actors: [],
          tools: [],
          painPoints: [],
          confidence: "medium",
          isBottleneck: false,
          isTribalKnowledge: false,
          riskIndicators: [],
          sources: [],
        },
      ],
      edges: [],
      insights: {},
    });

    // "none" would mean "already automated" and hide the step from automation
    // candidates; an unknown value must remain a (weak) candidate instead.
    expect(normalized.nodes[0].automationPotential).toBe("low");
  });
});

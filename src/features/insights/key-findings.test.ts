import { describe, expect, test } from "vitest";
import {
  deriveHandoffs,
  deriveKeyFindings,
  MAX_KEY_FINDINGS,
  type FlowNode,
  type ProcessFlow,
} from "./insights-derivations";

function node(overrides: Partial<FlowNode> & { id: string }): FlowNode {
  return {
    label: overrides.id,
    category: "action",
    description: "",
    actors: [],
    tools: [],
    painPoints: [],
    automationPotential: "low",
    confidence: "medium",
    isBottleneck: false,
    isTribalKnowledge: false,
    riskIndicators: [],
    sources: [],
    detailStatus: "ready",
    ...overrides,
  } as FlowNode;
}

function edge(source: string, target: string) {
  return {
    id: `${source}-${target}`,
    source,
    target,
    type: "sequential",
    isHappyPath: true,
  };
}

type Opportunity = NonNullable<
  ProcessFlow["insights"]["automationOpportunityDetails"]
>[number];

function opportunity(overrides: Partial<Opportunity>): Opportunity {
  return {
    title: "Automate it",
    kind: "workflow",
    nodeIds: [],
    rationale: "Repeatable.",
    prerequisites: [],
    confidence: "medium",
    ...overrides,
  };
}

function flowOf(
  nodes: FlowNode[],
  edges: ReturnType<typeof edge>[] = [],
  insights: Partial<ProcessFlow["insights"]> = {},
): ProcessFlow {
  return {
    nodes,
    edges,
    insights: {
      criticalPath: [],
      handoffCount: 0,
      toolCount: 0,
      automationOpportunities: [],
      topBottlenecks: [],
      ...insights,
    },
  } as unknown as ProcessFlow;
}

function findingsOf(flow: ProcessFlow) {
  return deriveKeyFindings(flow, deriveHandoffs(flow.nodes, flow.edges));
}

describe("deriveKeyFindings", () => {
  test("reports no description separately from nothing found", () => {
    const pending = flowOf([
      node({ id: "a", isBottleneck: true, detailStatus: "pending" }),
    ]);
    expect(findingsOf(pending)).toEqual({ state: "not_described" });

    const quiet = flowOf([node({ id: "a" }), node({ id: "b" })]);
    expect(findingsOf(quiet)).toEqual({ state: "none_reported" });
  });

  test("leads with the bottleneck that has the most pain points", () => {
    const result = findingsOf(
      flowOf([
        node({ id: "a", label: "Intake", isBottleneck: true, painPoints: ["Slow"] }),
        node({
          id: "b",
          label: "Approval",
          isBottleneck: true,
          painPoints: ["Waits for sign-off", "Rework"],
        }),
      ]),
    );
    expect(result.state).toBe("findings");
    if (result.state !== "findings") return;
    expect(result.findings[0]).toEqual({
      kind: "bottleneck",
      title: "Bottleneck: Approval",
      detail: "Waits for sign-off One of 2 reported bottlenecks.",
      nodeId: "b",
    });
  });

  test("picks the most confident recommended automation", () => {
    const result = findingsOf(
      flowOf([node({ id: "a" })], [], {
        automationOpportunitiesSource: "ai",
        automationOpportunityDetails: [
          opportunity({ title: "Low one", confidence: "low", nodeIds: ["a"] }),
          opportunity({
            title: "Strong one",
            confidence: "high",
            nodeIds: ["a"],
            expectedBenefit: "Saves a day per request.",
          }),
        ],
      }),
    );
    if (result.state !== "findings") throw new Error("expected findings");
    expect(result.findings[0]).toMatchObject({
      kind: "automation",
      title: "Automation: Strong one",
      nodeId: "a",
    });
    expect(result.findings[0].detail).toContain("Saves a day per request.");
  });

  test("never leads with automatable-looking steps that were not analysed", () => {
    const result = findingsOf(
      flowOf([node({ id: "a" })], [], {
        automationOpportunitiesSource: "derived",
        automationOpportunityDetails: [opportunity({ nodeIds: ["a"] })],
      }),
    );
    expect(result).toEqual({ state: "none_reported" });
  });

  test("ignores placeholder values on steps nobody described", () => {
    // A pending node carries isBottleneck: false and confidence: "medium"
    // placeholders; a failed one could carry anything. Neither is a finding.
    const result = findingsOf(
      flowOf([
        node({ id: "ok" }),
        node({ id: "x", confidence: "low", detailStatus: "failed" }),
        node({ id: "y", isTribalKnowledge: true, detailStatus: "pending" }),
      ]),
    );
    expect(result).toEqual({ state: "none_reported" });
  });

  test("summarises several weak-evidence steps in one finding", () => {
    const result = findingsOf(
      flowOf([
        node({ id: "a", label: "Intake", confidence: "low" }),
        node({ id: "b", label: "Review", confidence: "low" }),
      ]),
    );
    if (result.state !== "findings") throw new Error("expected findings");
    expect(result.findings).toEqual([
      {
        kind: "weak_evidence",
        title: "Weak evidence: 2 steps",
        detail:
          "Intake and 1 other step are inferred or rest on weak sources. Confirm them in a contribution.",
        nodeId: "a",
      },
    ]);
  });

  test("flags a handoff hotspot only where work changes hands twice or more", () => {
    const single = flowOf(
      [
        node({ id: "a", actors: ["Clerk"] }),
        node({ id: "b", actors: ["Manager"] }),
      ],
      [edge("a", "b")],
    );
    expect(findingsOf(single)).toEqual({ state: "none_reported" });

    const hub = flowOf(
      [
        node({ id: "a", actors: ["Clerk"] }),
        node({ id: "hub", label: "Routing", actors: ["Manager"] }),
        node({ id: "c", actors: ["Finance"] }),
      ],
      [edge("a", "hub"), edge("hub", "c")],
    );
    const result = findingsOf(hub);
    if (result.state !== "findings") throw new Error("expected findings");
    expect(result.findings).toEqual([
      {
        kind: "handoff_hotspot",
        title: "Handoff hotspot: Routing",
        detail: "Work changes hands 2 times around this step.",
        nodeId: "hub",
      },
    ]);
  });

  test("caps the summary and keeps the priority order", () => {
    const result = findingsOf(
      flowOf(
        [
          node({ id: "a", actors: ["Clerk"], isBottleneck: true }),
          node({
            id: "hub",
            actors: ["Manager"],
            isTribalKnowledge: true,
            confidence: "low",
          }),
          node({ id: "c", actors: ["Finance"] }),
        ],
        [edge("a", "hub"), edge("hub", "c")],
        {
          automationOpportunitiesSource: "ai",
          automationOpportunityDetails: [opportunity({ nodeIds: ["c"] })],
        },
      ),
    );
    if (result.state !== "findings") throw new Error("expected findings");
    expect(result.findings).toHaveLength(MAX_KEY_FINDINGS);
    expect(result.findings.map((f) => f.kind)).toEqual([
      "bottleneck",
      "automation",
      "knowledge_risk",
      "weak_evidence",
    ]);
  });
});

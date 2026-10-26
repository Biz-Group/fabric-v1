import { describe, expect, test } from "vitest";
import type { FlowNodeDetail } from "./flowStages";
import {
  compareRecommendations,
  computeRecommendationScores,
  deriveEvidence,
  recommendationMatchKey,
  type ScoringNode,
} from "./recommendationScoring";

function node(
  id: string,
  detail: Partial<FlowNodeDetail> | null,
  category: ScoringNode["category"] = "action",
): ScoringNode {
  return {
    id,
    label: id,
    category,
    detail:
      detail === null
        ? null
        : {
            description: "",
            actors: [],
            tools: [],
            painPoints: [],
            automationPotential: "medium",
            confidence: "medium",
            isBottleneck: false,
            isTribalKnowledge: false,
            riskIndicators: [],
            sources: [],
            ...detail,
          },
  };
}

describe("evidence", () => {
  test("counts distinct interviews and contributors from sources", () => {
    expect(
      deriveEvidence([
        node("a", { sources: ["Alice, Conv. 1", "Bob, Conv. 2"] }),
        node("b", { sources: ["alice, Conv. 1"] }),
        node("c", null),
      ]),
    ).toEqual({ interviews: 2, contributors: 2 });
  });
});

describe("value", () => {
  test("frequent, painful, widely felt work is high value", () => {
    const scores = computeRecommendationScores({
      intervention: "simplify",
      frequency: "daily",
      nodeIds: ["a", "b"],
      nodes: [
        node("a", {
          painPoints: ["Rekeyed by hand", "Waits on approval"],
          isBottleneck: true,
          actors: ["Coordinator", "Manager"],
          sources: ["Alice, Conv. 1"],
        }),
        node("b", {
          painPoints: ["Errors found late"],
          actors: ["Finance"],
          sources: ["Bob, Conv. 2"],
        }),
      ],
    });
    expect(scores.value.level).toBe("high");
    expect(scores.value.reasons).toEqual([
      "Runs daily",
      "3 problems reported, 1 bottleneck",
      "3 roles involved",
    ]);
  });

  test("with neither frequency nor friction, value is unknown rather than guessed", () => {
    const scores = computeRecommendationScores({
      intervention: "standardise",
      frequency: "unknown",
      nodeIds: ["a"],
      nodes: [node("a", { actors: ["Coordinator"] })],
    });
    expect(scores.value.level).toBe("unknown");
  });

  test("an annual process with one complaint is low value", () => {
    const scores = computeRecommendationScores({
      intervention: "standardise",
      frequency: "annual",
      nodeIds: ["a"],
      nodes: [node("a", { painPoints: ["Slow"], actors: ["HR"] })],
    });
    expect(scores.value.level).toBe("low");
  });
});

describe("effort", () => {
  test("removing a step is low effort", () => {
    const scores = computeRecommendationScores({
      intervention: "eliminate",
      frequency: "weekly",
      nodeIds: ["a"],
      nodes: [node("a", { tools: ["Excel", "Email", "Jira"] })],
    });
    expect(scores.effort.level).toBe("low");
    // Systems only add effort to technical changes.
    expect(scores.effort.reasons).toEqual(["Removes a step"]);
  });

  test("an agent across several systems and judgement calls is high effort", () => {
    const scores = computeRecommendationScores({
      intervention: "agent",
      frequency: "weekly",
      nodeIds: ["a", "b"],
      nodes: [
        node("a", { tools: ["Excel", "Email", "Jira"], automationPotential: "low" }),
        node("b", { tools: [] }, "decision"),
      ],
    });
    expect(scores.effort.level).toBe("high");
    expect(scores.effort.reasons).toEqual([
      "Needs an AI agent",
      "Touches 3 systems",
      "1 step needing human judgement",
    ]);
  });
});

describe("effort and judgement", () => {
  test("a workflow around a judgement step is not charged for that judgement", () => {
    const nodes = [node("a", { tools: ["Zendesk"], automationPotential: "low" })];
    const workflow = computeRecommendationScores({
      intervention: "workflow",
      frequency: "daily",
      nodeIds: ["a"],
      nodes,
    });
    const assist = computeRecommendationScores({
      intervention: "ai_assist",
      frequency: "daily",
      nodeIds: ["a"],
      nodes,
    });
    expect(workflow.effort).toEqual({
      level: "medium",
      reasons: ["Needs an automated workflow", "Touches 1 system"],
    });
    expect(assist.effort.reasons).toContain("1 step needing human judgement");
  });
});

describe("people affected", () => {
  test("distinct roles across the covered steps only", () => {
    const scores = computeRecommendationScores({
      intervention: "role_or_policy",
      frequency: "weekly",
      nodeIds: ["a"],
      nodes: [
        node("a", { actors: ["Coordinator", "coordinator", "Manager"] }),
        node("b", { actors: ["Finance"] }),
      ],
    });
    expect(scores.peopleAffected).toEqual(["Coordinator", "Manager"]);
  });
});

describe("ordering and identity", () => {
  const scored = (value: string, effort: string, interviews: number, createdAt = 0) => ({
    scores: {
      value: { level: value as "high", reasons: [] },
      effort: { level: effort as "low", reasons: [] },
      evidence: { interviews, contributors: interviews },
    },
    createdAt,
  });

  test("value first, then the cheaper change, then the better-evidenced one", () => {
    const list = [
      scored("medium", "low", 3),
      scored("high", "high", 1),
      scored("high", "low", 1),
      scored("high", "low", 2),
      scored("unknown", "low", 5),
    ];
    const sorted = [...list].sort(compareRecommendations);
    expect(sorted).toEqual([list[3], list[2], list[1], list[0], list[4]]);
  });

  test("the match key ignores node order and duplicates", () => {
    expect(recommendationMatchKey(["b", "a", "b"], "workflow")).toBe("a,b|workflow");
  });
});

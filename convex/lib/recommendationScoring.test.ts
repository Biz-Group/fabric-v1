import { describe, expect, test } from "vitest";
import type { FlowNodeDetail } from "./flowStages";
import {
  capFollowOnValue,
  capFollowOnValues,
  compareRecommendations,
  computeRecommendationScores,
  FOLLOW_ON_VALUE_REASON,
  deriveEvidence,
  distinctProblems,
  recommendationMatchKey,
  sameProblem,
  type ScoringNode,
} from "./recommendationScoring";

/** Conv. 1 is Alice, Conv. 2 is Bob, Conv. 3 is Alice again. */
const KEYS = [["user:alice"], ["user:bob"], ["user:alice"]];

function score(
  input: Omit<Parameters<typeof computeRecommendationScores>[0], "contributorKeysInOrder">,
) {
  return computeRecommendationScores({ contributorKeysInOrder: KEYS, ...input });
}

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
      deriveEvidence(
        [
          node("a", { sources: ["Alice, Conv. 1", "Bob, Conv. 2"] }),
          node("b", { sources: ["alice, Conv. 1"] }),
          node("c", null),
        ],
        KEYS,
      ),
    ).toEqual({ interviews: 2, contributors: 2 });
  });

  test("people come from the contribution records, not the names written in sources", () => {
    // Five spellings over two interviews with one person.
    const evidence = deriveEvidence(
      [
        node("a", { sources: ["Alice, Conv. 1", "A. Smith, Conv. 3"] }),
        node("b", { sources: ["Alice Smith, Conv. 1", "Ali, Conv. 3", "Al"] }),
      ],
      KEYS,
    );
    expect(evidence).toEqual({ interviews: 2, contributors: 1 });
  });

  test("contributors never exceed contributions for one-person interviews", () => {
    const evidence = deriveEvidence(
      [node("a", { sources: ["X, Conv. 1", "Y, Conv. 1", "Z, Conv. 2"] })],
      KEYS,
    );
    expect(evidence.contributors).toBeLessThanOrEqual(evidence.interviews);
  });
});

describe("near-identical problems", () => {
  test("rewordings of one complaint are the same problem", () => {
    expect(
      sameProblem(
        "No formal checklist exists for which follow-up questions to ask clients; the approach is based on accumulated experience and instinct",
        "Context-gathering approach learned through experience, not formal checklist",
      ),
    ).toBe(true);
    expect(
      sameProblem(
        "Massive time difference between Dubai and Canada causes delays in ticket resolution",
        "Time zone difference between working hours of Bizgroup and Axonify Canada extends resolution cycles through multiple back-and-forth cycles",
      ),
    ).toBe(true);
  });

  test("different problems stay apart", () => {
    expect(
      sameProblem(
        "No formal checklist exists for which follow-up questions to ask clients",
        "Client-specific knowledge is purely in memory, causing problems when the lead is on leave",
      ),
    ).toBe(false);
  });

  test("short texts merge only when identical", () => {
    expect(sameProblem("Slow", "slow")).toBe(true);
    expect(sameProblem("Slow approvals", "Slow invoices")).toBe(false);
  });

  test("one complaint repeated on three steps counts once", () => {
    const problems = distinctProblems([
      node("a", { painPoints: ["Time zone delays extend investigation cycles"] }),
      node("b", { painPoints: ["Time zone delays between Dubai and Canada slow communication cycles"] }),
      node("c", {
        painPoints: [
          "Time zone delays extend investigation cycles",
          "Updates arrive without the ticket history",
        ],
      }),
    ]);
    expect(problems).toHaveLength(2);
  });
});

describe("value cap", () => {
  const painful = [
    node("a", {
      painPoints: ["Rekeyed by hand", "Waits on approval"],
      isBottleneck: true,
      actors: ["Coordinator", "Manager"],
      sources: ["Alice, Conv. 1"],
    }),
    node("b", {
      painPoints: ["Errors found late"],
      actors: ["Finance"],
      sources: ["Alice, Conv. 3"],
    }),
  ];

  test("one contributor cannot make value high", () => {
    const scores = score({
      intervention: "simplify",
      frequency: "daily",
      nodeIds: ["a", "b"],
      nodes: painful,
    });
    expect(scores.value.level).toBe("medium");
    expect(scores.value.reasons).toContain("One contributor so far");
  });

  test("unknown frequency cannot make value high", () => {
    const scores = score({
      intervention: "simplify",
      frequency: "unknown",
      nodeIds: ["a", "b"],
      nodes: painful.map((n, i) =>
        i === 1 ? node("b", { ...n.detail!, sources: ["Bob, Conv. 2"] }) : n,
      ),
    });
    expect(scores.value.level).toBe("medium");
    expect(scores.value.reasons[0]).toBe("How often it runs wasn't described");
  });
});

describe("follow-on value", () => {
  const high = { level: "high" as const, reasons: ["Runs monthly", "3 problems reported, 2 bottlenecks", "3 roles involved"] };
  const medium = { level: "medium" as const, reasons: ["Runs monthly"] };
  const low = { level: "low" as const, reasons: ["Runs as needed"] };
  const unknown = { level: "unknown" as const, reasons: ["How often it runs wasn't described"] };

  test("a follow-on on its parent's steps drops one level below the parent, and says why", () => {
    // The Aldar case: same steps, same chips, so the same "high" as its parent.
    const capped = capFollowOnValue(high, high);
    expect(capped.level).toBe("medium");
    expect(capped.reasons).toEqual([...high.reasons, FOLLOW_ON_VALUE_REASON]);
    expect(capFollowOnValue(medium, medium).level).toBe("low");
  });

  test("a follow-on already below the ceiling keeps its own score", () => {
    expect(capFollowOnValue(medium, high)).toEqual(medium);
    expect(capFollowOnValue(low, medium)).toEqual(low);
    expect(capFollowOnValue(low, low)).toEqual(low);
  });

  test("unknown on either side leaves the follow-on alone", () => {
    expect(capFollowOnValue(unknown, high)).toEqual(unknown);
    expect(capFollowOnValue(high, unknown)).toEqual(high);
  });

  test("capping twice does not repeat the reason", () => {
    const once = capFollowOnValue(high, high);
    expect(capFollowOnValue(once, high)).toEqual(once);
  });

  test("across a run, only follow-ons are capped, and a chain never outranks its root", () => {
    const rows = [{ value: high }, { value: high }, { value: high }, { value: medium }];
    const parents = [null, 0, 1, 7];
    const capped = capFollowOnValues(rows, (index) => parents[index]);
    expect(capped.map((row) => row.value.level)).toEqual(["high", "medium", "low", "medium"]);
    expect(rows[1].value.level).toBe("high");
  });

  test("a cycle of links terminates", () => {
    const capped = capFollowOnValues([{ value: high }, { value: high }], (index) => (index === 0 ? 1 : 0));
    expect(capped).toHaveLength(2);
  });
});

describe("value", () => {
  test("frequent, painful, widely felt work is high value", () => {
    const scores = score({
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
    const scores = score({
      intervention: "standardise",
      frequency: "unknown",
      nodeIds: ["a"],
      nodes: [node("a", { actors: ["Coordinator"] })],
    });
    expect(scores.value.level).toBe("unknown");
  });

  test("an annual process with one complaint is low value", () => {
    const scores = score({
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
    const scores = score({
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
    const scores = score({
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
    const workflow = score({
      intervention: "workflow",
      frequency: "daily",
      nodeIds: ["a"],
      nodes,
    });
    const assist = score({
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
    const scores = score({
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

import { describe, expect, test } from "vitest";
import { deriveEvidence } from "./lib/recommendationScoring";
import { recommendationContributorKeys } from "./recommendations";

/**
 * Consultative follow-up: "Conv. N" in step sources numbers the contributions
 * the flow was built from. When that set has changed, a rerun on the old flow
 * must not count people it cannot tell apart.
 */

const alice = { contributorName: "Alice", userId: "user_alice" };
const bob = { contributorName: "Bob", userId: "user_bob" };
const carol = { contributorName: "Carol", userId: "user_carol" };

const node = (sources: string[]) => ({
  id: "n",
  label: "Step",
  category: "action" as const,
  detail: {
    description: "",
    actors: [],
    tools: [],
    painPoints: [],
    automationPotential: "low" as const,
    confidence: "medium" as const,
    isBottleneck: false,
    isTribalKnowledge: false,
    riskIndicators: [],
    sources,
  },
});

describe("recommendationContributorKeys", () => {
  test("unchanged contributions keep each person", () => {
    const keys = recommendationContributorKeys([alice, bob], 2);
    expect(deriveEvidence([node(["Alice, Conv. 1", "Bob, Conv. 2"])], keys)).toEqual({
      interviews: 2,
      contributors: 2,
    });
  });

  test("a contribution added since the flow was built claims one person", () => {
    const keys = recommendationContributorKeys([alice, bob, carol], 2);
    expect(deriveEvidence([node(["Alice, Conv. 1", "Bob, Conv. 2"])], keys)).toEqual({
      interviews: 2,
      contributors: 1,
    });
  });

  test("a contribution removed since then claims one person, and no reference beyond the flow resolves", () => {
    const keys = recommendationContributorKeys([alice], 2);
    expect(keys).toHaveLength(2);
    expect(
      deriveEvidence([node(["Alice, Conv. 1", "Bob, Conv. 2", "Carol, Conv. 3"])], keys),
    ).toEqual({ interviews: 2, contributors: 1 });
  });
});

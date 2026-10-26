import { describe, expect, test } from "vitest";
import {
  planReconciliation,
  type StoredRecommendation,
} from "./recommendationReconcile";

function stored(
  id: string,
  matchKey: string,
  decisionStatus: StoredRecommendation["decisionStatus"] = "new",
  lifecycle: StoredRecommendation["lifecycle"] = "active",
): StoredRecommendation {
  return { id, matchKey, decisionStatus, lifecycle };
}

describe("reconciliation across regenerations", () => {
  test("a renamed recommendation keeps its identity through the model's id", () => {
    // Node ids churned on regeneration, so the key no longer matches.
    const plan = planReconciliation(
      [stored("r1", "approve,route|workflow", "shortlisted")],
      [{ matchKey: "approval,routing|workflow", previousRecommendationId: "r1" }],
    );
    expect(plan.matches).toEqual(["r1"]);
    expect(plan.unmatched).toEqual([]);
  });

  test("without an id, an exact key match keeps identity", () => {
    const plan = planReconciliation(
      [stored("r1", "a,b|simplify", "in_progress")],
      [{ matchKey: "a,b|simplify" }],
    );
    expect(plan.matches).toEqual(["r1"]);
  });

  test("an id the model invented, or one from another process, is ignored", () => {
    const plan = planReconciliation(
      [stored("r1", "a|simplify")],
      [{ matchKey: "z|agent", previousRecommendationId: "not-ours" }],
    );
    expect(plan.matches).toEqual([null]);
  });

  test("a split keeps identity for one half and creates the other", () => {
    const plan = planReconciliation(
      [stored("r1", "a,b|workflow", "shortlisted")],
      [
        { matchKey: "a|workflow", previousRecommendationId: "r1" },
        { matchKey: "b|training", previousRecommendationId: "r1" },
      ],
    );
    // One stored row can only be claimed once.
    expect(plan.matches).toEqual(["r1", null]);
  });

  test("a merge keeps one identity and lets the other go", () => {
    const plan = planReconciliation(
      [stored("r1", "a|workflow", "shortlisted"), stored("r2", "b|workflow")],
      [{ matchKey: "a,b|workflow", previousRecommendationId: "r1" }],
    );
    expect(plan.matches).toEqual(["r1"]);
    expect(plan.unmatched).toEqual([{ id: "r2", lifecycle: "superseded" }]);
  });

  test("a vouched-for id is not stolen by another row's key match", () => {
    const plan = planReconciliation(
      [stored("r1", "a|simplify")],
      [
        { matchKey: "a|simplify" },
        { matchKey: "x|simplify", previousRecommendationId: "r1" },
      ],
    );
    expect(plan.matches).toEqual([null, "r1"]);
  });

  test("a removed recommendation someone decided about stays visible; an untouched one does not", () => {
    const plan = planReconciliation(
      [
        stored("decided", "a|simplify", "dismissed"),
        stored("untouched", "b|simplify", "new"),
      ],
      [],
    );
    expect(plan.unmatched).toEqual([
      { id: "decided", lifecycle: "absent_from_latest" },
      { id: "untouched", lifecycle: "superseded" },
    ]);
  });

  test("a recommendation absent last time can come back, and stays absent otherwise", () => {
    const back = planReconciliation(
      [stored("r1", "a|simplify", "dismissed", "absent_from_latest")],
      [{ matchKey: "a|simplify" }],
    );
    expect(back.matches).toEqual(["r1"]);

    const still = planReconciliation(
      [stored("r1", "a|simplify", "dismissed", "absent_from_latest")],
      [],
    );
    expect(still.unmatched).toEqual([]);
  });
});

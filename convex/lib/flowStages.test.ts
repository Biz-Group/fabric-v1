import { describe, expect, test } from "vitest";
import { evidenceConfidence } from "./flowStages";

/** Task 1.5: step confidence is decided by the people behind the step. */
describe("evidenceConfidence", () => {
  // Conv. 1 and Conv. 2 are the same person; Conv. 3 is someone else.
  const conversations = [
    { contributorKeys: ["user:alice"] },
    { contributorKeys: ["user:alice"] },
    { contributorKeys: ["user:ben"] },
  ];

  test("a model's 'high' from one person becomes medium", () => {
    expect(
      evidenceConfidence("high", ["Alice, Conv. 1", "Alice, Conv. 2"], conversations),
    ).toBe("medium");
  });

  test("two people make a step high, whatever the model said", () => {
    expect(
      evidenceConfidence("medium", ["Alice, Conv. 1", "Ben, Conv. 3"], conversations),
    ).toBe("high");
  });

  test("the model's 'inferred' rating is kept", () => {
    expect(
      evidenceConfidence("low", ["Alice, Conv. 1", "Ben, Conv. 3"], conversations),
    ).toBe("low");
  });

  test("sources that resolve to no contribution are no evidence", () => {
    expect(evidenceConfidence("high", ["Alice", "Zed, Conv. 9"], conversations)).toBe(
      "low",
    );
  });

  test("a start or end marker with no sources is not weak evidence", () => {
    expect(evidenceConfidence("high", [], conversations, "end")).toBe("medium");
    expect(evidenceConfidence("high", [], conversations, "start")).toBe("medium");
    expect(evidenceConfidence("high", [], conversations, "action")).toBe("low");
  });

  test("a group recording with two labelled speakers is two people", () => {
    expect(
      evidenceConfidence("medium", ["Workshop, Conv. 1"], [
        { contributorKeys: ["user:carla", "name:dev"] },
      ]),
    ).toBe("high");
  });
});

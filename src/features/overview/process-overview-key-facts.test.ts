import { describe, expect, it } from "vitest";
import type { OverviewFinding } from "./overview-primitives";
import { findingAnchorId, processKeyFacts } from "./process-overview-key-facts";

function finding(id: string, title = `Title ${id}`): OverviewFinding {
  return {
    id,
    title,
    body: `Body ${id}`,
    evidenceLevel: "single_source",
    supportCount: 1,
    sources: [],
  };
}

describe("processKeyFacts", () => {
  it("shows scope findings as written, then the first open question", () => {
    const facts = processKeyFacts({
      scope: [finding("trigger", "What starts it"), finding("done")],
      gaps: [finding("threshold", "Threshold is unconfirmed"), finding("other")],
    });

    expect(facts.map((fact) => [fact.kind, fact.label, fact.text])).toEqual([
      ["scope", "What starts it", "Body trigger"],
      ["scope", "Title done", "Body done"],
      ["open_question", "Open question", "Threshold is unconfirmed"],
    ]);
  });

  it("caps scope facts at four so the strip stays shorter than the brief", () => {
    const facts = processKeyFacts({
      scope: Array.from({ length: 6 }, (_, index) => finding(`s${index}`)),
      gaps: [],
    });

    expect(facts).toHaveLength(4);
  });

  it("points each fact at its finding row", () => {
    const [fact] = processKeyFacts({ scope: [finding("trigger")], gaps: [] });

    expect(fact.targetId).toBe(findingAnchorId("process-scope", "trigger"));
  });

  it("returns nothing when the evidence establishes no scope or gap", () => {
    expect(processKeyFacts({ scope: [], gaps: [] })).toEqual([]);
  });
});

describe("findingAnchorId", () => {
  it("keeps model-written ids safe to use as DOM ids", () => {
    expect(findingAnchorId("process-scope", "scope: trigger #1")).toBe(
      "process-scope-finding-scope--trigger--1",
    );
  });
});

import { describe, expect, test } from "vitest";
import { effectiveOpportunityConfidence } from "./opportunity-confidence";

describe("effectiveOpportunityConfidence", () => {
  test("caps high at medium when one contributor supports it", () => {
    expect(effectiveOpportunityConfidence("high", 1)).toEqual({
      level: "medium",
      capped: true,
    });
  });

  test("caps high when no contributor is counted", () => {
    expect(effectiveOpportunityConfidence("high", 0)).toEqual({
      level: "medium",
      capped: true,
    });
  });

  test("keeps high with more than one contributor", () => {
    expect(effectiveOpportunityConfidence("high", 2)).toEqual({
      level: "high",
      capped: false,
    });
  });

  test("keeps high when the contributor count is unknown", () => {
    expect(effectiveOpportunityConfidence("high", undefined)).toEqual({
      level: "high",
      capped: false,
    });
  });

  test("never raises or lowers medium and low", () => {
    expect(effectiveOpportunityConfidence("medium", 1)).toEqual({
      level: "medium",
      capped: false,
    });
    expect(effectiveOpportunityConfidence("low", 1)).toEqual({
      level: "low",
      capped: false,
    });
  });
});

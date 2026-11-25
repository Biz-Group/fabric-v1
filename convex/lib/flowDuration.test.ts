import { describe, expect, it } from "vitest";
import { cleanEstimatedDuration } from "./flowDuration";

describe("cleanEstimatedDuration", () => {
  it.each([
    undefined,
    null,
    "",
    "   ",
    "<UNKNOWN>",
    "unknown",
    "[N/A]",
    "n/a",
    "(none)",
    "Not specified",
    "not stated.",
    "TBD",
    "-",
  ])("treats %p as no duration", (value) => {
    expect(cleanEstimatedDuration(value)).toBeUndefined();
  });

  it.each([
    ["2-3 days", "2-3 days"],
    ["  About 4 hours ", "About 4 hours"],
    ["Unknown hand-off delays add ~2 days", "Unknown hand-off delays add ~2 days"],
    [5, "5"],
  ])("keeps %p", (value, expected) => {
    expect(cleanEstimatedDuration(value)).toBe(expected);
  });
});

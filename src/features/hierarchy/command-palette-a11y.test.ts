import { describe, expect, it } from "vitest";
import {
  groupConsecutive,
  moveHighlight,
  resultCountMessage,
} from "./command-palette-a11y";

describe("resultCountMessage", () => {
  it("says no results, one result, or a plural count", () => {
    expect(resultCountMessage(0)).toBe("No results");
    expect(resultCountMessage(1)).toBe("1 result");
    expect(resultCountMessage(5)).toBe("5 results");
  });
});

describe("groupConsecutive", () => {
  it("groups runs of the same kind and keeps flat indices", () => {
    const items = [
      { kind: "function", id: "f1" },
      { kind: "function", id: "f2" },
      { kind: "department", id: "d1" },
      { kind: "process", id: "p1" },
      { kind: "process", id: "p2" },
    ];
    const groups = groupConsecutive(items);
    expect(groups.map((g) => g.kind)).toEqual([
      "function",
      "department",
      "process",
    ]);
    expect(groups.map((g) => g.entries.map((e) => e.index))).toEqual([
      [0, 1],
      [2],
      [3, 4],
    ]);
    expect(groups[2].entries[1].item.id).toBe("p2");
  });

  it("returns no groups for no items", () => {
    expect(groupConsecutive([])).toEqual([]);
  });
});

describe("moveHighlight", () => {
  it("moves and wraps in both directions", () => {
    expect(moveHighlight(0, 1, 3)).toBe(1);
    expect(moveHighlight(2, 1, 3)).toBe(0);
    expect(moveHighlight(0, -1, 3)).toBe(2);
    expect(moveHighlight(1, -1, 3)).toBe(0);
  });

  it("starts from the ends when nothing is highlighted", () => {
    expect(moveHighlight(-1, 1, 3)).toBe(0);
    expect(moveHighlight(-1, -1, 3)).toBe(2);
  });

  it("returns -1 for an empty list", () => {
    expect(moveHighlight(0, 1, 0)).toBe(-1);
  });
});

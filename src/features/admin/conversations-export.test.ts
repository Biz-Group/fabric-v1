import { describe, expect, test } from "vitest";
import { csvCell } from "../../../convex/lib/csv";
import { buildConversationsCsv } from "./conversations-export";

describe("csvCell", () => {
  test.each([
    ["=HYPERLINK(\"https://evil\",\"x\")", "\"'=HYPERLINK(\"\"https://evil\"\",\"\"x\"\")\""],
    ["+cmd", "'+cmd"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tTab", "'\tTab"],
    ["\rCR", "\"'\rCR\""],
  ])("neutralises a leading formula character: %j", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  test("still quotes commas, quotes and newlines, and leaves plain text alone", () => {
    expect(csvCell("a, b")).toBe("\"a, b\"");
    expect(csvCell("say \"hi\"")).toBe("\"say \"\"hi\"\"\"");
    expect(csvCell("two\nlines")).toBe("\"two\nlines\"");
    expect(csvCell("Finance")).toBe("Finance");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

test("the contributions export guards member-controlled text", () => {
  const row = {
    _id: "c1",
    _creationTime: 0,
    contributorName: "=HYPERLINK(\"https://evil\")",
    processName: "@risk",
    status: "done",
  } as unknown as Parameters<typeof buildConversationsCsv>[0][number];
  const [, line] = buildConversationsCsv([row]).split("\n");
  expect(line).toContain("\"'=HYPERLINK(\"\"https://evil\"\")\"");
  expect(line).toContain(",'@risk,");
});

import { describe, expect, test } from "vitest";
import { estimateTokens } from "../askTools/results";
import {
  HISTORY_MAX_TOKENS,
  TOC_MAX_TOKENS,
  buildHistoryMessages,
  buildTableOfContents,
  displayNote,
  perTurnContextText,
  tableOfContentsIds,
  type TocFunction,
} from "./context";

function org(processesPerDepartment: number, headline = "A headline about how this process runs today."): TocFunction[] {
  return Array.from({ length: 3 }, (_, f) => ({
    id: `fn${f}`,
    name: `Function ${f}`,
    departments: Array.from({ length: 4 }, (_, d) => ({
      id: `dept${f}_${d}`,
      name: `Department ${f}.${d}`,
      processes: Array.from({ length: processesPerDepartment }, (_, p) => ({
        id: `proc${f}_${d}_${p}`,
        name: `Process ${f}.${d}.${p}`,
        headline,
        generatedAt: f * 1_000 + d * 100 + p,
      })),
    })),
  }));
}

describe("tenant table of contents (FR-2.6)", () => {
  test("is byte-stable for unchanged data and lists every id", () => {
    const first = buildTableOfContents(org(3));
    expect(buildTableOfContents(org(3))).toBe(first);
    expect(first).toContain("Process: Process 2.3.2 [proc2_3_2] — A headline");
    expect(first).toContain("not instructions");
  });

  test("adds headlines most recent first until the 8K cap", () => {
    const toc = buildTableOfContents(org(40, "x".repeat(300)));
    expect(estimateTokens(toc)).toBeLessThanOrEqual(TOC_MAX_TOKENS);
    // The newest process (function 2, department 3) keeps its headline; the oldest loses it.
    expect(toc).toMatch(/Process 2\.3\.39 \[proc2_3_39\] — x/);
    expect(toc).toMatch(/Process 0\.0\.0 \[proc0_0_0\]\n/);
  });

  test("lists the ids it shows, which ground a display (D56)", () => {
    const ids = tableOfContentsIds(buildTableOfContents(org(1)));
    expect(ids).toContain("fn0");
    expect(ids).toContain("dept2_3");
    expect(ids).toContain("proc1_2_0");
    // A department reduced to a count lists no process ids.
    const counted = tableOfContentsIds(buildTableOfContents(org(700, "")));
    expect(counted).toContain("dept0_0");
    expect(counted.some((id) => id.startsWith("proc"))).toBe(false);
  });

  test("falls back to process counts when names alone pass the cap", () => {
    const toc = buildTableOfContents(org(700, ""));
    expect(estimateTokens(toc)).toBeLessThanOrEqual(TOC_MAX_TOKENS);
    expect(toc).toContain("Department: Department 0.0 [dept0_0] (700 processes)");
    expect(toc).not.toContain("Process:");
  });
});

describe("history and per-turn context (FR-2.7)", () => {
  test("replays text only and drops the oldest turns past the cap", () => {
    const big = "w".repeat(HISTORY_MAX_TOKENS * 4);
    const messages = buildHistoryMessages([
      { user: big, assistant: "old answer" },
      { user: "Recent question", assistant: "Recent answer[[cite:1]]" },
      { user: "Stopped question", assistant: null },
    ]) as Array<{ role: string; content: string }>;
    expect(messages.map((m) => m.content)).toEqual([
      "Recent question",
      "Recent answer[[cite:1]]",
      "Stopped question",
      "(This answer did not finish.)",
    ]);
  });

  test("notes what an earlier answer showed, after its text (D56)", () => {
    const messages = buildHistoryMessages([
      { user: "Which processes?", assistant: "Three stand out.", shown: ["[Shown: 2 process cards: A [p1], B [p2]]"] },
      { user: "Stopped", assistant: null, shown: ["[Shown: x]"] },
    ]) as Array<{ role: string; content: string }>;
    expect(messages[1].content).toBe("Three stand out.\n\n[Shown: 2 process cards: A [p1], B [p2]]");
    expect(messages[3].content).toBe("(This answer did not finish.)\n\n[Shown: x]");
  });

  test("describes each component by kind and the names it showed", () => {
    const refs = (kind: string, n: number) => Array.from({ length: n }, () => ({ kind }));
    expect(displayNote({ display: "entities", refs: refs("process", 2) }, ["A", "B"])).toBe("[Shown: 2 process cards: A, B]");
    expect(displayNote({ display: "entities", refs: refs("department", 1) }, ["Payroll"])).toBe("[Shown: 1 department card: Payroll]");
    expect(displayNote({ display: "entities", refs: [{ kind: "process" }, { kind: "function" }] }, ["A", "F"])).toBe(
      "[Shown: 2 cards: A, F]",
    );
    expect(displayNote({ display: "chart", refs: [], chartId: "signalsByProcess" }, [])).toBe(
      "[Shown: the signalsByProcess chart for the organization]",
    );
    expect(displayNote({ display: "flow", refs: refs("process", 1), nodeId: "n3" }, ["Payroll"])).toContain("step n3");
    // Nothing readable left: nothing to say.
    expect(displayNote({ display: "entities", refs: refs("process", 2) }, [])).toBeNull();
    expect(displayNote({ display: "somethingNew", refs: [] }, [])).toBeNull();
  });

  test("states date, role, placement, page and mentions as Fabric's context", () => {
    const text = perTurnContextText({
      today: "2026-11-03",
      role: "viewer",
      placement: { department: "Payroll", function: "Finance" },
      contextRef: { kind: "process", id: "p1", name: "Monthly payroll" },
      mentions: [{ kind: "department", id: "d1", name: "Treasury" }],
    });
    expect(text).toContain("not written by the user");
    expect(text).toContain("Today is 2026-11-03.");
    expect(text).toContain("Payroll department (Finance)");
    expect(text).toContain('process "Monthly payroll" [p1]');
    expect(text).toContain('department "Treasury" [d1]');
  });
});

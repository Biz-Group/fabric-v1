import { describe, expect, test } from "vitest";
import type { AskMessagePart } from "../../../convex/lib/askSchema";
import { citationTarget, evidenceSummary, groupSources, sourceKind, type CitationView } from "./citation-links";
import { threadSections, threadTime } from "./thread-groups";
import { askAboutHref, parseContextParam } from "./ask-context";
import {
  answerText,
  copyableAnswer,
  displayParts,
  errorMessage,
  markersToLinks,
  statusLine,
  traceDefaultOpen,
  traceHeader,
  traceSteps,
} from "./trace-view-model";

const ROUTES = { appHref: "/biz-group", adminUsersHref: "/biz-group/admin/users" };
const PATH = { fn: "f1", dept: "d1", proc: "p1" };

function cite(source: string, overrides: Partial<CitationView> = {}): CitationView {
  return { ordinal: 1, source, availability: "available", path: PATH, title: "t", citedText: "x", ...overrides };
}

describe("citation links (FR-5.2)", () => {
  test.each([
    ["fabric:finding/process/p1/gap-1", "/biz-group?fn=f1&dept=d1&proc=p1&finding=gap-1"],
    ["fabric:finding/department/d1/f-2", "/biz-group?fn=f1&dept=d1&finding=f-2"],
    ["fabric:finding/function/f1/f-3", "/biz-group?fn=f1&finding=f-3"],
    ["fabric:overview/process/p1", "/biz-group?fn=f1&dept=d1&proc=p1"],
    ["fabric:entity/department/d1", "/biz-group?fn=f1&dept=d1"],
    ["fabric:entity/function/f1", "/biz-group?fn=f1"],
    ["fabric:entity/org", "/biz-group"],
    ["fabric:flow-node/p1/escalate-a", "/biz-group?fn=f1&dept=d1&proc=p1&tab=flow&node=escalate-a"],
    ["fabric:conversation/p1/c1", "/biz-group?fn=f1&dept=d1&proc=p1&tab=conversations&conv=c1"],
    ["fabric:conversation/p1/c1?t=125&line=14", "/biz-group?fn=f1&dept=d1&proc=p1&tab=conversations&conv=c1&t=125&line=14"],
    ["fabric:members/process/p1", "/biz-group/admin/users"],
  ])("%s → %s", (source, href) => {
    expect(citationTarget(cite(source), ROUTES)).toEqual({ kind: "link", href });
  });

  test("help opens the help dialog", () => {
    expect(citationTarget(cite("fabric:help/label-speakers"), ROUTES)).toEqual({ kind: "help", articleId: "label-speakers" });
  });

  test("an updated finding or step links to its entity instead", () => {
    expect(citationTarget(cite("fabric:finding/process/p1/gap-1", { availability: "updated" }), ROUTES)).toEqual({
      kind: "link",
      href: "/biz-group?fn=f1&dept=d1&proc=p1",
    });
    expect(citationTarget(cite("fabric:flow-node/p1/n", { availability: "updated" }), ROUTES)).toEqual({
      kind: "link",
      href: "/biz-group?fn=f1&dept=d1&proc=p1&tab=flow",
    });
  });

  test("an unavailable source, a broken path or a foreign source has no link", () => {
    expect(citationTarget(cite("fabric:entity/process/p1", { availability: "unavailable" }), ROUTES)).toEqual({ kind: "none" });
    expect(citationTarget(cite("fabric:entity/process/p1", { path: { fn: "f1", dept: null, proc: null } }), ROUTES)).toEqual({ kind: "none" });
    expect(citationTarget(cite("https://example.com"), ROUTES)).toEqual({ kind: "none" });
  });

  test("groups sources by entity in first-cited order", () => {
    const groups = groupSources([
      cite("fabric:flow-node/p1/a", { ordinal: 2 }),
      cite("fabric:finding/process/p1/g", { ordinal: 1 }),
      cite("fabric:entity/org", { ordinal: 3 }),
    ]);
    expect(groups.map((g) => [g.key, g.citations.map((c) => c.ordinal)])).toEqual([
      ["process:p1", [1, 2]],
      ["org:org", [3]],
    ]);
  });

  test("labels a group of different results by its first and a count", () => {
    const groups = groupSources([
      cite("fabric:flow-node/p1/a", { ordinal: 1, title: "bottleneck: Escalate" }),
      cite("fabric:flow-node/p1/b", { ordinal: 2, title: "friction: No checklist" }),
      cite("fabric:flow-node/p1/c", { ordinal: 3, title: "friction: Memory" }),
      cite("fabric:entity/org", { ordinal: 4, title: "Coverage" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["bottleneck: Escalate and 2 more", "Coverage"]);
  });
});

const reasoning = (text: string, startedAt: number, endedAt?: number): AskMessagePart => ({
  type: "reasoning",
  text,
  startedAt,
  ...(endedAt !== undefined ? { endedAt } : {}),
});
const tool = (label: string, status: "running" | "done" | "failed", startedAt: number, endedAt?: number): AskMessagePart => ({
  type: "tool",
  name: "getCoverage",
  status,
  label,
  startedAt,
  ...(endedAt !== undefined ? { endedAt, resultCount: 3 } : {}),
});

describe("Ask about this links (2B.1)", () => {
  test("round-trip a context, and ignore anything malformed", () => {
    const href = askAboutHref("/biz-group/ask", { kind: "process", id: "k57abc" });
    expect(href).toBe("/biz-group/ask?context=process%3Ak57abc");
    expect(parseContextParam(new URLSearchParams(href.split("?")[1]).get("context"))).toEqual({ kind: "process", id: "k57abc" });
    expect(parseContextParam("department:d1")).toEqual({ kind: "department", id: "d1" });
    for (const bad of [null, "", "process", "org:x", "process:", "process:a/b", `process:${"x".repeat(65)}`]) {
      expect(parseContextParam(bad), String(bad)).toBeNull();
    }
  });
});

describe("thought trace (FR-2.15)", () => {
  test("shows Thinking… first, then the active step", () => {
    expect(statusLine([], "streaming")).toBe("Thinking…");
    expect(statusLine([reasoning("I'll read the overviews first. Then rank.", 0)], "streaming")).toBe(
      "I'll read the overviews first.",
    );
    expect(statusLine([tool("Checking coverage across the organization", "running", 0)], "streaming")).toBe(
      "Checking coverage across the organization…",
    );
    expect(statusLine([tool("Checking coverage across the organization", "done", 0, 1)], "streaming")).toBe(
      "Reading what it found…",
    );
  });

  test("a long wait before the first step says what is true at each stage", () => {
    expect(statusLine([], "streaming", 2_000)).toBe("Thinking…");
    expect(statusLine([], "streaming", 12_000)).toBe("Working out where to look…");
    expect(statusLine([], "streaming", 25_000)).toBe("Still working. Some answers take up to a minute…");
    // Once a step exists, it shows instead, however long the wait.
    expect(statusLine([reasoning("Reading the overviews.", 0)], "streaming", 25_000)).toBe("Reading the overviews.");
  });

  test("the status line goes once the answer starts or the turn ends", () => {
    expect(statusLine([{ type: "text", text: "Answer" }], "streaming")).toBeNull();
    expect(statusLine([reasoning("x", 0, 1)], "complete")).toBeNull();
  });

  test("steps carry status and duration; a tool left running on a finished turn failed", () => {
    const parts = [reasoning("Plan", 1_000, 2_000), tool("Reading overviews", "done", 2_000, 2_500), tool("Ranking", "running", 2_500)];
    expect(traceSteps(parts, "streaming").map((s) => [s.kind, s.status, s.durationMs])).toEqual([
      ["reasoning", "done", 1_000],
      ["tool", "done", 500],
      ["tool", "active", null],
    ]);
    expect(traceSteps(parts, "stopped")[2].status).toBe("failed");
  });

  test("a display part is never read as a trace step (D56)", () => {
    const display: AskMessagePart = { type: "display", display: "entities", refs: [] };
    const parts = [tool("Reading overviews", "done", 0, 1_000), display];
    expect(statusLine(parts, "streaming")).toBe("Reading what it found…");
    expect(traceSteps(parts, "complete")).toHaveLength(1);
    expect(traceHeader(parts, "complete", 3_000)).toBe("Thought for 3s · 1 step");
    expect(displayParts([...parts, { type: "text", text: "A" }])).toEqual([display]);
    // A part kind this page has never heard of (a newer backend's) is ignored too.
    const unknown = { type: "somethingNew" } as unknown as AskMessagePart;
    expect(statusLine([unknown], "streaming")).toBe("Thinking…");
    expect(traceSteps([unknown], "complete")).toEqual([]);
  });

  test("the header folds to Thought for … or Stopped after …", () => {
    const parts = [reasoning("Plan", 1_000, 2_000), tool("Reading", "done", 2_000, 13_400), { type: "text", text: "A" } as AskMessagePart];
    expect(traceHeader(parts, "streaming", null)).toBe("Working…");
    expect(traceHeader(parts, "complete", 20_000)).toBe("Thought for 19s · 2 steps");
    expect(traceHeader([reasoning("Plan", 0, 3_900)], "stopped", null)).toBe("Stopped after 4s");
  });

  test("the trace is open while working and folds when text begins", () => {
    expect(traceDefaultOpen([reasoning("x", 0)], "streaming")).toBe(true);
    expect(traceDefaultOpen([reasoning("x", 0), { type: "text", text: "A" }], "streaming")).toBe(false);
    expect(traceDefaultOpen([reasoning("x", 0, 1)], "complete")).toBe(false);
  });

  test("answer text, citation markers and error copy", () => {
    expect(answerText([reasoning("x", 0), { type: "text", text: "Hi" }])).toBe("Hi");
    expect(markersToLinks("Slow[[cite:1]][[cite:12]].")).toBe("Slow[1](cite:1)[12](cite:12).");
    expect(errorMessage("busy")).toBe("AskFabric is busy. Try again in a minute.");
    expect(errorMessage("nonsense")).toBe("Something went wrong. Try again.");
  });

  test("a copied answer keeps its numbers and lists the sources they point to", () => {
    const citations = [
      { ordinal: 2, title: "Payroll flow" },
      { ordinal: 1, title: "Finance overview" },
      { ordinal: 3, title: "Not cited" },
    ];
    expect(copyableAnswer("Slow[[cite:1]] and manual.[[cite:2]]", citations)).toBe(
      "Slow[1] and manual.[2]\n\nSources\n[1] Finance overview\n[2] Payroll flow",
    );
    expect(copyableAnswer("No sources.", [])).toBe("No sources.");
  });
});

describe("evidence line", () => {
  test("names the kind of thing each source is", () => {
    expect(sourceKind("fabric:finding/process/p1/gap-1")).toBe("process");
    expect(sourceKind("fabric:overview/department/d1")).toBe("department");
    expect(sourceKind("fabric:entity/function/f1")).toBe("function");
    expect(sourceKind("fabric:flow-node/p1/n4")).toBe("flow");
    expect(sourceKind("fabric:conversation/p1/c1?t=12&line=3")).toBe("contribution");
    expect(sourceKind("fabric:help/asking-questions")).toBe("help");
    expect(sourceKind("fabric:entity/org")).toBe("workspace");
    expect(sourceKind("not-a-source")).toBeNull();
  });

  test("counts distinct sources of each kind, in a fixed order", () => {
    const summary = evidenceSummary([
      cite("fabric:finding/process/p1/gap-1"),
      cite("fabric:overview/process/p1"),
      cite("fabric:entity/process/p2"),
      cite("fabric:conversation/p1/c1?t=12&line=3"),
      cite("fabric:conversation/p1/c1?t=40&line=9"),
      cite("fabric:conversation/p2/c2"),
      cite("fabric:flow-node/p1/n1"),
      cite("fabric:flow-node/p1/n2"),
      cite("fabric:entity/org"),
    ]);
    expect(summary.map((item) => item.label)).toEqual(["2 contributions", "2 processes", "1 process flow"]);
  });

  test("skips sources that are no longer available", () => {
    expect(evidenceSummary([cite("fabric:overview/process/p1", { availability: "unavailable" })])).toEqual([]);
  });
});

describe("thread sections", () => {
  const now = new Date(2026, 10, 4, 15, 0).getTime();
  const at = (day: number, hour = 9) => ({ lastMessageAt: new Date(2026, 10, day, hour).getTime() });

  test("puts pinned first, then threads by the day of their latest activity", () => {
    const pinned = [at(1)];
    const sections = threadSections(pinned, [at(4, 14), at(3, 23), at(1, 12), at(1, 0), at(2)], now);
    expect(sections.map((s) => [s.label, s.threads.length])).toEqual([
      ["Pinned", 1],
      ["Today", 1],
      ["Yesterday", 1],
      ["Previous 7 days", 3],
    ]);
    expect(threadSections([], [{ lastMessageAt: new Date(2026, 9, 28).getTime() }], now)[0].label).toBe("Older");
  });

  test("shortens the time to fit the row", () => {
    expect(threadTime(now - 20_000, now)).toBe("now");
    expect(threadTime(now - 17 * 60_000, now)).toBe("17m");
    expect(threadTime(now - 18 * 3_600_000, now)).toBe("18h");
    expect(threadTime(now - 3 * 86_400_000, now)).toBe("3d");
    expect(threadTime(new Date(2026, 9, 12).getTime(), now)).toBe("Oct 12");
    expect(threadTime(new Date(2025, 9, 12).getTime(), now)).toBe("Oct 12, 2025");
  });
});

import { describe, expect, test } from "vitest";
import type { AskMessagePart } from "../../../convex/lib/askSchema";
import { citationTarget, groupSources, type CitationView } from "./citation-links";
import {
  answerText,
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

describe("thought trace (FR-2.15)", () => {
  test("shows Thinking… first, then the active step", () => {
    expect(statusLine([], "streaming")).toBe("Thinking…");
    expect(statusLine([reasoning("I'll read the overviews first. Then rank.", 0)], "streaming")).toBe(
      "I'll read the overviews first.",
    );
    expect(statusLine([tool("Checking coverage across the organization", "running", 0)], "streaming")).toBe(
      "Checking coverage across the organization…",
    );
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
});

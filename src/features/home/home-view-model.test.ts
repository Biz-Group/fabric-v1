import { describe, expect, it } from "vitest";
import type {
  ProcessTreeData,
  ProcessTreeDepartment,
  ProcessTreeProcess,
} from "@/features/hierarchy/process-tree-navigator";
import {
  departmentInterviewCoverage,
  describeConversationStatus,
  describeProcessActivity,
  findTreeDepartment,
  firstName,
  formatRelativeTime,
  interviewCountLabel,
  nextBuildStep,
  resolveRecentProcesses,
  treeHasProcesses,
} from "./home-view-model";
import { conversationStatusMeta } from "@/features/status/status-meta";
import {
  MAX_RECENT_PROCESSES,
  parseRecentProcessIds,
  pushRecentProcessId,
} from "./recent-processes";

type Counts = ProcessTreeProcess["conversationCounts"];

function processRow(
  id: string,
  counts: Partial<Counts> = {},
  pendingWorkStatus: ProcessTreeProcess["pendingWorkStatus"] = "current",
) {
  return {
    _id: id,
    name: `Process ${id}`,
    conversationCounts: {
      total: 0,
      done: 0,
      processing: 0,
      needsSpeakerLabels: 0,
      failed: 0,
      ...counts,
    },
    pendingWorkStatus,
  } as unknown as ProcessTreeProcess;
}

function departmentRow(id: string, processes: ProcessTreeProcess[]) {
  return { _id: id, name: `Department ${id}`, processes } as unknown as
    ProcessTreeDepartment;
}

function treeOf(
  functions: { id: string; departments: ProcessTreeDepartment[] }[],
) {
  return {
    functions: functions.map((fn) => ({
      _id: fn.id,
      name: `Function ${fn.id}`,
      departments: fn.departments,
    })),
  } as unknown as ProcessTreeData;
}

const tree = treeOf([
  {
    id: "f1",
    departments: [
      departmentRow("d1", [
        processRow("p1", { total: 2, done: 2 }),
        processRow("p2"),
      ]),
      departmentRow("d2", []),
    ],
  },
  { id: "f2", departments: [departmentRow("d3", [processRow("p3")])] },
]);

describe("workspace home tree lookups", () => {
  it("finds a department with its function", () => {
    const found = findTreeDepartment(tree, "d3");
    expect(found?.fn._id).toBe("f2");
    expect(found?.department._id).toBe("d3");
    expect(findTreeDepartment(tree, "missing")).toBeNull();
  });

  it("resolves recent ids in recency order and drops ones that are gone", () => {
    const recent = resolveRecentProcesses(tree, ["p3", "deleted", "p1"]);
    expect(recent.map((entry) => entry.process._id)).toEqual(["p3", "p1"]);
    expect(recent[0]?.department._id).toBe("d3");
    expect(recent[1]?.fn._id).toBe("f1");
  });

  it("knows when the workspace has no processes at all", () => {
    expect(treeHasProcesses(tree)).toBe(true);
    expect(
      treeHasProcesses(treeOf([{ id: "f", departments: [departmentRow("d", [])] }])),
    ).toBe(false);
  });

  it("names the next step towards the first process", () => {
    expect(nextBuildStep(treeOf([]))).toEqual({ kind: "function" });

    const functionsOnly = nextBuildStep(
      treeOf([
        { id: "f1", departments: [] },
        { id: "f2", departments: [] },
      ]),
    );
    expect(functionsOnly).toMatchObject({ kind: "department" });
    expect(
      functionsOnly?.kind === "department" && functionsOnly.fn._id,
    ).toBe("f1");

    // A department waiting for a process beats an earlier, emptier function.
    const withDepartment = nextBuildStep(
      treeOf([
        { id: "f1", departments: [] },
        { id: "f2", departments: [departmentRow("d1", [])] },
      ]),
    );
    expect(withDepartment).toMatchObject({ kind: "process" });
    expect(
      withDepartment?.kind === "process" &&
        [withDepartment.fn._id, withDepartment.department._id],
    ).toEqual(["f2", "d1"]);

    expect(nextBuildStep(tree)).toBeNull();
  });

  it("counts processes with a completed interview", () => {
    expect(
      departmentInterviewCoverage(
        departmentRow("d", [
          processRow("a", { total: 1, done: 1 }),
          processRow("b", { total: 1, processing: 1 }, "processing"),
          processRow("c"),
        ]),
      ),
    ).toEqual({ covered: 1, total: 3 });
  });
});

describe("workspace home status rules", () => {
  it("flags only processes that need something", () => {
    expect(describeProcessActivity(processRow("a"))).toMatchObject({
      tone: "neutral",
      label: "No interviews yet",
    });
    expect(
      describeProcessActivity(processRow("b", { total: 3, done: 3 })),
    ).toBeNull();
    expect(
      describeProcessActivity(
        processRow("c", { total: 1, needsSpeakerLabels: 1 }, "needs_labels"),
      ),
    ).toBe(conversationStatusMeta.needs_speaker_labels);
    expect(
      describeProcessActivity(processRow("d", { total: 1, failed: 1 }, "failed"))
        ?.tone,
    ).toBe("destructive");
  });

  it("labels interview statuses, leaving finished ones quiet", () => {
    expect(describeConversationStatus("done")).toBeNull();
    expect(describeConversationStatus("needs_speaker_labels")?.label).toBe(
      "Needs labels",
    );
    expect(describeConversationStatus("processing")?.tone).toBe("info");
  });

  it("formats counts, names, and times", () => {
    expect(interviewCountLabel(0)).toBe("No interviews");
    expect(interviewCountLabel(1)).toBe("1 interview");
    expect(interviewCountLabel(4)).toBe("4 interviews");
    expect(firstName("  Saish   Gaonkar ")).toBe("Saish");
    expect(firstName(null)).toBe("");
    const now = Date.UTC(2026, 9, 14, 12);
    expect(formatRelativeTime(now - 30_000, now)).toBe("just now");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});

describe("recent process ids", () => {
  it("moves a reopened process to the front without duplicating it", () => {
    expect(pushRecentProcessId(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  it("keeps a bounded list", () => {
    const ids = Array.from({ length: MAX_RECENT_PROCESSES }, (_, i) => `p${i}`);
    const next = pushRecentProcessId(ids, "new");
    expect(next).toHaveLength(MAX_RECENT_PROCESSES);
    expect(next[0]).toBe("new");
  });

  it("treats malformed storage as empty", () => {
    expect(parseRecentProcessIds(null)).toEqual([]);
    expect(parseRecentProcessIds("not json")).toEqual([]);
    expect(parseRecentProcessIds('{"a":1}')).toEqual([]);
    expect(parseRecentProcessIds('["a", 2, "", "b"]')).toEqual(["a", "b"]);
  });
});

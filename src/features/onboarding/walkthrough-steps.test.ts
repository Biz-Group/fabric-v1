import { describe, expect, it } from "vitest";
import type { ProcessTreeData } from "@/features/hierarchy/process-tree-navigator";
import {
  TOUR_ANCHORS,
  pickWalkthroughTargets,
  shouldAutoStartWalkthrough,
  walkthroughSteps,
} from "./walkthrough-steps";

function processRow(id: string, done = 0, total = done) {
  return {
    _id: id,
    _creationTime: 1,
    name: `Process ${id}`,
    conversationCounts: { done, total },
  };
}

function treeOf(
  functions: {
    id: string;
    departments: { id: string; processes: ReturnType<typeof processRow>[] }[];
  }[],
) {
  return {
    functions: functions.map((fn) => ({
      _id: fn.id,
      _creationTime: 1,
      name: `Function ${fn.id}`,
      departments: fn.departments.map((department) => ({
        _id: department.id,
        _creationTime: 1,
        name: `Department ${department.id}`,
        processes: department.processes,
      })),
    })),
  } as unknown as ProcessTreeData;
}

const tree = treeOf([
  {
    id: "f1",
    departments: [{ id: "d1", processes: [processRow("p1")] }],
  },
  {
    id: "f2",
    departments: [
      { id: "d2", processes: [processRow("p2"), processRow("p3", 0, 2)] },
      {
        id: "d3",
        processes: [processRow("p4"), processRow("p5", 3), processRow("p6", 1)],
      },
    ],
  },
]);

describe("pickWalkthroughTargets", () => {
  it("uses the member's own department", () => {
    const targets = pickWalkthroughTargets(tree, "d2");
    expect(targets.isOwnDepartment).toBe(true);
    expect(targets.fn?.fn._id).toBe("f2");
    expect(targets.department?.department._id).toBe("d2");
    // No completed contributions there: the one with any contribution.
    expect(targets.process?.process._id).toBe("p3");
  });

  it("falls back to the busiest function and department", () => {
    const targets = pickWalkthroughTargets(tree, null);
    expect(targets.isOwnDepartment).toBe(false);
    expect(targets.fn?.fn._id).toBe("f2");
    expect(targets.department?.department._id).toBe("d3");
    expect(targets.process?.process._id).toBe("p5");
  });

  it("finds a process elsewhere when the member's department has none", () => {
    const withEmpty = treeOf([
      { id: "f1", departments: [{ id: "mine", processes: [] }] },
      { id: "f2", departments: [{ id: "d2", processes: [processRow("p2", 1)] }] },
    ]);
    const targets = pickWalkthroughTargets(withEmpty, "mine");
    expect(targets.department?.department._id).toBe("mine");
    expect(targets.process?.process._id).toBe("p2");
  });
});

describe("walkthroughSteps", () => {
  it("walks editors through all seven steps", () => {
    const steps = walkthroughSteps({
      canCapture: true,
      tree,
      placementDepartmentId: "d2",
    });
    expect(steps.map((step) => step.id)).toEqual([
      "tree",
      "function",
      "department",
      "process",
      "tabs",
      "capture",
      "search",
    ]);
    const process = steps[3];
    expect(process.node).toBe("p3");
    expect(process.selectOnNext).toMatchObject({ kind: "process", processId: "p3" });
    expect(steps[2].body).toContain("your department");
  });

  it("leaves Capture out for viewers", () => {
    const steps = walkthroughSteps({
      canCapture: false,
      tree,
      placementDepartmentId: null,
    });
    expect(steps.map((step) => step.id)).not.toContain("capture");
    expect(steps.find((step) => step.id === "department")?.body).not.toContain(
      "your department",
    );
  });

  it("drops steps without a target", () => {
    const steps = walkthroughSteps({
      canCapture: true,
      tree: treeOf([]),
      placementDepartmentId: null,
    });
    expect(steps.map((step) => step.id)).toEqual(["tree", "search"]);
  });

  it("only names anchors that exist", () => {
    const steps = walkthroughSteps({
      canCapture: true,
      tree,
      placementDepartmentId: "d1",
    });
    for (const step of steps) {
      expect(TOUR_ANCHORS).toContain(step.anchor);
      if (step.anchor === "tree-node") expect(step.node).toBeTruthy();
    }
  });
});

describe("shouldAutoStartWalkthrough", () => {
  const ready = {
    path: "explore" as const,
    welcomed: true,
    walkthrough: "pending" as const,
    deepLink: false,
  };

  it("starts for a welcomed Explore member with the walkthrough pending", () => {
    expect(shouldAutoStartWalkthrough(ready)).toBe(true);
  });

  it("waits out deep links, other paths, and resolved walkthroughs", () => {
    expect(shouldAutoStartWalkthrough({ ...ready, deepLink: true })).toBe(false);
    expect(shouldAutoStartWalkthrough({ ...ready, path: "waiting" })).toBe(false);
    expect(shouldAutoStartWalkthrough({ ...ready, path: null })).toBe(false);
    expect(shouldAutoStartWalkthrough({ ...ready, welcomed: false })).toBe(false);
    expect(
      shouldAutoStartWalkthrough({ ...ready, walkthrough: "skipped" }),
    ).toBe(false);
  });
});

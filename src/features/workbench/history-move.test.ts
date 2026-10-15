import { describe, expect, it } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  applyHistoryMove,
  followUrlChange,
  isStrictAncestor,
  planHistoryMove,
  startTrail,
  type HistoryTrail,
} from "./history-move";
import {
  buildSelectionQuery,
  type SelectionParams,
} from "./use-selection-params";

const fn = "fn1" as Id<"functions">;
const dept = "dept1" as Id<"departments">;
const proc = "proc1" as Id<"processes">;
const otherProc = "proc2" as Id<"processes">;

function sel(partial: Partial<SelectionParams>): SelectionParams {
  return { fn: null, dept: null, proc: null, tab: 0, node: null, ...partial };
}

const home = sel({});
const atFunction = sel({ fn });
const atDepartment = sel({ fn, dept });
const atProcess = sel({ fn, dept, proc });

function query(s: SelectionParams): string {
  return buildSelectionQuery(new URLSearchParams(), s);
}

/** Drill down through `path` the way the workbench would, from a fresh trail. */
function drill(path: SelectionParams[]): HistoryTrail {
  let trail = startTrail(query(path[0]));
  for (let i = 1; i < path.length; i++) {
    const move = planHistoryMove(trail, path[i - 1], path[i]);
    trail = applyHistoryMove(trail, move, query(path[i]));
  }
  return trail;
}

describe("isStrictAncestor", () => {
  it("puts Home above everything but itself", () => {
    expect(isStrictAncestor(home, atFunction)).toBe(true);
    expect(isStrictAncestor(home, atProcess)).toBe(true);
    expect(isStrictAncestor(home, home)).toBe(false);
  });

  it("follows the path, not just the depth", () => {
    expect(isStrictAncestor(atDepartment, atProcess)).toBe(true);
    expect(isStrictAncestor(atFunction, atProcess)).toBe(true);
    expect(
      isStrictAncestor(sel({ fn, dept: "dept2" as Id<"departments"> }), atProcess),
    ).toBe(false);
    expect(isStrictAncestor(atProcess, atDepartment)).toBe(false);
  });
});

describe("planHistoryMove", () => {
  it("pushes when moving deeper", () => {
    expect(planHistoryMove(startTrail(""), home, atFunction)).toEqual({
      kind: "push",
    });
  });

  it("replaces a tab or flow-step change at the same place", () => {
    const trail = drill([home, atFunction, atDepartment, atProcess]);
    expect(
      planHistoryMove(trail, atProcess, sel({ fn, dept, proc, tab: 2 })),
    ).toEqual({ kind: "replace" });
    expect(
      planHistoryMove(
        trail,
        sel({ fn, dept, proc, tab: 2 }),
        sel({ fn, dept, proc, tab: 2, node: "step-1" }),
      ),
    ).toEqual({ kind: "replace" });
  });

  it("replaces when a process-only link fills in its ancestors", () => {
    expect(
      planHistoryMove(startTrail(`proc=${proc}`), sel({ proc }), atProcess),
    ).toEqual({ kind: "replace" });
  });

  it("goes back to the entry the user drilled down from", () => {
    const trail = drill([home, atFunction, atDepartment, atProcess]);
    expect(planHistoryMove(trail, atProcess, atDepartment)).toEqual({
      kind: "back",
      steps: 1,
    });
    expect(planHistoryMove(trail, atProcess, atFunction)).toEqual({
      kind: "back",
      steps: 2,
    });
    expect(planHistoryMove(trail, atProcess, home)).toEqual({
      kind: "back",
      steps: 3,
    });
  });

  it("skips tab changes made along the way", () => {
    let trail = drill([home, atFunction, atDepartment, atProcess]);
    const flowTab = sel({ fn, dept, proc, tab: 2 });
    trail = applyHistoryMove(
      trail,
      planHistoryMove(trail, atProcess, flowTab),
      query(flowTab),
    );
    expect(planHistoryMove(trail, flowTab, atDepartment)).toEqual({
      kind: "back",
      steps: 1,
    });
  });

  it("replaces when there's nothing to go back to", () => {
    // Opened from a shared link straight to the process.
    expect(
      planHistoryMove(startTrail(query(atProcess)), atProcess, atDepartment),
    ).toEqual({ kind: "replace" });
  });

  it("doesn't go back past a detour to another process", () => {
    const elsewhere = sel({
      fn,
      dept: "dept2" as Id<"departments">,
      proc: otherProc,
    });
    // Home → another process (outside this department) → this process.
    const trail = drill([home, elsewhere, atProcess]);
    expect(planHistoryMove(trail, atProcess, atDepartment)).toEqual({
      kind: "replace",
    });
    expect(planHistoryMove(trail, atProcess, home)).toEqual({
      kind: "back",
      steps: 2,
    });
  });

  it("keeps the in-app back and the system back going up", () => {
    // Drill to a process, use the in-app back twice, then the system back.
    let trail = drill([home, atFunction, atDepartment, atProcess]);
    let current = atProcess;
    for (const up of [atDepartment, atFunction]) {
      const move = planHistoryMove(trail, current, up);
      expect(move.kind).toBe("back");
      trail = applyHistoryMove(trail, move, query(up));
      current = up;
    }
    // System back lands on the entry before, which is Home.
    expect(trail.entries[trail.index - 1]).toBe(query(home));
  });
});

describe("followUrlChange", () => {
  it("follows a single Back or Forward step", () => {
    const trail = drill([home, atFunction, atDepartment]);
    const back = followUrlChange(trail, query(atFunction));
    expect(back.index).toBe(1);
    expect(followUrlChange(back, query(atDepartment)).index).toBe(2);
  });

  it("ignores the workbench's own writes", () => {
    const trail = drill([home, atFunction]);
    expect(followUrlChange(trail, query(atFunction))).toBe(trail);
  });

  it("starts over when the position is unknown", () => {
    const trail = drill([home, atFunction, atDepartment, atProcess]);
    expect(followUrlChange(trail, "fn=elsewhere")).toEqual(
      startTrail("fn=elsewhere"),
    );
  });
});

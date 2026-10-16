import { describe, expect, it } from "vitest";
import {
  formatSecondsLeft,
  playedSeconds,
  checklistSteps,
  shouldPlaceInNewDepartment,
  resolveWelcomeStep,
  tourSecondsLeft,
  welcomeSteps,
  type WelcomeState,
} from "./onboarding-view-model";

function ranges(...pairs: [number, number][]) {
  return {
    length: pairs.length,
    start: (index: number) => pairs[index][0],
    end: (index: number) => pairs[index][1],
  };
}

function stateOf(overrides: Partial<WelcomeState> = {}): WelcomeState {
  return {
    path: "explore",
    tourWatched: false,
    tourSkipped: false,
    profileComplete: false,
    placementOwed: false,
    ...overrides,
  };
}

describe("tour progress", () => {
  it("counts only what was played", () => {
    expect(playedSeconds(ranges())).toBe(0);
    // Watched the first 30 s, then scrubbed to the last 5 s.
    expect(playedSeconds(ranges([0, 30], [118, 123]))).toBe(35);
  });

  it("knows how much is left before 75%", () => {
    expect(tourSecondsLeft(0, 100)).toBe(75);
    expect(tourSecondsLeft(70, 100)).toBe(5);
    expect(tourSecondsLeft(80, 100)).toBe(0);
    expect(tourSecondsLeft(10, Number.NaN)).toBeNull();
    expect(tourSecondsLeft(10, 0)).toBeNull();
  });

  it("formats the time left, rounding up", () => {
    expect(formatSecondsLeft(65)).toBe("1:05 left");
    expect(formatSecondsLeft(0.2)).toBe("0:01 left");
    expect(formatSecondsLeft(110.7)).toBe("1:51 left");
  });
});

describe("welcome steps", () => {
  it("always starts with the tour", () => {
    expect(welcomeSteps(stateOf({ profileComplete: true }))).toEqual(["tour"]);
  });

  it("asks about you only while the profile is incomplete", () => {
    expect(welcomeSteps(stateOf())).toEqual(["tour", "profile"]);
  });

  it("asks where you sit on every path when departments already exist", () => {
    const owed = { placementOwed: true, profileComplete: true };
    for (const path of ["explore", "waiting", "build"] as const) {
      expect(welcomeSteps(stateOf({ ...owed, path }))).toEqual([
        "tour",
        "placement",
      ]);
    }
    // No departments yet: nothing is owed, and the builder places them.
    expect(welcomeSteps(stateOf({ profileComplete: true, path: "build" }))).toEqual([
      "tour",
    ]);
  });
});

describe("resolveWelcomeStep", () => {
  const steps = ["tour", "profile", "placement"] as const;

  it("opens on the tour", () => {
    expect(resolveWelcomeStep(steps, stateOf({ placementOwed: true }))).toBe(
      "tour",
    );
  });

  it("resumes after a refresh at the first step not done", () => {
    expect(
      resolveWelcomeStep(steps, stateOf({ tourWatched: true, placementOwed: true })),
    ).toBe("profile");
    expect(
      resolveWelcomeStep(
        steps,
        stateOf({ tourWatched: true, profileComplete: true, placementOwed: true }),
      ),
    ).toBe("placement");
  });

  it("remembers a skipped tour, except for builders", () => {
    expect(resolveWelcomeStep(steps, stateOf({ tourSkipped: true }))).toBe(
      "profile",
    );
    expect(
      resolveWelcomeStep(["tour"], stateOf({ path: "build", tourSkipped: true })),
    ).toBe("tour");
  });

  it("has nothing left once every step is done", () => {
    expect(
      resolveWelcomeStep(
        steps,
        stateOf({ tourWatched: true, profileComplete: true }),
      ),
    ).toBeNull();
  });
});

describe("checklistSteps", () => {
  type Tree = Parameters<typeof checklistSteps>[0];
  type Onboarding = Parameters<typeof checklistSteps>[1];

  function processRow(
    id: string,
    created: number,
    options: { contributions?: number; flow?: "ready" | "generating" } = {},
  ) {
    return {
      _id: id,
      _creationTime: created,
      name: `Process ${id}`,
      conversationCounts: { total: options.contributions ?? 0 },
      flow: options.flow ? { status: options.flow } : null,
    };
  }

  function treeOf(
    functions: {
      id: string;
      created: number;
      departments?: {
        id: string;
        created: number;
        processes?: ReturnType<typeof processRow>[];
      }[];
    }[],
  ) {
    return {
      functions: functions.map((fn) => ({
        _id: fn.id,
        _creationTime: fn.created,
        name: `Function ${fn.id}`,
        departments: (fn.departments ?? []).map((department) => ({
          _id: department.id,
          _creationTime: department.created,
          name: `Department ${department.id}`,
          processes: department.processes ?? [],
        })),
      })),
    } as unknown as Tree;
  }

  function onboardingOf(
    overrides: { watched?: boolean; invited?: boolean; firstMapSeen?: boolean } = {},
  ): Onboarding {
    return {
      tour: { required: false, watched: overrides.watched ?? true },
      checklist: { visible: true, hidden: false, invited: overrides.invited ?? false },
      hints: { captureSeen: false, firstMapSeen: overrides.firstMapSeen ?? false },
    };
  }

  const states = (tree: Tree, onboarding = onboardingOf()) =>
    checklistSteps(tree, onboarding).steps.map((step) => `${step.id}:${step.state}`);

  it("starts at the function in an empty workspace", () => {
    expect(states(treeOf([]))).toEqual([
      "tour:done",
      "function:current",
      "department:todo",
      "process:todo",
      "contribution:todo",
      "invite:todo",
    ]);
  });

  it("starts at the tour when it hasn't been watched", () => {
    expect(states(treeOf([]), onboardingOf({ watched: false }))[0]).toBe(
      "tour:current",
    );
  });

  it("ticks a function a colleague created, naming the newest", () => {
    const checklist = checklistSteps(
      treeOf([
        { id: "f1", created: 1 },
        { id: "f2", created: 5 },
      ]),
      onboardingOf(),
    );
    expect(checklist.steps[1]).toEqual({
      id: "function",
      state: "done",
      detail: "Function f2",
    });
    expect(checklist.steps[2].state).toBe("current");
    expect(checklist.newestFunction?.fn._id).toBe("f2");
  });

  it("finishes the tree once a process exists", () => {
    const checklist = checklistSteps(
      treeOf([
        {
          id: "f1",
          created: 1,
          departments: [{ id: "d1", created: 2, processes: [processRow("p1", 3)] }],
        },
      ]),
      onboardingOf(),
    );
    expect(checklist.treeDone).toBe(true);
    expect(checklist.doneCount).toBe(4);
    expect(checklist.newestProcess?.department._id).toBe("d1");
    expect(checklist.contribution).toBe("none");
  });

  it("waits for the first map, and for it to be seen, before ticking capture", () => {
    const captured = treeOf([
      {
        id: "f1",
        created: 1,
        departments: [
          {
            id: "d1",
            created: 2,
            processes: [processRow("p1", 3, { contributions: 1, flow: "generating" })],
          },
        ],
      },
    ]);
    expect(checklistSteps(captured, onboardingOf()).contribution).toBe("processing");

    const mapped = treeOf([
      {
        id: "f1",
        created: 1,
        departments: [
          {
            id: "d1",
            created: 2,
            processes: [processRow("p1", 3, { contributions: 1, flow: "ready" })],
          },
        ],
      },
    ]);
    const ready = checklistSteps(mapped, onboardingOf());
    expect(ready.contribution).toBe("mapReady");
    expect(ready.mapProcess?.process._id).toBe("p1");
    expect(ready.steps[4].state).toBe("current");

    const done = checklistSteps(
      mapped,
      onboardingOf({ firstMapSeen: true, invited: true }),
    );
    expect(done.contribution).toBe("seen");
    expect(done.allDone).toBe(true);
  });
});

describe("shouldPlaceInNewDepartment", () => {
  const unplaced = { placement: null, orgHasDepartments: true, placementSkipped: false };

  it("places an unplaced member who ticked the box", () => {
    expect(shouldPlaceInNewDepartment(true, unplaced)).toBe(true);
    expect(shouldPlaceInNewDepartment(false, unplaced)).toBe(false);
  });

  it("never moves someone placed, or who chose Not sure", () => {
    expect(
      shouldPlaceInNewDepartment(true, {
        ...unplaced,
        placement: {
          departmentId: "d1",
          departmentName: "Payroll",
          functionId: "f1",
          functionName: "Finance",
        } as never,
      }),
    ).toBe(false);
    expect(
      shouldPlaceInNewDepartment(true, { ...unplaced, placementSkipped: true }),
    ).toBe(false);
  });

  it("does nothing while the placement is unknown", () => {
    expect(shouldPlaceInNewDepartment(true, undefined)).toBe(false);
    expect(shouldPlaceInNewDepartment(true, null)).toBe(false);
  });
});

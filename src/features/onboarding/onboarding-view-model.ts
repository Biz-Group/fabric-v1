import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import type {
  ProcessTreeData,
  ProcessTreeDepartment,
  ProcessTreeFunction,
  ProcessTreeProcess,
} from "@/features/hierarchy/process-tree-navigator";

// Pure derivations for first-run onboarding, kept out of the components so
// they can be unit-tested.

export type MyOnboarding = NonNullable<
  FunctionReturnType<typeof api.onboarding.getMyOnboarding>
>;
export type OnboardingPath = NonNullable<MyOnboarding["path"]>;

/** The share of the tour that must actually be played to count as watched. */
export const TOUR_WATCHED_FRACTION = 0.75;

/** What a `<video>`'s `played` ranges look like, so tests can fake them. */
export type TimeRangesLike = {
  readonly length: number;
  start(index: number): number;
  end(index: number): number;
};

/** Seconds actually played. Seeking skips the gap, so scrubbing to the end
 * adds nothing, while watching at 1.5× counts in full. */
export function playedSeconds(ranges: TimeRangesLike) {
  let total = 0;
  for (let index = 0; index < ranges.length; index += 1) {
    total += Math.max(0, ranges.end(index) - ranges.start(index));
  }
  return total;
}

/** Seconds still to play before the tour counts as watched, or null while
 * the duration is unknown. */
export function tourSecondsLeft(played: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return Math.max(0, duration * TOUR_WATCHED_FRACTION - played);
}

/** "1:05 left": rounded up, so it never reads 0:00 while still locked. */
export function formatSecondsLeft(seconds: number) {
  const whole = Math.ceil(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return `${minutes}:${rest} left`;
}

export type WelcomeStep = "tour" | "profile" | "placement";

export type WelcomeState = {
  path: OnboardingPath;
  tourWatched: boolean;
  /** Skipped earlier in this browser session (not stored on the server). */
  tourSkipped: boolean;
  profileComplete: boolean;
  /** The member still owes this org a department (see placement-gate.ts). */
  placementOwed: boolean;
};

/** The steps this member's welcome includes, fixed when the flow opens so
 * the progress dots don't shift as steps complete.
 *
 * - The tour always comes first; it doubles as the welcome screen.
 * - About you only when the profile is incomplete. It's global, so someone
 *   who joined another workspace first has already filled it in.
 * - Where do you sit? whenever the member owes a department, which needs the
 *   org to have departments already. A builder in an empty org is placed by
 *   the Getting started builder instead, as they create the first one.
 */
export function welcomeSteps(state: WelcomeState): WelcomeStep[] {
  const steps: WelcomeStep[] = ["tour"];
  if (!state.profileComplete) steps.push("profile");
  if (state.placementOwed) steps.push("placement");
  return steps;
}

/** Where a (re)opened flow starts: the first step not yet done, judged from
 * server state, or null when there's nothing left but to finish. */
export function resolveWelcomeStep(
  steps: readonly WelcomeStep[],
  state: WelcomeState,
): WelcomeStep | null {
  const done: Record<WelcomeStep, boolean> = {
    tour:
      state.tourWatched || (state.tourSkipped && state.path !== "build"),
    profile: state.profileComplete,
    placement: !state.placementOwed,
  };
  return steps.find((step) => !done[step]) ?? null;
}

// --- Getting started checklist -------------------------------------------

export type ChecklistStepId =
  | "tour"
  | "function"
  | "department"
  | "process"
  | "contribution"
  | "invite";

export type ChecklistStep = {
  id: ChecklistStepId;
  state: "done" | "current" | "todo";
  /** What was created, e.g. "Finance", once the step is done. */
  detail: string | null;
};

/** Where the workspace is on the way to its first process map. */
export type ContributionStatus =
  | "none"
  | "processing"
  | "mapReady"
  | "seen";

export type TreeFunctionEntry = { fn: ProcessTreeFunction };
export type TreeDepartmentEntry = TreeFunctionEntry & {
  department: ProcessTreeDepartment;
};
export type TreeProcessEntry = TreeDepartmentEntry & {
  process: ProcessTreeProcess;
};

export type Checklist = {
  steps: ChecklistStep[];
  doneCount: number;
  /** Function, department and process all exist. */
  treeDone: boolean;
  allDone: boolean;
  contribution: ContributionStatus;
  /** The most recently created of each, anyone's: the builder's default
   * parents, and what a done step names. */
  newestFunction: TreeFunctionEntry | null;
  newestDepartment: TreeDepartmentEntry | null;
  newestProcess: TreeProcessEntry | null;
  /** A process whose map is ready, for "View it". */
  mapProcess: TreeProcessEntry | null;
};

function newest<T extends { _creationTime: number }>(
  current: T | null,
  candidate: T,
) {
  return !current || candidate._creationTime > current._creationTime
    ? candidate
    : current;
}

/** The six Getting started steps, derived from the tree the Home already
 * loads plus the member's onboarding state. Steps tick from what exists, so
 * a colleague's function counts too. The contribution step waits for the
 * first process map and for the member to have seen it, so the card never
 * retires before "Your first process map is ready". */
export function checklistSteps(
  tree: ProcessTreeData,
  onboarding: Pick<MyOnboarding, "tour" | "checklist" | "hints">,
): Checklist {
  const functionEntries: TreeFunctionEntry[] = tree.functions.map((fn) => ({ fn }));
  const departmentEntries: TreeDepartmentEntry[] = functionEntries.flatMap(
    ({ fn }) => fn.departments.map((department) => ({ fn, department })),
  );
  const processEntries: TreeProcessEntry[] = departmentEntries.flatMap(
    ({ fn, department }) =>
      department.processes.map((process) => ({ fn, department, process })),
  );

  const newestFunction = functionEntries.reduce<TreeFunctionEntry | null>(
    (best, entry) => (newest(best?.fn ?? null, entry.fn) === entry.fn ? entry : best),
    null,
  );
  const newestDepartment = departmentEntries.reduce<TreeDepartmentEntry | null>(
    (best, entry) =>
      newest(best?.department ?? null, entry.department) === entry.department
        ? entry
        : best,
    null,
  );
  const newestProcess = processEntries.reduce<TreeProcessEntry | null>(
    (best, entry) =>
      newest(best?.process ?? null, entry.process) === entry.process ? entry : best,
    null,
  );
  const mapProcess =
    processEntries.find(({ process }) => process.flow?.status === "ready") ?? null;
  const contributions = processEntries.reduce(
    (total, { process }) => total + process.conversationCounts.total,
    0,
  );

  const contribution: ContributionStatus = mapProcess
    ? onboarding.hints.firstMapSeen
      ? "seen"
      : "mapReady"
    : contributions > 0
      ? "processing"
      : "none";

  const done: Record<ChecklistStepId, boolean> = {
    tour: onboarding.tour.watched,
    function: newestFunction !== null,
    department: newestDepartment !== null,
    process: newestProcess !== null,
    contribution: contribution === "seen",
    invite: onboarding.checklist.invited,
  };
  const detail: Record<ChecklistStepId, string | null> = {
    tour: null,
    function: newestFunction?.fn.name ?? null,
    department: newestDepartment?.department.name ?? null,
    process: newestProcess?.process.name ?? null,
    contribution: null,
    invite: null,
  };

  const order: ChecklistStepId[] = [
    "tour",
    "function",
    "department",
    "process",
    "contribution",
    "invite",
  ];
  const currentId = order.find((id) => !done[id]);
  const steps = order.map((id) => ({
    id,
    state: done[id]
      ? ("done" as const)
      : id === currentId
        ? ("current" as const)
        : ("todo" as const),
    detail: done[id] ? detail[id] : null,
  }));
  const doneCount = steps.filter((step) => step.state === "done").length;

  return {
    steps,
    doneCount,
    treeDone: done.function && done.department && done.process,
    allDone: doneCount === steps.length,
    contribution,
    newestFunction,
    newestDepartment,
    newestProcess,
    mapProcess,
  };
}

type MyPlacement = FunctionReturnType<typeof api.users.getMyPlacement>;

/** Whether the builder's "I work in this department" should place the
 * member: only when they ticked it, and only if they have no department and
 * haven't said "Not sure". It never moves someone already placed. */
export function shouldPlaceInNewDepartment(
  ticked: boolean,
  placement: MyPlacement | undefined,
) {
  return (
    ticked &&
    placement !== undefined &&
    placement !== null &&
    placement.placement === null &&
    !placement.placementSkipped
  );
}

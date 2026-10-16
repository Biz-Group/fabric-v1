import type { ProcessTreeData } from "@/features/hierarchy/process-tree-navigator";
import type { RevealPath } from "@/features/workbench/reveal-path";
import type {
  OnboardingPath,
  TreeDepartmentEntry,
  TreeFunctionEntry,
  TreeProcessEntry,
} from "./onboarding-view-model";

/** Every `data-tour` anchor the onboarding points at. A walkthrough step
 * naming anything else would silently skip, so the tests check against this
 * list. */
export const TOUR_ANCHORS = [
  "tree",
  "tree-node",
  "process-tabs",
  "capture",
  "search",
  "getting-started",
] as const;
export type TourAnchor = (typeof TOUR_ANCHORS)[number];

export type WalkthroughStepId =
  | "tree"
  | "function"
  | "department"
  | "process"
  | "tabs"
  | "capture"
  | "search";

export type WalkthroughStep = {
  id: WalkthroughStepId;
  anchor: TourAnchor;
  /** For `tree-node`: which row (`data-tour-node`). */
  node?: string;
  title: string;
  body: string;
  /** Selected when the step shows, so the row it points at is on screen. */
  select?: RevealPath;
  /** Selected when the member presses Next (step 4 opens the process). */
  selectOnNext?: RevealPath;
};

export type WalkthroughTargets = {
  fn: TreeFunctionEntry | null;
  department: TreeDepartmentEntry | null;
  process: TreeProcessEntry | null;
  /** The department is the member's own, not a stand-in. */
  isOwnDepartment: boolean;
};

const processCount = (entry: TreeDepartmentEntry) =>
  entry.department.processes.length;

/** The best process to open: most completed contributions, then any with a
 * contribution, then the first. */
function bestProcess(entries: TreeProcessEntry[]): TreeProcessEntry | null {
  let best: TreeProcessEntry | null = null;
  for (const entry of entries) {
    if (!best) {
      best = entry;
      continue;
    }
    const counts = entry.process.conversationCounts;
    const bestCounts = best.process.conversationCounts;
    if (
      counts.done > bestCounts.done ||
      (counts.done === bestCounts.done &&
        bestCounts.total === 0 &&
        counts.total > 0)
    ) {
      best = entry;
    }
  }
  return best;
}

/** What the walkthrough points at. The member's own department when they
 * have one; otherwise the function with the most processes and its busiest
 * department. The process comes from that department, or from anywhere if
 * the department has none yet. */
export function pickWalkthroughTargets(
  tree: ProcessTreeData,
  placementDepartmentId: string | null,
): WalkthroughTargets {
  const departments: TreeDepartmentEntry[] = tree.functions.flatMap((fn) =>
    fn.departments.map((department) => ({ fn, department })),
  );
  const processes: TreeProcessEntry[] = departments.flatMap(
    ({ fn, department }) =>
      department.processes.map((process) => ({ fn, department, process })),
  );

  const own = departments.find(
    ({ department }) => department._id === placementDepartmentId,
  );
  let department: TreeDepartmentEntry | null = own ?? null;
  if (!department) {
    const busiestFunction = tree.functions.reduce<
      ProcessTreeData["functions"][number] | null
    >((best, fn) => {
      const count = (candidate: typeof fn) =>
        candidate.departments.reduce(
          (total, item) => total + item.processes.length,
          0,
        );
      return !best || count(fn) > count(best) ? fn : best;
    }, null);
    department =
      departments
        .filter(({ fn }) => fn._id === busiestFunction?._id)
        .reduce<TreeDepartmentEntry | null>(
          (best, entry) =>
            !best || processCount(entry) > processCount(best) ? entry : best,
          null,
        ) ?? null;
  }

  const fn: TreeFunctionEntry | null = department
    ? { fn: department.fn }
    : tree.functions[0]
      ? { fn: tree.functions[0] }
      : null;
  const process =
    bestProcess(
      processes.filter(
        (entry) => entry.department._id === department?.department._id,
      ),
    ) ?? bestProcess(processes);

  return { fn, department, process, isOwnDepartment: Boolean(own) };
}

function functionPath({ fn }: TreeFunctionEntry): RevealPath {
  return { kind: "function", functionId: fn._id, functionName: fn.name };
}

function departmentPath({ fn, department }: TreeDepartmentEntry): RevealPath {
  return {
    kind: "department",
    functionId: fn._id,
    functionName: fn.name,
    departmentId: department._id,
    departmentName: department.name,
  };
}

function processPath({ fn, department, process }: TreeProcessEntry): RevealPath {
  return {
    kind: "process",
    functionId: fn._id,
    functionName: fn.name,
    departmentId: department._id,
    departmentName: department.name,
    processId: process._id,
    processName: process.name,
  };
}

/** The Explore walkthrough (plan §3.4). Steps whose target doesn't exist
 * are left out, and viewers get no Capture step. The last step ends on the
 * opened process and points to Help for a replay. */
export function walkthroughSteps({
  canCapture,
  tree,
  placementDepartmentId,
}: {
  canCapture: boolean;
  tree: ProcessTreeData;
  placementDepartmentId: string | null;
}): WalkthroughStep[] {
  const targets = pickWalkthroughTargets(tree, placementDepartmentId);
  const steps: WalkthroughStep[] = [
    {
      id: "tree",
      anchor: "tree",
      title: "Your Process Tree",
      body: "This is your organization's Process Tree: functions, then departments, then the processes inside them.",
    },
  ];

  if (targets.fn) {
    steps.push({
      id: "function",
      anchor: "tree-node",
      node: targets.fn.fn._id,
      title: targets.fn.fn.name,
      body: "Functions are the broad areas of the business.",
      select: functionPath(targets.fn),
    });
  }
  if (targets.department) {
    steps.push({
      id: "department",
      anchor: "tree-node",
      node: targets.department.department._id,
      title: targets.department.department.name,
      body: targets.isOwnDepartment
        ? "This is your department. Its processes also appear on your Home page."
        : "Departments are the teams inside a function, and hold the processes they run. Once you're placed in one, it appears on your Home page.",
      select: departmentPath(targets.department),
    });
  }
  if (targets.process) {
    steps.push(
      {
        id: "process",
        anchor: "tree-node",
        node: targets.process.process._id,
        title: targets.process.process.name,
        body: "Processes are the work itself. Let's open one.",
        // The process may sit in another department when this one has none.
        select: departmentPath(targets.process),
        selectOnNext: processPath(targets.process),
      },
      {
        id: "tabs",
        anchor: "process-tabs",
        title: "Everything about a process",
        body: "Each process builds an Overview, a Process Flow, Insights and automation ideas from the contributions people share.",
      },
    );
    if (canCapture) {
      steps.push({
        id: "capture",
        anchor: "capture",
        title: "Share what you know",
        body: "Know how this work gets done? Start an AI interview, record a voice note, or upload files.",
      });
    }
  }
  steps.push({
    id: "search",
    anchor: "search",
    title: "Find anything",
    body: "Jump to any function, department or process with Ctrl K. Replay this tour any time from Help.",
  });
  return steps;
}

/** The walkthrough starts by itself only for a member on the Explore path
 * who has finished the welcome and hasn't resolved the walkthrough, on a
 * desktop layout, and not when they arrived on a deep link (they get a toast
 * instead). Phones and tablets get the sheet under the same rules. */
export function shouldAutoStartWalkthrough({
  path,
  welcomed,
  walkthrough,
  deepLink,
}: {
  path: OnboardingPath | null;
  welcomed: boolean;
  walkthrough: "pending" | "completed" | "skipped";
  deepLink: boolean;
}) {
  return (
    path === "explore" && welcomed && walkthrough === "pending" && !deepLink
  );
}

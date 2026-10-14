import type {
  ProcessTreeData,
  ProcessTreeDepartment,
  ProcessTreeFunction,
  ProcessTreeProcess,
} from "@/features/hierarchy/process-tree-navigator";

// Pure derivations for the workspace home. Everything here reads the hierarchy
// tree the navigator already loaded, so the home adds no per-row queries.

export type HomeDepartmentEntry = {
  fn: ProcessTreeFunction;
  department: ProcessTreeDepartment;
};

export type HomeProcessEntry = HomeDepartmentEntry & {
  process: ProcessTreeProcess;
};

export type ActivityTone = "attention" | "processing" | "failed" | "gap";

export type Activity = { tone: ActivityTone; label: string };

export function findTreeDepartment(
  tree: ProcessTreeData,
  departmentId: string,
): HomeDepartmentEntry | null {
  for (const fn of tree.functions) {
    for (const department of fn.departments) {
      if (department._id === departmentId) return { fn, department };
    }
  }
  return null;
}

/** Recent ids resolved against the live tree, in recency order. Ids whose
 * process no longer exists (deleted, or another org's) are dropped. */
export function resolveRecentProcesses(
  tree: ProcessTreeData,
  ids: string[],
): HomeProcessEntry[] {
  const byId = new Map<string, HomeProcessEntry>();
  for (const fn of tree.functions) {
    for (const department of fn.departments) {
      for (const process of department.processes) {
        byId.set(process._id, { fn, department, process });
      }
    }
  }
  return ids.flatMap((id) => {
    const entry = byId.get(id);
    return entry ? [entry] : [];
  });
}

export function treeHasProcesses(tree: ProcessTreeData) {
  return tree.functions.some((fn) =>
    fn.departments.some((department) => department.processes.length > 0),
  );
}

/** Processes with at least one completed interview, out of all of them. */
export function departmentInterviewCoverage(
  department: ProcessTreeDepartment,
) {
  return {
    covered: department.processes.filter(
      (process) => process.conversationCounts.done > 0,
    ).length,
    total: department.processes.length,
  };
}

/** The one status worth flagging on a process row, or null when it is
 * simply up to date. A process nobody has been interviewed about yet is the
 * gap the home exists to surface. */
export function describeProcessActivity(
  process: ProcessTreeProcess,
): Activity | null {
  switch (process.pendingWorkStatus) {
    case "needs_labels":
      return { tone: "attention", label: "Needs labels" };
    case "processing":
      return { tone: "processing", label: "Processing" };
    case "failed":
      return { tone: "failed", label: "Failed" };
    case "current":
      return process.conversationCounts.total === 0
        ? { tone: "gap", label: "No interviews yet" }
        : null;
  }
}

export function describeConversationStatus(
  status: "processing" | "needs_speaker_labels" | "done" | "failed",
): Activity | null {
  switch (status) {
    case "needs_speaker_labels":
      return { tone: "attention", label: "Needs labels" };
    case "processing":
      return { tone: "processing", label: "Processing" };
    case "failed":
      return { tone: "failed", label: "Failed" };
    case "done":
      return null;
  }
}

export function interviewCountLabel(count: number) {
  if (count === 0) return "No interviews";
  return count === 1 ? "1 interview" : `${count} interviews`;
}

export function firstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] ?? "";
}

export function formatRelativeTime(epochMs: number, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - epochMs) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(epochMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

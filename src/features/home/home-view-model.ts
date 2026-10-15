import { CircleDashed } from "lucide-react";
import type {
  ProcessTreeData,
  ProcessTreeDepartment,
  ProcessTreeFunction,
  ProcessTreeProcess,
} from "@/features/hierarchy/process-tree-navigator";
import {
  conversationStatusMeta,
  processRowStatus,
  type ConversationStatus,
  type StatusMeta,
} from "@/features/status/status-meta";

// Pure derivations for the workspace home. Everything here reads the hierarchy
// tree the navigator already loaded, so the home adds no per-row queries.

export type HomeDepartmentEntry = {
  fn: ProcessTreeFunction;
  department: ProcessTreeDepartment;
};

export type HomeProcessEntry = HomeDepartmentEntry & {
  process: ProcessTreeProcess;
};

const NO_INTERVIEWS_YET: StatusMeta = {
  label: "No interviews yet",
  tone: "neutral",
  icon: CircleDashed,
};

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

export type BuildStep =
  | { kind: "function" }
  | { kind: "department"; fn: ProcessTreeFunction }
  | ({ kind: "process" } & HomeDepartmentEntry);

/** What an empty workspace needs next on the way to its first process, or
 * null once one exists. It follows the furthest branch, so a department
 * waiting for a process wins over a function waiting for a department; ties
 * go to the first in tree order. */
export function nextBuildStep(tree: ProcessTreeData): BuildStep | null {
  if (treeHasProcesses(tree)) return null;
  for (const fn of tree.functions) {
    const department = fn.departments[0];
    if (department) return { kind: "process", fn, department };
  }
  const fn = tree.functions[0];
  return fn ? { kind: "department", fn } : { kind: "function" };
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
): StatusMeta | null {
  return (
    processRowStatus(process.pendingWorkStatus) ??
    (process.conversationCounts.total === 0 ? NO_INTERVIEWS_YET : null)
  );
}

/** Finished interviews stay quiet; the rest say what they're waiting on. */
export function describeConversationStatus(
  status: ConversationStatus,
): StatusMeta | null {
  return status === "done" ? null : conversationStatusMeta[status];
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

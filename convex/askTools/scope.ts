import { v } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  emptyConversationCounts,
  getConversationCounts,
  type ConversationCounts,
} from "../readModelHelpers";
import { toLightweightSummaryListRow } from "../summaryV2";
import { withSummaryV2ReadGate } from "../lib/summaryV2Feature";
import type { HierarchyKind } from "./results";

/**
 * Optional scope for the aggregate tools. Strict tool schemas allow at most 16
 * union-typed parameters across all tools, so optional inputs use sentinels
 * rather than null: kind "org" (with id "") means the whole organization.
 */
export const scopeInput = {
  kind: v.union(v.literal("org"), v.literal("function"), v.literal("department"), v.literal("process")),
  id: v.string(),
};

export function scopeOf(input: { kind: HierarchyKind | "org"; id: string }): {
  kind: HierarchyKind | null;
  id: string | null;
} {
  return input.kind === "org" ? { kind: null, id: null } : { kind: input.kind, id: input.id.trim() || null };
}

/**
 * Shared reads for the AskFabric tools. Every read is bounded and indexed by
 * the viewer's org (FR-1.11), with the same caps as `hierarchy.getTree`.
 */

export const MAX_FUNCTIONS = 200;
export const MAX_DEPARTMENTS = 1000;
export const MAX_PROCESSES = 2000;
/** Conversations read per process when counting its contributions. */
const MAX_CONVERSATIONS_PER_PROCESS = 500;

const TABLE_FOR_KIND = {
  function: "functions",
  department: "departments",
  process: "processes",
} as const;

type DocForKind = {
  function: Doc<"functions">;
  department: Doc<"departments">;
  process: Doc<"processes">;
};

/**
 * Looks up a model-supplied id in the viewer's org. Malformed, deleted and
 * cross-org ids all come back null, so the tool answers `found: false` and
 * never reveals that an entity exists elsewhere (FR-1.4).
 */
export async function getOrgEntity<K extends HierarchyKind>(
  ctx: QueryCtx,
  orgId: string,
  kind: K,
  rawId: string,
): Promise<DocForKind[K] | null> {
  const table = TABLE_FOR_KIND[kind];
  const id = ctx.db.normalizeId(table, rawId);
  if (!id) return null;
  const doc = (await ctx.db.get(id)) as DocForKind[K] | null;
  if (!doc || doc.clerkOrgId !== orgId) return null;
  return doc;
}

export async function getOrgConversation(
  ctx: QueryCtx,
  orgId: string,
  rawId: string,
): Promise<Doc<"conversations"> | null> {
  const id = ctx.db.normalizeId("conversations", rawId);
  if (!id) return null;
  const doc = await ctx.db.get(id);
  if (!doc || doc.clerkOrgId !== orgId) return null;
  return doc;
}

function sortBySortOrder<T extends { sortOrder: number; _creationTime: number }>(
  rows: T[],
): T[] {
  return rows.sort(
    (a, b) => a.sortOrder - b.sortOrder || a._creationTime - b._creationTime,
  );
}

export type OrgHierarchy = {
  functions: Doc<"functions">[];
  departments: Doc<"departments">[];
  processes: Doc<"processes">[];
  functionById: Map<Id<"functions">, Doc<"functions">>;
  departmentById: Map<Id<"departments">, Doc<"departments">>;
  truncated: boolean;
};

/** The org's functions, departments and processes, in navigator order. */
export async function loadHierarchy(
  ctx: QueryCtx,
  orgId: string,
): Promise<OrgHierarchy> {
  const functions = sortBySortOrder(
    await ctx.db
      .query("functions")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", orgId))
      .take(MAX_FUNCTIONS),
  );
  const departments = sortBySortOrder(
    await ctx.db
      .query("departments")
      .withIndex("by_clerkOrgId_and_functionId", (q) => q.eq("clerkOrgId", orgId))
      .take(MAX_DEPARTMENTS),
  );
  const processes = sortBySortOrder(
    await ctx.db
      .query("processes")
      .withIndex("by_clerkOrgId_and_departmentId", (q) => q.eq("clerkOrgId", orgId))
      .take(MAX_PROCESSES),
  );
  return {
    functions,
    departments,
    processes,
    functionById: new Map(functions.map((fn) => [fn._id, fn])),
    departmentById: new Map(departments.map((dept) => [dept._id, dept])),
    truncated:
      functions.length === MAX_FUNCTIONS ||
      departments.length === MAX_DEPARTMENTS ||
      processes.length === MAX_PROCESSES,
  };
}

/** "Operations › Dispatch › Dispatch scheduling", as the navigator shows it. */
export function entityPath(
  hierarchy: OrgHierarchy,
  kind: HierarchyKind,
  doc: Doc<"functions"> | Doc<"departments"> | Doc<"processes">,
): string {
  if (kind === "function") return doc.name;
  if (kind === "department") {
    const dept = doc as Doc<"departments">;
    const fn = hierarchy.functionById.get(dept.functionId);
    return `${fn?.name ?? "Unknown"} › ${dept.name}`;
  }
  const process = doc as Doc<"processes">;
  const dept = hierarchy.departmentById.get(process.departmentId);
  const fn = dept ? hierarchy.functionById.get(dept.functionId) : undefined;
  return `${fn?.name ?? "Unknown"} › ${dept?.name ?? "Unknown"} › ${process.name}`;
}

/** Processes under an entity; the whole org when no entity is given. */
export function processesInScope(
  hierarchy: OrgHierarchy,
  scope:
    | { kind: "org" }
    | { kind: "function"; id: Id<"functions"> }
    | { kind: "department"; id: Id<"departments"> }
    | { kind: "process"; id: Id<"processes"> },
): Doc<"processes">[] {
  switch (scope.kind) {
    case "org":
      return hierarchy.processes;
    case "process":
      return hierarchy.processes.filter((p) => p._id === scope.id);
    case "department":
      return hierarchy.processes.filter((p) => p.departmentId === scope.id);
    case "function":
      return hierarchy.processes.filter(
        (p) => hierarchy.departmentById.get(p.departmentId)?.functionId === scope.id,
      );
  }
}

/**
 * Overview state as the list surfaces compute it (`processes.listAll`,
 * `departments.listAll`, `functions.list`), with the `SUMMARY_V2` read gate.
 */
export function overviewListState(
  kind: HierarchyKind,
  doc: Doc<"functions"> | Doc<"departments"> | Doc<"processes">,
) {
  if (kind === "process") {
    const process = doc as Doc<"processes">;
    return toLightweightSummaryListRow(withSummaryV2ReadGate(process), {
      legacyMarkdown: process.rollingSummary,
      legacyGeneratedAt: process.summaryUpdatedAt,
      stale:
        process.summaryStale === true ||
        Boolean(
          process.summaryV2 &&
            process.summaryV2SourceRevision !==
              (process.summaryEvidenceRevision ?? 0),
        ),
    }).summaryOverview;
  }
  const rollup = doc as Doc<"functions"> | Doc<"departments">;
  return toLightweightSummaryListRow(withSummaryV2ReadGate(rollup), {
    legacyMarkdown: rollup.summary,
    legacyGeneratedAt: rollup.summaryUpdatedAt,
    stale: rollup.summaryStale,
  }).summaryOverview;
}

/** Contribution counts for a few processes, one bounded read each. */
export async function conversationCountsFor(
  ctx: QueryCtx,
  orgId: string,
  processIds: Id<"processes">[],
): Promise<Map<Id<"processes">, ConversationCounts>> {
  const counts = new Map<Id<"processes">, ConversationCounts>();
  for (const processId of processIds) {
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_processId", (q) =>
        q.eq("clerkOrgId", orgId).eq("processId", processId),
      )
      .take(MAX_CONVERSATIONS_PER_PROCESS);
    counts.set(
      processId,
      rows.length > 0 ? getConversationCounts(rows) : emptyConversationCounts(),
    );
  }
  return counts;
}

export type PendingWork = {
  processing: number;
  needsLabels: number;
  failed: number;
};

/** Org conversations read per non-done status when totalling pending work. */
const MAX_PENDING_SCAN = 500;

/**
 * The org's processing, needs-labels and failed contributions (FR-1.7). Read
 * through the org-wide status index, because these states are transient and
 * few, and loaded once per tool call however many entities it reports on.
 */
export async function loadPendingRows(
  ctx: QueryCtx,
  orgId: string,
): Promise<Doc<"conversations">[]> {
  const rows: Doc<"conversations">[] = [];
  for (const status of ["processing", "needs_speaker_labels", "failed"] as const) {
    rows.push(
      ...(await ctx.db
        .query("conversations")
        .withIndex("by_clerkOrgId_and_status", (q) =>
          q.eq("clerkOrgId", orgId).eq("status", status),
        )
        .take(MAX_PENDING_SCAN)),
    );
  }
  return rows;
}

export function pendingWorkIn(
  rows: Doc<"conversations">[],
  processIds: ReadonlySet<Id<"processes">>,
): PendingWork {
  const work: PendingWork = { processing: 0, needsLabels: 0, failed: 0 };
  for (const row of rows) {
    if (!processIds.has(row.processId)) continue;
    if (row.status === "processing") work.processing += 1;
    else if (row.status === "needs_speaker_labels") work.needsLabels += 1;
    else if (row.status === "failed") work.failed += 1;
  }
  return work;
}

export async function pendingWorkFor(
  ctx: QueryCtx,
  orgId: string,
  processIds: ReadonlySet<Id<"processes">>,
): Promise<PendingWork> {
  return pendingWorkIn(await loadPendingRows(ctx, orgId), processIds);
}

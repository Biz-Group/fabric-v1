import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { askToolQuery } from "./executor";
import {
  conversationCountsFor,
  entityPath,
  getOrgEntity,
  loadHierarchy,
  overviewListState,
  pendingWorkFor,
  processesInScope,
  type OrgHierarchy,
} from "./scope";
import {
  DEFAULT_BUDGET_TOKENS,
  MAX_LIST_ITEMS,
  NOT_FOUND,
  ResultBuilder,
  cursorForOffset,
  isoDate,
  offsetFromCursor,
  searchResult,
  sources,
  type HierarchyKind,
} from "./results";

const KIND_ORDER: Record<HierarchyKind, number> = {
  function: 0,
  department: 1,
  process: 2,
};

const kindValidator = v.union(
  v.literal("function"),
  v.literal("department"),
  v.literal("process"),
);

type Row =
  | { kind: "function"; doc: Doc<"functions"> }
  | { kind: "department"; doc: Doc<"departments"> }
  | { kind: "process"; doc: Doc<"processes"> };

function allRows(hierarchy: OrgHierarchy): Row[] {
  return [
    ...hierarchy.functions.map((doc) => ({ kind: "function" as const, doc })),
    ...hierarchy.departments.map((doc) => ({ kind: "department" as const, doc })),
    ...hierarchy.processes.map((doc) => ({ kind: "process" as const, doc })),
  ];
}

function overviewPhrase(row: Row): string {
  const overview = overviewListState(row.kind, row.doc);
  const generated = isoDate(overview.generatedAt);
  return generated
    ? `Overview: ${overview.state} (generated ${generated})`
    : `Overview: ${overview.state}`;
}

function countPhrase(
  row: Row,
  hierarchy: OrgHierarchy,
  counts: Map<Id<"processes">, { total: number; done: number; processing: number; needsSpeakerLabels: number; failed: number }>,
): string {
  if (row.kind === "process") {
    const c = counts.get(row.doc._id);
    if (!c) return "";
    const pending = [
      c.processing ? `${c.processing} processing` : null,
      c.needsSpeakerLabels ? `${c.needsSpeakerLabels} needing speaker labels` : null,
      c.failed ? `${c.failed} failed` : null,
    ].filter(Boolean);
    return `Contributions: ${c.done} completed${pending.length ? `, ${pending.join(", ")}` : ""}.`;
  }
  if (row.kind === "department") {
    const processes = processesInScope(hierarchy, { kind: "department", id: row.doc._id });
    return `Processes: ${processes.length}.`;
  }
  const departments = hierarchy.departments.filter((d) => d.functionId === row.doc._id);
  const processes = processesInScope(hierarchy, { kind: "function", id: row.doc._id });
  return `Departments: ${departments.length}; processes: ${processes.length}.`;
}

function rowBlock(
  row: Row,
  hierarchy: OrgHierarchy,
  counts: Parameters<typeof countPhrase>[2],
  extra = "",
) {
  const path = entityPath(hierarchy, row.kind, row.doc);
  return searchResult(
    sources.entity(row.kind, row.doc._id),
    `${row.doc.name} (${row.kind})`,
    [
      `${row.kind[0].toUpperCase()}${row.kind.slice(1)} ${path}. id: ${row.doc._id}.`,
      `${overviewPhrase(row)}.`,
      countPhrase(row, hierarchy, counts),
      extra,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

async function countsForPage(ctx: QueryCtx, orgId: string, rows: Row[]) {
  return await conversationCountsFor(
    ctx,
    orgId,
    rows.filter((row) => row.kind === "process").map((row) => row.doc._id as Id<"processes">),
  );
}

// ---- T1 searchHierarchy ------------------------------------------------------

export const searchHierarchyInput = {
  query: v.string(),
  kinds: v.union(v.array(kindValidator), v.null()),
  cursor: v.union(v.string(), v.null()),
};

function normalize(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

/** Lower is better: exact name, name prefix, every term in the name, path only. */
function matchRank(name: string, path: string, query: string): number | null {
  const terms = query.split(" ").filter(Boolean);
  if (terms.length === 0) return null;
  const n = normalize(name);
  const haystack = normalize(`${name} ${path}`);
  if (!terms.every((term) => haystack.includes(term))) return null;
  if (n === query) return 0;
  if (n.startsWith(query)) return 1;
  if (terms.every((term) => n.includes(term))) return 2;
  return 3;
}

/**
 * T1. Finds functions, departments and processes by name, as the command
 * palette does over `processes.listAll`, `departments.listAll` and
 * `functions.list`.
 */
export const searchHierarchy = askToolQuery({
  input: searchHierarchyInput,
  handler: async (ctx, viewer, input) => {
    const query = normalize(input.query);
    const hierarchy = await loadHierarchy(ctx, viewer.orgId);
    const kinds = input.kinds?.length ? new Set(input.kinds) : null;

    const matches = allRows(hierarchy)
      .filter((row) => !kinds || kinds.has(row.kind))
      .map((row) => ({
        row,
        rank: matchRank(row.doc.name, entityPath(hierarchy, row.kind, row.doc), query),
      }))
      .filter((m): m is { row: Row; rank: number } => m.rank !== null)
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          KIND_ORDER[a.row.kind] - KIND_ORDER[b.row.kind] ||
          a.row.doc.name.localeCompare(b.row.doc.name) ||
          a.row.doc._id.localeCompare(b.row.doc._id),
      );

    const offset = offsetFromCursor(input.cursor);
    const page = matches.slice(offset, offset + MAX_LIST_ITEMS).map((m) => m.row);
    const counts = await countsForPage(ctx, viewer.orgId, page);
    const builder = new ResultBuilder(DEFAULT_BUDGET_TOKENS);
    for (const row of page) {
      if (!builder.add(rowBlock(row, hierarchy, counts))) break;
    }
    const next = offset + builder.count;
    return builder.finish(
      { query: input.query, totalMatches: matches.length },
      next < matches.length ? cursorForOffset(next) : null,
    );
  },
});

// ---- T2 browseHierarchy ------------------------------------------------------

export const browseHierarchyInput = {
  kind: v.union(v.literal("function"), v.literal("department"), v.null()),
  id: v.union(v.string(), v.null()),
  cursor: v.union(v.string(), v.null()),
};

/**
 * T2. The children of a node, as `hierarchy.getTree` shows them: functions at
 * the root, a function's departments, or a department's processes with their
 * contribution counts, pending work, overview state and flow availability.
 */
export const browseHierarchy = askToolQuery({
  input: browseHierarchyInput,
  handler: async (ctx, viewer, input) => {
    const hierarchy = await loadHierarchy(ctx, viewer.orgId);

    let children: Row[];
    let parentSource: string;
    let scopeProcesses: Doc<"processes">[];
    if (input.kind === null) {
      children = hierarchy.functions.map((doc) => ({ kind: "function", doc }));
      parentSource = sources.org();
      scopeProcesses = hierarchy.processes;
    } else {
      if (!input.id) return NOT_FOUND;
      const parent = await getOrgEntity(ctx, viewer.orgId, input.kind, input.id);
      if (!parent) return NOT_FOUND;
      parentSource = sources.entity(input.kind, parent._id);
      if (input.kind === "function") {
        children = hierarchy.departments
          .filter((d) => d.functionId === parent._id)
          .map((doc) => ({ kind: "department", doc }));
        scopeProcesses = processesInScope(hierarchy, {
          kind: "function",
          id: parent._id as Id<"functions">,
        });
      } else {
        children = hierarchy.processes
          .filter((p) => p.departmentId === parent._id)
          .map((doc) => ({ kind: "process", doc }));
        scopeProcesses = processesInScope(hierarchy, {
          kind: "department",
          id: parent._id as Id<"departments">,
        });
      }
    }

    const offset = offsetFromCursor(input.cursor);
    const page = children.slice(offset, offset + MAX_LIST_ITEMS);
    const counts = await countsForPage(ctx, viewer.orgId, page);
    const pendingWork = await pendingWorkFor(
      ctx,
      viewer.orgId,
      new Set(scopeProcesses.map((p) => p._id)),
    );

    const builder = new ResultBuilder(DEFAULT_BUDGET_TOKENS);
    for (const row of page) {
      let flowPhrase = "";
      if (row.kind === "process") {
        const flow = await ctx.db
          .query("processFlows")
          .withIndex("by_clerkOrgId_and_processId", (q) =>
            q.eq("clerkOrgId", viewer.orgId).eq("processId", row.doc._id),
          )
          .first();
        const done = counts.get(row.doc._id)?.done ?? 0;
        flowPhrase = flowAvailability(flow, done);
      }
      if (!builder.add(rowBlock(row, hierarchy, counts, flowPhrase))) break;
    }
    const next = offset + builder.count;
    return builder.finish(
      {
        parent: parentSource,
        children: children.length,
        pendingWork,
        ...(hierarchy.truncated ? { hierarchyTruncated: true } : {}),
      },
      next < children.length ? cursorForOffset(next) : null,
    );
  },
});

/** Flow availability as the workbench reads it (`summarizeFlow`). */
export function flowAvailability(
  flow: Doc<"processFlows"> | null,
  completedConversations: number,
): string {
  if (!flow || flow.nodes.length === 0) {
    return flow?.status === "generating" ? "Process flow: generating." : "Process flow: none yet.";
  }
  const stale =
    flow.stale ||
    (flow.status === "ready" && completedConversations > flow.conversationCount);
  return `Process flow: ${flow.status}${stale ? ", stale" : ""} (${flow.nodes.length} steps).`;
}

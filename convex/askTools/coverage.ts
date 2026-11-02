import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { conversationTitle } from "../lib/conversationTitle";
import { askToolQuery } from "./executor";
import {
  MAX_PROCESSES,
  getOrgEntity,
  loadHierarchy,
  loadPendingRows,
  overviewListState,
  pendingWorkIn,
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
  parseSince,
  searchResult,
  sources,
  type HierarchyKind,
} from "./results";

/** Completed contributions read for coverage, newest first (as `getTree`). */
const MAX_DONE_SCAN = 5000;
/** Names listed per gap category before summarising the rest as a count. */
const MAX_NAMES = 10;

const scopeInput = {
  kind: v.union(v.literal("function"), v.literal("department"), v.literal("process"), v.null()),
  id: v.union(v.string(), v.null()),
};

type Scope = {
  kind: HierarchyKind | "org";
  name: string;
  source: string;
  processes: Doc<"processes">[];
  /** Departments and functions under the scope, for overview freshness. */
  departments: Doc<"departments">[];
  functions: Doc<"functions">[];
};

async function resolveScope(
  ctx: QueryCtx,
  orgId: string,
  hierarchy: OrgHierarchy,
  kind: HierarchyKind | null,
  id: string | null,
): Promise<Scope | null> {
  if (kind === null) {
    return {
      kind: "org",
      name: "the organization",
      source: sources.org(),
      processes: hierarchy.processes,
      departments: hierarchy.departments,
      functions: hierarchy.functions,
    };
  }
  if (!id) return null;
  const doc = await getOrgEntity(ctx, orgId, kind, id);
  if (!doc) return null;
  const source = sources.entity(kind, doc._id);
  if (kind === "process") {
    return { kind, name: doc.name, source, processes: [doc as Doc<"processes">], departments: [], functions: [] };
  }
  if (kind === "department") {
    return {
      kind,
      name: doc.name,
      source,
      processes: processesInScope(hierarchy, { kind, id: doc._id as Id<"departments"> }),
      departments: [doc as Doc<"departments">],
      functions: [],
    };
  }
  return {
    kind,
    name: doc.name,
    source,
    processes: processesInScope(hierarchy, { kind, id: doc._id as Id<"functions"> }),
    departments: hierarchy.departments.filter((d) => d.functionId === doc._id),
    functions: [doc as Doc<"functions">],
  };
}

function nameList(names: string[]): string {
  if (names.length <= MAX_NAMES) return names.join(", ");
  return `${names.slice(0, MAX_NAMES).join(", ")} and ${names.length - MAX_NAMES} more`;
}

async function loadDone(ctx: QueryCtx, orgId: string, since: number | null) {
  return await ctx.db
    .query("conversations")
    .withIndex("by_clerkOrgId_and_status", (q) => {
      const base = q.eq("clerkOrgId", orgId).eq("status", "done");
      return since === null ? base : base.gte("_creationTime", since);
    })
    .order("desc")
    .take(MAX_DONE_SCAN);
}

// ---- T8 getCoverage ----------------------------------------------------------

export const getCoverageInput = scopeInput;

/**
 * T8. How much of the org (or one entity) has been interviewed: the basis of
 * the coverage caveat on every org-wide answer (FR-1.15), with pending work
 * (FR-1.7) and overview freshness.
 */
export const getCoverage = askToolQuery({
  input: getCoverageInput,
  handler: async (ctx, viewer, input) => {
    const hierarchy = await loadHierarchy(ctx, viewer.orgId);
    const scope = await resolveScope(ctx, viewer.orgId, hierarchy, input.kind, input.id);
    if (!scope) return NOT_FOUND;

    const processIds = new Set(scope.processes.map((p) => p._id));
    const doneAll = await loadDone(ctx, viewer.orgId, null);
    const done = doneAll.filter((row) => processIds.has(row.processId));
    const pending = pendingWorkIn(await loadPendingRows(ctx, viewer.orgId), processIds);

    const doneByProcess = new Map<Id<"processes">, number>();
    const contributors = new Set<string>();
    for (const row of done) {
      doneByProcess.set(row.processId, (doneByProcess.get(row.processId) ?? 0) + 1);
      contributors.add(
        row.subjectUserId ?? row.userId ?? `name:${row.contributorName.trim().toLocaleLowerCase()}`,
      );
    }
    const interviewed = scope.processes.filter((p) => doneByProcess.has(p._id));
    const notInterviewed = scope.processes.filter((p) => !doneByProcess.has(p._id));
    // A department with processes but no completed contribution in any of them:
    // the "Procurement and Legal have no interviews" part of the caveat.
    const departmentsWithout = scope.departments.filter((dept) => {
      const own = scope.processes.filter((p) => p.departmentId === dept._id);
      return own.length > 0 && own.every((p) => !doneByProcess.has(p._id));
    });

    const overviewRows = [
      ...scope.functions.map((doc) => ({ kind: "function" as const, doc })),
      ...scope.departments.map((doc) => ({ kind: "department" as const, doc })),
      ...scope.processes.map((doc) => ({ kind: "process" as const, doc })),
    ].map((row) => ({ ...row, overview: overviewListState(row.kind, row.doc) }));
    const needsAttention = (state: string) => overviewRows.filter((row) => row.overview.state === state);
    const missing = needsAttention("missing").filter((row) => row.kind !== "process" || doneByProcess.has(row.doc._id as Id<"processes">));
    const stale = needsAttention("stale");
    const failed = needsAttention("failed");
    const latestOverview = Math.max(0, ...overviewRows.map((row) => row.overview.generatedAt ?? 0));

    const total = scope.processes.length;
    const percent = total ? Math.round((interviewed.length / total) * 100) : 0;
    const text = [
      `Coverage of ${scope.name}: ${interviewed.length} of ${total} processes have at least one completed contribution (${percent}%).`,
      `Completed contributions: ${done.length} from ${contributors.size} unique contributors.`,
      pending.processing || pending.needsLabels || pending.failed
        ? `Not yet included: ${pending.processing} processing, ${pending.needsLabels} awaiting speaker labels, ${pending.failed} failed.`
        : "No contributions are pending.",
      departmentsWithout.length
        ? `Departments with no completed contributions: ${nameList(departmentsWithout.map((d) => d.name))}.`
        : "",
      notInterviewed.length && scope.kind !== "process"
        ? `Processes with no completed contributions: ${nameList(notInterviewed.map((p) => p.name))}.`
        : "",
      stale.length ? `Stale overviews: ${nameList(stale.map((r) => r.doc.name))}.` : "",
      missing.length ? `Overviews not generated yet: ${nameList(missing.map((r) => r.doc.name))}.` : "",
      failed.length ? `Overviews whose last refresh failed: ${nameList(failed.map((r) => r.doc.name))}.` : "",
      done[0] ? `Latest contribution recorded ${isoDate(done[0]._creationTime)}.` : "",
      latestOverview ? `Latest overview generated ${isoDate(latestOverview)}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const builder = new ResultBuilder(DEFAULT_BUDGET_TOKENS);
    builder.add(searchResult(scope.source, `Coverage — ${scope.name}`, text));
    return builder.finish({
      processes: total,
      interviewedProcesses: interviewed.length,
      completedContributions: done.length,
      uniqueContributors: contributors.size,
      pendingWork: pending,
      ...(doneAll.length === MAX_DONE_SCAN || hierarchy.processes.length === MAX_PROCESSES
        ? { countsCapped: true }
        : {}),
    });
  },
});

// ---- T9 whatsNew -------------------------------------------------------------

export const whatsNewInput = {
  since: v.string(),
  ...scopeInput,
  cursor: v.union(v.string(), v.null()),
};

type NewItem = { at: number; key: string; block: ReturnType<typeof searchResult> };

/**
 * T9. What changed since a date (D29): contributions recorded since, and
 * overviews and process flows regenerated since, newest first. There is no
 * finding-level diffing (FR-1.13).
 */
export const whatsNew = askToolQuery({
  input: whatsNewInput,
  handler: async (ctx, viewer, input) => {
    const since = parseSince(input.since);
    const builder = new ResultBuilder(DEFAULT_BUDGET_TOKENS);
    if (since === null) {
      return builder.finish({ error: "since must be a date such as 2026-10-01" });
    }
    const hierarchy = await loadHierarchy(ctx, viewer.orgId);
    const scope = await resolveScope(ctx, viewer.orgId, hierarchy, input.kind, input.id);
    if (!scope) return NOT_FOUND;
    const processIds = new Set(scope.processes.map((p) => p._id));
    const processName = new Map(scope.processes.map((p) => [p._id, p.name]));

    const items: NewItem[] = [];
    for (const row of await loadDone(ctx, viewer.orgId, since)) {
      if (!processIds.has(row.processId)) continue;
      const title = conversationTitle(row) ?? `Contribution by ${row.contributorName}`;
      items.push({
        at: row._creationTime,
        key: row._id,
        block: searchResult(
          sources.conversation(row.processId, row._id),
          title,
          `New contribution recorded ${isoDate(row._creationTime)}: ${title}. Process: ${processName.get(row.processId) ?? "Unknown"}. Contributor: ${row.contributorName}. id: ${row._id}.`,
        ),
      });
    }

    const overviewRows = [
      ...scope.functions.map((doc) => ({ kind: "function" as const, doc })),
      ...scope.departments.map((doc) => ({ kind: "department" as const, doc })),
      ...scope.processes.map((doc) => ({ kind: "process" as const, doc })),
    ];
    for (const row of overviewRows) {
      const generatedAt = overviewListState(row.kind, row.doc).generatedAt;
      if (generatedAt === null || generatedAt < since) continue;
      items.push({
        at: generatedAt,
        key: `overview:${row.doc._id}`,
        block: searchResult(
          sources.overview(row.kind, row.doc._id),
          `${row.doc.name} — ${row.kind} overview`,
          `The ${row.kind} overview for ${row.doc.name} was regenerated ${isoDate(generatedAt)}. id: ${row.doc._id}.`,
        ),
      });
    }

    const flows = await ctx.db
      .query("processFlows")
      .withIndex("by_clerkOrgId_and_processId", (q) => q.eq("clerkOrgId", viewer.orgId))
      .take(MAX_PROCESSES);
    for (const flow of flows) {
      if (!processIds.has(flow.processId) || flow.status !== "ready" || flow.generatedAt < since) continue;
      items.push({
        at: flow.generatedAt,
        key: `flow:${flow._id}`,
        block: searchResult(
          sources.entity("process", flow.processId),
          `${processName.get(flow.processId) ?? "Process"} — process flow`,
          `The process flow for ${processName.get(flow.processId) ?? "a process"} was regenerated ${isoDate(flow.generatedAt)} from ${flow.conversationCount} contributions (${flow.nodes.length} steps).`,
        ),
      });
    }

    items.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
    const offset = offsetFromCursor(input.cursor);
    for (const item of items.slice(offset, offset + MAX_LIST_ITEMS)) {
      if (!builder.add(item.block)) break;
    }
    const next = offset + builder.count;
    return builder.finish(
      { scope: scope.source, since: isoDate(since), changes: items.length },
      next < items.length ? cursorForOffset(next) : null,
    );
  },
});

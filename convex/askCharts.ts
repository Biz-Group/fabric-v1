import { v, type Infer } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { askChartIdValidator, askEntityRefValidator, type AskChartId } from "./lib/askSchema";
import { requireOrgMember } from "./lib/orgAuth";
import { loadScopeEvidence } from "./askTools/evidence";
import { loadHierarchy, type OrgHierarchy } from "./askTools/scope";
import { collectSignals, scopedProcesses, type Signal } from "./askTools/signals";
import { summarizeSystems } from "./askTools/systems";
import { parseFabricSource, type HierarchyKind } from "./askTools/results";

/**
 * AskFabric's charts (FR-11.2, D57). Each chart is a deterministic query over
 * a scope, run as the viewer on every view, so a chart always shows current
 * data and an entity the viewer can't open is never in it. The model picks a
 * chart and a scope; it never passes a number (D6, D56). Counts come from the
 * same code as the tools the answer cites: T15's signal pass, T16's systems
 * summary and T8's coverage.
 */

/** Bars per chart; the rest are counted as "+N more". */
export const MAX_BARS = 12;
/** Weeks on the contributions timeline, the latest ones. */
export const MAX_WEEKS = 26;
/** Completed contributions read for the timeline and coverage, as getCoverage. */
const MAX_DONE_SCAN = 5000;
const WEEK_MS = 7 * 86_400_000;

const linkValidator = v.object({
  fn: v.union(v.string(), v.null()),
  dept: v.union(v.string(), v.null()),
  proc: v.union(v.string(), v.null()),
  tab: v.union(v.string(), v.null()),
  node: v.union(v.string(), v.null()),
});

export const chartDataValidator = v.object({
  chartId: askChartIdValidator,
  title: v.string(),
  type: v.union(v.literal("bar"), v.literal("timeline")),
  scopeName: v.string(),
  series: v.array(v.object({ key: v.string(), label: v.string() })),
  /** One per bar or week; `values` line up with `series`. */
  rows: v.array(v.object({ label: v.string(), values: v.array(v.number()), link: v.union(linkValidator, v.null()) })),
  more: v.number(),
  /** When the data last changed, for "updated since this answer". */
  updatedAt: v.union(v.number(), v.null()),
});

export type ChartData = Infer<typeof chartDataValidator>;
type Row = ChartData["rows"][number];
type Link = Infer<typeof linkValidator>;

type Scope = { kind: HierarchyKind | "org"; name: string; processes: Doc<"processes">[]; link: Link | null };

function pathLink(hierarchy: OrgHierarchy, kind: HierarchyKind, id: string, extra: Partial<Link> = {}): Link | null {
  if (kind === "function") return { fn: id, dept: null, proc: null, tab: null, node: null, ...extra };
  if (kind === "department") {
    const dept = hierarchy.departmentById.get(id as Id<"departments">);
    return dept ? { fn: dept.functionId, dept: id, proc: null, tab: null, node: null, ...extra } : null;
  }
  const process = hierarchy.processes.find((p) => p._id === id);
  const dept = process ? hierarchy.departmentById.get(process.departmentId) : undefined;
  return process && dept ? { fn: dept.functionId, dept: dept._id, proc: id, tab: null, node: null, ...extra } : null;
}

async function resolveScope(
  ctx: QueryCtx,
  orgId: string,
  hierarchy: OrgHierarchy,
  ref: { kind: HierarchyKind; id: string } | null,
): Promise<Scope | null> {
  const scope = await scopedProcesses(ctx, orgId, hierarchy, ref?.kind ?? null, ref?.id ?? null);
  if (!scope) return null;
  if (scope.kind === "org" || !scope.id) return { kind: "org", name: "the organization", processes: scope.processes, link: null };
  const doc =
    scope.kind === "function"
      ? hierarchy.functionById.get(scope.id as Id<"functions">)
      : scope.kind === "department"
        ? hierarchy.departmentById.get(scope.id as Id<"departments">)
        : scope.processes[0];
  return { kind: scope.kind, name: doc?.name ?? "Unknown", processes: scope.processes, link: pathLink(hierarchy, scope.kind, scope.id) };
}

function capped(rows: Row[]): { rows: Row[]; more: number } {
  return { rows: rows.slice(0, MAX_BARS), more: Math.max(0, rows.length - MAX_BARS) };
}

const latest = (times: number[]) => (times.length ? Math.max(...times) : null);

async function doneIn(ctx: QueryCtx, orgId: string, scope: Scope) {
  const ids = new Set(scope.processes.map((p) => p._id));
  const done = await ctx.db
    .query("conversations")
    .withIndex("by_clerkOrgId_and_status", (q) => q.eq("clerkOrgId", orgId).eq("status", "done"))
    .order("desc")
    .take(MAX_DONE_SCAN);
  return done.filter((row) => ids.has(row.processId));
}

const CHART_SIGNALS: Signal[] = ["friction", "bottleneck", "handoff"];

/** Friction, bottleneck and handoff items per process, from T15's signal pass. */
async function signalsByProcess(ctx: QueryCtx, orgId: string, hierarchy: OrgHierarchy, scope: Scope): Promise<ChartData> {
  const evidence = await loadScopeEvidence(ctx, orgId, scope.processes);
  const ranked = collectSignals(new Set(CHART_SIGNALS), evidence, []);
  const counts = new Map<string, number[]>();
  CHART_SIGNALS.forEach((signal, index) => {
    for (const item of ranked.get(signal) ?? []) {
      for (const pid of item.processes) {
        const row = counts.get(pid) ?? CHART_SIGNALS.map(() => 0);
        row[index] += 1;
        counts.set(pid, row);
      }
    }
  });
  const total = (values: number[]) => values.reduce((sum, n) => sum + n, 0);
  const rows = scope.processes
    .filter((p) => total(counts.get(p._id) ?? []) > 0)
    .map((p) => ({ label: p.name, values: counts.get(p._id)!, link: pathLink(hierarchy, "process", p._id, { tab: "insights" }) }))
    .sort((a, b) => total(b.values) - total(a.values) || a.label.localeCompare(b.label));
  return {
    chartId: "signalsByProcess",
    title: "Friction, bottlenecks and handoffs by process",
    type: "bar",
    scopeName: scope.name,
    series: [
      { key: "friction", label: "Friction" },
      { key: "bottleneck", label: "Bottlenecks" },
      { key: "handoff", label: "Handoffs" },
    ],
    ...capped(rows),
    updatedAt: latest([...evidence.flows.map((f) => f.flow.generatedAt), ...evidence.contributions.map((c) => c.conversation._creationTime)]),
  };
}

/** Monday 00:00 UTC of the week holding `time`. */
export function weekStart(time: number): number {
  const date = new Date(time);
  const day = (date.getUTCDay() + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day);
}

/** Completed contributions per week, by recorded date (D49). */
async function contributionsOverTime(ctx: QueryCtx, orgId: string, scope: Scope): Promise<ChartData> {
  const done = await doneIn(ctx, orgId, scope);
  const byWeek = new Map<number, number>();
  for (const row of done) {
    const week = weekStart(row._creationTime);
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
  }
  const weeks = [...byWeek.keys()];
  const rows: Row[] = [];
  if (weeks.length) {
    const last = Math.max(...weeks);
    const first = Math.max(Math.min(...weeks), last - (MAX_WEEKS - 1) * WEEK_MS);
    // Every week between the first and the last, empty ones included.
    for (let week = first; week <= last; week += WEEK_MS) {
      const label = new Date(week).toISOString().slice(0, 10);
      rows.push({ label, values: [byWeek.get(week) ?? 0], link: scope.link && { ...scope.link, tab: scope.link.proc ? "conversations" : null } });
    }
  }
  return {
    chartId: "contributionsOverTime",
    title: "Completed contributions per week",
    type: "timeline",
    scopeName: scope.name,
    series: [{ key: "contributions", label: "Contributions" }],
    rows,
    more: 0,
    updatedAt: latest(done.map((row) => row._creationTime)),
  };
}

/** Processes with and without a completed contribution, per department (T8's rule). */
async function coverageByDepartment(ctx: QueryCtx, orgId: string, hierarchy: OrgHierarchy, scope: Scope): Promise<ChartData> {
  const done = await doneIn(ctx, orgId, scope);
  const covered = new Set<string>(done.map((row) => row.processId));
  const departmentIds = new Set<string>(scope.processes.map((p) => p.departmentId));
  const rows = hierarchy.departments
    .filter((dept) => departmentIds.has(dept._id))
    .map((dept) => {
      const own = scope.processes.filter((p) => p.departmentId === dept._id);
      const withEvidence = own.filter((p) => covered.has(p._id)).length;
      return { label: dept.name, values: [withEvidence, own.length - withEvidence], link: pathLink(hierarchy, "department", dept._id) };
    });
  return {
    chartId: "coverageByDepartment",
    title: "Processes with and without contributions, by department",
    type: "bar",
    scopeName: scope.name,
    series: [
      { key: "covered", label: "With contributions" },
      { key: "uncovered", label: "No contributions yet" },
    ],
    ...capped(rows),
    updatedAt: latest([...done.map((row) => row._creationTime), ...scope.processes.map((p) => p._creationTime)]),
  };
}

/** Systems ranked by evidenced friction, from T16's summary: pain points, re-keying apart. */
async function systemFriction(ctx: QueryCtx, orgId: string, hierarchy: OrgHierarchy, scope: Scope): Promise<ChartData> {
  const evidence = await loadScopeEvidence(ctx, orgId, scope.processes);
  const rows = summarizeSystems(evidence)
    .filter((system) => system.painPoints.length > 0)
    .map((system) => {
      // A system's first place is where it was seen: a flow step or a contribution.
      const place = system.places[0];
      const parsed = place ? parseFabricSource(place.source) : null;
      const node = parsed?.type === "flowNode" ? place.source.slice(place.source.lastIndexOf("/") + 1) : null;
      const link = place
        ? pathLink(hierarchy, "process", place.processId, node ? { tab: "flow", node } : { tab: "conversations" })
        : null;
      return { label: system.name, values: [system.painPoints.length - system.rekeying.length, system.rekeying.length], link };
    });
  return {
    chartId: "systemFriction",
    title: "Systems by evidenced friction",
    type: "bar",
    scopeName: scope.name,
    series: [
      { key: "painPoints", label: "Pain points" },
      { key: "rekeying", label: "Manual re-keying" },
    ],
    ...capped(rows),
    updatedAt: latest([...evidence.flows.map((f) => f.flow.generatedAt), ...evidence.contributions.map((c) => c.conversation._creationTime)]),
  };
}

/** A chart for a scope, as the viewer; null when the scope isn't theirs. */
export async function computeChart(
  ctx: QueryCtx,
  orgId: string,
  chartId: AskChartId,
  ref: { kind: HierarchyKind; id: string } | null,
): Promise<ChartData | null> {
  const hierarchy = await loadHierarchy(ctx, orgId);
  const scope = await resolveScope(ctx, orgId, hierarchy, ref);
  if (!scope) return null;
  switch (chartId) {
    case "signalsByProcess":
      return await signalsByProcess(ctx, orgId, hierarchy, scope);
    case "contributionsOverTime":
      return await contributionsOverTime(ctx, orgId, scope);
    case "coverageByDepartment":
      return await coverageByDepartment(ctx, orgId, hierarchy, scope);
    case "systemFriction":
      return await systemFriction(ctx, orgId, hierarchy, scope);
  }
}

/** A chart part's data (Phase 2E): live, re-authorized on every view (D56). */
export const getChart = query({
  args: { chartId: askChartIdValidator, scope: v.union(askEntityRefValidator, v.null()) },
  returns: v.union(chartDataValidator, v.null()),
  handler: async (ctx, args) => {
    const org = await requireOrgMember(ctx);
    return await computeChart(ctx, org.orgId, args.chartId, args.scope);
  },
});

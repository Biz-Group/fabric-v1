import type { Doc, Id } from "../_generated/dataModel";
import { isActiveMembership } from "../lib/orgAuth";
import { askToolQuery } from "./executor";
import { loadHierarchy, scopeInput, scopeOf } from "./scope";
import { scopedProcesses } from "./signals";
import {
  DEFAULT_BUDGET_TOKENS,
  NOT_FOUND,
  ResultBuilder,
  clipText,
  searchResult,
  sources,
} from "./results";

/** Completed contributions read per call, newest first. */
const MAX_PARTICIPATION_CONVERSATIONS = 1000;
/** Memberships read per call. */
const MAX_PARTICIPATION_MEMBERS = 1000;
/** Names listed in one result block before it says "and N more". */
const MAX_NAMES = 40;

export const getParticipationInput = scopeInput;

function nameList(names: string[]): string {
  if (names.length <= MAX_NAMES) return names.join(", ");
  return `${names.slice(0, MAX_NAMES).join(", ")} and ${names.length - MAX_NAMES} more`;
}

/**
 * T13. Who has contributed in a scope, and which members haven't, as the admin
 * Members page shows them (`users.listOrgMembersPage`, D27). Admin only: other
 * roles get not-found, as they get coverage counts instead (FR-1.21, FR-9.3).
 *
 * Factual listing only: names, roles and counts, never an assessment (D7).
 * "Members without" is scoped by placement: members placed in a department in
 * scope; the whole org's active members for an org-wide question. Super-admin
 * fan-out memberships are Fabric staff, not the org's people, and are left out.
 */
export const getParticipation = askToolQuery({
  input: getParticipationInput,
  handler: async (ctx, viewer, input) => {
    if (viewer.role !== "admin") return NOT_FOUND;
    const hierarchy = await loadHierarchy(ctx, viewer.orgId);
    const { kind, id } = scopeOf(input);
    const scope = await scopedProcesses(ctx, viewer.orgId, hierarchy, kind, id);
    if (!scope) return NOT_FOUND;

    const processIds = new Set<Id<"processes">>(scope.processes.map((p) => p._id));
    const scanned = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_status", (q) => q.eq("clerkOrgId", viewer.orgId).eq("status", "done"))
      .order("desc")
      .take(MAX_PARTICIPATION_CONVERSATIONS);
    const done = scanned.filter((row) => processIds.has(row.processId));

    // Whose knowledge a contribution holds: the subject when recorded on
    // someone's behalf, else the submitter; a name alone for outside speakers.
    const contributorKey = (row: Doc<"conversations">) => row.subjectUserId ?? row.userId ?? `name:${row.contributorName}`;
    const perProcess = new Map<Id<"processes">, Map<string, { name: string; count: number }>>();
    const contributed = new Set<string>();
    for (const row of done) {
      const key = contributorKey(row);
      contributed.add(key);
      const byContributor = perProcess.get(row.processId) ?? new Map();
      const entry = byContributor.get(key) ?? { name: row.contributorName, count: 0 };
      entry.count += 1;
      byContributor.set(key, entry);
      perProcess.set(row.processId, byContributor);
    }

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", viewer.orgId))
      .take(MAX_PARTICIPATION_MEMBERS);
    const scopeDepartments =
      scope.kind === "org" ? null : new Set(scope.processes.map((p) => p.departmentId as Id<"departments">));
    const people = memberships.filter(
      (m) =>
        isActiveMembership(m) &&
        m.source !== "superAdminFanOut" &&
        (scopeDepartments === null || (m.departmentId !== undefined && scopeDepartments.has(m.departmentId))),
    );
    const without: string[] = [];
    for (const m of people) {
      if (contributed.has(m.userId)) continue;
      const name = m.name ?? (await ctx.db.get("users", m.userId))?.name ?? "Unknown";
      without.push(`${name} (${m.role})`);
    }
    without.sort((a, b) => a.localeCompare(b));

    const capped = scanned.length === MAX_PARTICIPATION_CONVERSATIONS || memberships.length === MAX_PARTICIPATION_MEMBERS;
    const placement =
      scope.kind === "org"
        ? "all active members of the organization"
        : "members placed in a department in scope (unplaced members are not counted)";
    const builder = new ResultBuilder(DEFAULT_BUDGET_TOKENS, 400);
    for (const process of scope.processes) {
      const byContributor = perProcess.get(process._id);
      if (!byContributor) continue;
      const names = [...byContributor.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => `${entry.name} (${entry.count})`);
      const block = searchResult(
        sources.entity("process", process._id),
        `${process.name} — who contributed`,
        clipText(`Completed contributions to ${process.name} by contributor: ${nameList(names)}.`, 600),
      );
      if (!builder.add(block)) break;
    }
    const notCovered = scope.processes.filter((p) => !perProcess.has(p._id)).map((p) => p.name);
    if (notCovered.length) {
      builder.add(
        searchResult(scope.source, "Processes with no completed contributions", clipText(`${nameList(notCovered)}.`, 600)),
      );
    }
    builder.add(
      searchResult(
        scope.source,
        "Members with no completed contributions",
        without.length
          ? clipText(`Among ${placement}, ${without.length} of ${people.length} have no completed contribution in scope: ${nameList(without)}.`, 1200)
          : `Among ${placement}, all ${people.length} have a completed contribution in scope.`,
      ),
    );

    return builder.finish(
      { scope: scope.source, processesInScope: scope.processes.length, ...(capped ? { readCapped: true } : {}) },
      null,
      {
        summary: {
          source: scope.source,
          title: "Participation: scope and counts",
          text: `${done.length}${capped ? " or more" : ""} completed contributions in scope from ${contributed.size} contributor${contributed.size === 1 ? "" : "s"}, across ${perProcess.size} of ${scope.processes.length} processes. ${people.length - without.length} of ${people.length} members (${placement}) have contributed.`,
        },
      },
    );
  },
});

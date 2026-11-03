import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { readableSummaryV2 } from "../lib/summaryV2Feature";
import { HELP_ARTICLES } from "../askTools/helpCorpus.generated";
import { getOrgConversation, getOrgEntity } from "../askTools/scope";
import { parseFabricSource, type HierarchyKind } from "../askTools/results";
import type { SummaryArtifactV2 } from "../summaryV2";

/**
 * Citation re-authorization on load (FR-5.5). Every cited entity is checked
 * against the viewer's current access each time a thread is read:
 *   - `unavailable`: gone, or no longer the viewer's to see. The UI shows
 *     "Source no longer available" and the cited text is withheld.
 *   - `updated`: the entity is there but the cited finding or flow step is
 *     not (overviews and flows regenerate). The chip links to the entity and
 *     notes "This finding has since been updated".
 *   - `available`: as cited.
 */
export type CitationAvailability = "available" | "unavailable" | "updated";

const FINDING_SECTIONS = [
  "scope",
  "consensus",
  "variations",
  "gaps",
  "notable",
  "crossProcessDependencies",
  "sharedPatterns",
  "variationsAndTensions",
  "crossDepartmentDependencies",
  "strategicPatterns",
] as const;

function hasFinding(doc: { clerkOrgId: string; summaryV2?: unknown }, findingId: string): boolean {
  const artifact = readableSummaryV2(doc.clerkOrgId, doc.summaryV2 as SummaryArtifactV2 | undefined) as
    | Record<string, Array<{ id: string }> | undefined>
    | undefined;
  if (!artifact) return false;
  return FINDING_SECTIONS.some((section) => artifact[section]?.some((finding) => finding.id === findingId));
}

/** Where a cited entity sits, for the workbench's `?fn&dept&proc` links (FR-5.2). */
export type CitationPath = { fn: string | null; dept: string | null; proc: string | null };

const NO_PATH: CitationPath = { fn: null, dept: null, proc: null };

/**
 * The hierarchy path of a citation's entity. The workbench drops a child id
 * whose parent is missing from the URL, so a link needs the full path; the
 * citation stores only the entity it cites.
 */
export function citationPathResolver(ctx: QueryCtx, orgId: string) {
  const cache = new Map<string, Promise<CitationPath>>();

  const forDepartment = async (departmentId: string): Promise<CitationPath> => {
    const dept = await getOrgEntity(ctx, orgId, "department", departmentId);
    return dept ? { fn: dept.functionId, dept: dept._id, proc: null } : NO_PATH;
  };
  const forProcess = async (processId: string): Promise<CitationPath> => {
    const process = await getOrgEntity(ctx, orgId, "process", processId);
    if (!process) return NO_PATH;
    const parent = await forDepartment(process.departmentId);
    return parent.fn ? { ...parent, proc: process._id } : NO_PATH;
  };

  const resolve = async (source: string): Promise<CitationPath> => {
    const parsed = parseFabricSource(source);
    if (!parsed) return NO_PATH;
    switch (parsed.sourceKind) {
      case "function":
        return (await getOrgEntity(ctx, orgId, "function", parsed.sourceEntityId))
          ? { fn: parsed.sourceEntityId, dept: null, proc: null }
          : NO_PATH;
      case "department":
        return await forDepartment(parsed.sourceEntityId);
      case "process":
        return await forProcess(parsed.sourceEntityId);
      case "conversation": {
        const conversation = await getOrgConversation(ctx, orgId, parsed.sourceEntityId);
        return conversation ? await forProcess(conversation.processId) : NO_PATH;
      }
      default:
        return NO_PATH;
    }
  };

  return (source: string): Promise<CitationPath> => {
    let result = cache.get(source);
    if (!result) {
      result = resolve(source);
      cache.set(source, result);
    }
    return result;
  };
}

/** Checks citations for one viewer, caching each entity lookup. */
export function citationChecker(ctx: QueryCtx, orgId: string, role: Doc<"memberships">["role"]) {
  const cache = new Map<string, Promise<CitationAvailability>>();

  const check = async (source: string): Promise<CitationAvailability> => {
    const parsed = parseFabricSource(source);
    if (!parsed) return "unavailable";
    switch (parsed.type) {
      case "org":
        return "available";
      case "help":
        return HELP_ARTICLES.some((article) => article.id === parsed.sourceEntityId) ? "available" : "unavailable";
      case "members":
        // Participation is admin-only (D27).
        if (role !== "admin") return "unavailable";
        return (await getOrgEntity(ctx, orgId, parsed.sourceKind as HierarchyKind, parsed.sourceEntityId))
          ? "available"
          : "unavailable";
      case "conversation":
      case "transcriptLine": {
        const conversation = await getOrgConversation(ctx, orgId, parsed.sourceEntityId);
        return conversation?.status === "done" ? "available" : "unavailable";
      }
      case "flowNode": {
        const process = await getOrgEntity(ctx, orgId, "process", parsed.sourceEntityId);
        if (!process) return "unavailable";
        const nodeId = source.slice(source.lastIndexOf("/") + 1);
        const flow = await ctx.db
          .query("processFlows")
          .withIndex("by_clerkOrgId_and_processId", (q) => q.eq("clerkOrgId", orgId).eq("processId", process._id))
          .first();
        return flow?.nodes.some((node) => node.id === nodeId) ? "available" : "updated";
      }
      case "finding": {
        const doc = await getOrgEntity(ctx, orgId, parsed.sourceKind as HierarchyKind, parsed.sourceEntityId);
        if (!doc) return "unavailable";
        const findingId = source.slice(source.lastIndexOf("/") + 1);
        return hasFinding(doc, findingId) ? "available" : "updated";
      }
      case "overview":
      case "entity":
        return (await getOrgEntity(ctx, orgId, parsed.sourceKind as HierarchyKind, parsed.sourceEntityId))
          ? "available"
          : "unavailable";
    }
  };

  return (source: string): Promise<CitationAvailability> => {
    let result = cache.get(source);
    if (!result) {
      result = check(source);
      cache.set(source, result);
    }
    return result;
  };
}

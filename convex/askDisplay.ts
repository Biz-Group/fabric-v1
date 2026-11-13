import { v, type Infer } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { askEntityRefValidator, MAX_DISPLAY_REFS } from "./lib/askSchema";
import { requireOrgMember } from "./lib/orgAuth";
import { readableSummaryV2 } from "./lib/summaryV2Feature";
import { conversationCountsFor, getOrgEntity, overviewListState } from "./askTools/scope";

/**
 * What AskFabric's display parts show (D56). A display part stores
 * references only; these queries load what they point at as the viewer, on
 * every view, so a card always matches its workbench page and an entity the
 * viewer can no longer open is left out silently.
 */

/** Processes or departments read per card when counting children. */
const MAX_CHILDREN = 500;

const entityCardValidator = v.object({
  kind: v.union(v.literal("function"), v.literal("department"), v.literal("process")),
  id: v.string(),
  name: v.string(),
  /** Parent names, function first: "Operations › Dispatch". */
  trail: v.array(v.string()),
  /** Workbench ids for the card's link (FR-5.2). */
  path: v.object({
    fn: v.union(v.string(), v.null()),
    dept: v.union(v.string(), v.null()),
    proc: v.union(v.string(), v.null()),
  }),
  headline: v.union(v.string(), v.null()),
  overviewState: v.string(),
  overviewGeneratedAt: v.union(v.number(), v.null()),
  /** Processes: completed contributions. Rollups: null. */
  contributions: v.union(v.number(), v.null()),
  /** Functions: their departments. Others: null. */
  departments: v.union(v.number(), v.null()),
  /** Rollups: their processes. Processes: null. */
  processes: v.union(v.number(), v.null()),
});

async function processesIn(ctx: QueryCtx, orgId: string, departmentId: Id<"departments">) {
  return await ctx.db
    .query("processes")
    .withIndex("by_clerkOrgId_and_departmentId", (q) => q.eq("clerkOrgId", orgId).eq("departmentId", departmentId))
    .take(MAX_CHILDREN);
}

export type EntityCard = Infer<typeof entityCardValidator>;

/**
 * Entity cards for an org: up to 12, in the order given, unreadable ones left
 * out. Shared by AskFabric's cards and the MCP server's `showCards`.
 */
export async function buildEntityCards(
  ctx: QueryCtx,
  orgId: string,
  refs: ReadonlyArray<{ kind: "function" | "department" | "process"; id: string }>,
): Promise<EntityCard[]> {
  const cards: EntityCard[] = [];
  const seen = new Set<string>();
  for (const ref of refs.slice(0, MAX_DISPLAY_REFS)) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    const doc = await getOrgEntity(ctx, orgId, ref.kind, ref.id);
    if (!doc) continue;
    const overview = overviewListState(ref.kind, doc);
    const headline = readableSummaryV2(orgId, doc.summaryV2)?.headline ?? null;
    const base = {
      kind: ref.kind,
      id: doc._id as string,
      name: doc.name,
      headline,
      overviewState: overview.state,
      overviewGeneratedAt: overview.generatedAt,
    };

    if (ref.kind === "function") {
      const departments = await ctx.db
        .query("departments")
        .withIndex("by_clerkOrgId_and_functionId", (q) => q.eq("clerkOrgId", orgId).eq("functionId", doc._id as Id<"functions">))
        .take(MAX_CHILDREN);
      let processes = 0;
      for (const dept of departments) processes += (await processesIn(ctx, orgId, dept._id)).length;
      cards.push({
        ...base,
        trail: [],
        path: { fn: doc._id as string, dept: null, proc: null },
        contributions: null,
        departments: departments.length,
        processes,
      });
    } else if (ref.kind === "department") {
      const dept = doc as Doc<"departments">;
      const fn = await ctx.db.get(dept.functionId);
      cards.push({
        ...base,
        trail: [fn?.name ?? "Unknown"],
        path: { fn: dept.functionId as string, dept: dept._id as string, proc: null },
        contributions: null,
        departments: null,
        processes: (await processesIn(ctx, orgId, dept._id)).length,
      });
    } else {
      const process = doc as Doc<"processes">;
      const dept = await ctx.db.get(process.departmentId);
      const fn = dept ? await ctx.db.get(dept.functionId) : null;
      const counts = await conversationCountsFor(ctx, orgId, [process._id]);
      cards.push({
        ...base,
        trail: [fn?.name ?? "Unknown", dept?.name ?? "Unknown"],
        path: { fn: dept?.functionId ?? null, dept: process.departmentId as string, proc: process._id as string },
        contributions: counts.get(process._id)?.done ?? 0,
        departments: null,
        processes: null,
      });
    }
  }
  return cards;
}

/** Entity cards (Phase 2D.1): up to 12, in the order given, unreadable ones left out. */
export const getEntityCards = query({
  args: { refs: v.array(askEntityRefValidator) },
  returns: v.array(entityCardValidator),
  handler: async (ctx, args) => {
    const org = await requireOrgMember(ctx);
    return await buildEntityCards(ctx, org.orgId, args.refs);
  },
});

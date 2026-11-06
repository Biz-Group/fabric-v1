import { v, type ObjectType, type PropertyValidators } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { ASK_CHART_IDS, MAX_DISPLAY_REFS, type AskChartId, type AskDisplayPart } from "../lib/askSchema";
import { computeChart } from "../askCharts";
import { canContribute } from "../lib/roles";
import {
  orgViewerValidator,
  requireOrgViewer,
  type OrgViewer,
  type ResolvedViewer,
} from "../lib/orgAuth";
import { flowNeighbourhood } from "../lib/flowNeighbourhood";
import { getOrgEntity } from "./scope";
import type { HierarchyKind } from "./results";

/**
 * Display tools (D56): the model places a component by naming references,
 * never content. Each executor checks every reference as the viewer and
 * returns the part to store plus a one-line acknowledgement for the model.
 * The acknowledgement is plain text, not a search result, so it can't be cited.
 *
 * `allowed` is the turn's grounding set, passed by the loop and never by the
 * model: ids a tool returned this turn, the thread's context and mentions, and
 * entities cited or shown earlier in the thread. An id outside it is dropped,
 * so the model can't show something it invented or never looked at.
 */

export type AskDisplayResult = {
  part: AskDisplayPart | null;
  /** What the model is told: what was shown, or why nothing was. */
  note: string;
};

export function askDisplayQuery<Input extends PropertyValidators>(definition: {
  input: Input;
  handler: (
    ctx: QueryCtx,
    viewer: ResolvedViewer,
    input: ObjectType<Input>,
    allowed: ReadonlySet<string>,
  ) => Promise<AskDisplayResult>;
}) {
  return internalQuery({
    args: { viewer: orgViewerValidator, allowed: v.array(v.string()), ...definition.input },
    handler: async (ctx, args): Promise<AskDisplayResult> => {
      const { viewer, allowed, ...input } = args as { viewer: OrgViewer; allowed: string[] } & Record<string, unknown>;
      const resolved = await requireOrgViewer(ctx, viewer);
      return await definition.handler(ctx, resolved, input as ObjectType<Input>, new Set(allowed));
    },
  });
}

type EntityRef = AskDisplayPart["refs"][number];

function toRef(kind: HierarchyKind, id: string): EntityRef {
  switch (kind) {
    case "function":
      return { kind, id: id as Id<"functions"> };
    case "department":
      return { kind, id: id as Id<"departments"> };
    case "process":
      return { kind, id: id as Id<"processes"> };
  }
}

/**
 * The references that survive: in the grounding set, readable by the viewer,
 * not repeated, at most `max`. Returns their names too, for the note.
 */
async function groundedRefs(
  ctx: QueryCtx,
  viewer: ResolvedViewer,
  refs: Array<{ kind: HierarchyKind; id: string }>,
  allowed: ReadonlySet<string>,
  max: number,
) {
  const kept: EntityRef[] = [];
  const names: string[] = [];
  for (const ref of refs) {
    if (kept.length >= max) break;
    if (!allowed.has(ref.id) || kept.some((k) => k.id === ref.id)) continue;
    const doc = await getOrgEntity(ctx, viewer.orgId, ref.kind, ref.id);
    if (!doc) continue;
    kept.push(toRef(ref.kind, doc._id));
    names.push(doc.name);
  }
  return { refs: kept, names };
}

const NOT_GROUNDED =
  "Nothing shown. Show only entities a tool returned in this conversation, using the ids it gave.";

/**
 * The kind of entity a model-supplied id names, read from the id itself (a
 * Convex id encodes its table), or null for anything else. `show` takes bare
 * ids so its schema stays small: the strict-tool grammar is at its limit.
 */
function kindOfId(ctx: QueryCtx, id: string): HierarchyKind | null {
  if (ctx.db.normalizeId("processes", id)) return "process";
  if (ctx.db.normalizeId("departments", id)) return "department";
  if (ctx.db.normalizeId("functions", id)) return "function";
  return null;
}

type Grounded = {
  ctx: QueryCtx;
  viewer: ResolvedViewer;
  refs: Array<{ kind: HierarchyKind; id: string }>;
  /** How many ids the model passed, including any that name no entity. */
  requested: number;
  allowed: ReadonlySet<string>;
  nodeId: string;
};

/** A picker offers this many options at most (FR-11.4). */
export const MAX_CHOICES = 5;

/**
 * The disambiguation picker (FR-11.4): when a name matches several entities,
 * the user picks one instead of retyping it. The choice comes back as a new
 * question with the entity as a structured mention.
 */
async function choices({ ctx, viewer, refs: input, allowed }: Grounded): Promise<AskDisplayResult> {
  const { refs, names } = await groundedRefs(ctx, viewer, input, allowed, MAX_CHOICES);
  if (refs.length < 2) {
    return {
      part: null,
      note: "Nothing shown: a picker needs 2 to 5 entities a tool returned or the workspace contents list. If only one matches, answer about it.",
    };
  }
  return {
    part: { type: "display", display: "choices", refs },
    note: `Shown under your message: a picker with ${refs.length} options (${names.join(", ")}). The user's choice comes back as their next message; don't answer for them.`,
  };
}

/**
 * The contribute card (FR-11.5, D11): ways to add evidence to a thinly
 * covered process. Only members who can contribute ever get one, so a viewer
 * never stores a part offering what they can't do.
 */
async function contribute({ ctx, viewer, refs: input, allowed }: Grounded): Promise<AskDisplayResult> {
  if (!canContribute(viewer.role)) {
    return {
      part: null,
      note: "Nothing shown: this user can't add contributions. Don't suggest that they do; say who could (a contributor or admin).",
    };
  }
  const process = input.find((ref) => ref.kind === "process");
  const { refs, names } = process ? await groundedRefs(ctx, viewer, [process], allowed, 1) : { refs: [], names: [] };
  if (refs.length === 0) return { part: null, note: NOT_GROUNDED };
  return {
    part: { type: "display", display: "contribute", refs },
    note: `Shown under your answer: a card for adding a contribution to ${names[0]}.`,
  };
}

/** Entity cards (FR-11.1): a carousel from three. */
async function entities({ ctx, viewer, refs: input, requested, allowed }: Grounded): Promise<AskDisplayResult> {
  const { refs, names } = await groundedRefs(ctx, viewer, input, allowed, MAX_DISPLAY_REFS);
  const dropped = requested - refs.length;
  if (refs.length === 0) return { part: null, note: NOT_GROUNDED };
  return {
    part: { type: "display", display: "entities", refs },
    note: `Shown under your answer: ${refs.length} card${refs.length === 1 ? "" : "s"} (${names.join(", ")}).${
      dropped ? ` ${dropped} left out: not returned by a tool, unreadable, repeated or over ${MAX_DISPLAY_REFS}.` : ""
    }`,
  };
}

/**
 * The flow snippet (FR-11.3): one step of a process flow and the steps either
 * side of it. The process must be grounded; the step must be in its current
 * flow, so an id from a flow that has since regenerated shows nothing.
 */
async function flow({ ctx, viewer, refs: input, allowed, nodeId }: Grounded): Promise<AskDisplayResult> {
  const process = input.find((ref) => ref.kind === "process");
  const { refs, names } = process ? await groundedRefs(ctx, viewer, [process], allowed, 1) : { refs: [], names: [] };
  if (refs.length === 0) return { part: null, note: NOT_GROUNDED };
  const stepId = nodeId.trim();
  if (!stepId) {
    return { part: null, note: "Nothing shown: pass the step's id, as getProcessFlow or getFlowNode gave it, in nodeId." };
  }
  const row = await ctx.db
    .query("processFlows")
    .withIndex("by_clerkOrgId_and_processId", (q) =>
      q.eq("clerkOrgId", viewer.orgId).eq("processId", refs[0].id as Id<"processes">),
    )
    .first();
  const neighbourhood = row ? flowNeighbourhood(row, stepId) : null;
  if (!neighbourhood) {
    return { part: null, note: `Nothing shown: ${names[0]}'s current flow has no step with that id.` };
  }
  return {
    part: { type: "display", display: "flow", refs, nodeId: neighbourhood.step.id },
    note: `Shown under your answer: the step "${neighbourhood.step.label}" in ${names[0]}'s flow, with the steps either side of it.`,
  };
}

/**
 * A chart (FR-11.2): one of the fixed charts over a scope, the first grounded
 * id or the whole organization when none is given. The note names the chart,
 * never its numbers: the answer cites its counts from the tools.
 */
async function chart({ ctx, viewer, refs: input, requested, allowed }: Grounded, chartId: AskChartId): Promise<AskDisplayResult> {
  const { refs, names } = await groundedRefs(ctx, viewer, input, allowed, 1);
  if (requested > 0 && refs.length === 0) return { part: null, note: NOT_GROUNDED };
  const data = await computeChart(ctx, viewer.orgId, chartId, refs[0] ?? null);
  if (!data || data.rows.length === 0) {
    return { part: null, note: "Nothing shown: that chart has no data for this scope. Your answer stands without it." };
  }
  return {
    part: { type: "display", display: "chart", chartId, refs },
    note: `Shown under your answer: a chart of ${data.title.toLowerCase()} for ${names[0] ?? "the whole organization"}, with a table view.`,
  };
}

// ---- show --------------------------------------------------------------------

/**
 * The components `show` places. Each chart is its own kind rather than a
 * `chartId` input: an enum value costs the strict-tool grammar nothing, and a
 * field costs a unit it can't spare (MAX_GRAMMAR_UNITS).
 */
export const SHOW_KINDS = ["entities", "choices", "contribute", "flow", ...ASK_CHART_IDS] as const;

export const showInput = {
  kind: v.union(...SHOW_KINDS.map((kind) => v.literal(kind))),
  /** Entity ids, as tools gave them; each one's kind comes from the id. */
  refs: v.array(v.string()),
  /** A flow step's id for kind "flow"; "" otherwise (a sentinel, not null: strict tools allow few unions). */
  nodeId: v.string(),
};

/**
 * One tool places every component. Claude allows at most 20 strict tools per
 * request, and a non-strict tool in the mix made the model write tool calls
 * as text on dev (2026-11-05), so components share one strict tool.
 */
export const show = askDisplayQuery({
  input: showInput,
  handler: async (ctx, viewer, input, allowed) => {
    const refs = input.refs.flatMap((raw) => {
      const id = raw.trim();
      const kind = kindOfId(ctx, id);
      return kind ? [{ kind, id }] : [];
    });
    const grounded = { ctx, viewer, refs, requested: input.refs.length, allowed, nodeId: input.nodeId };
    switch (input.kind) {
      case "entities":
        return await entities(grounded);
      case "choices":
        return await choices(grounded);
      case "contribute":
        return await contribute(grounded);
      case "flow":
        return await flow(grounded);
      default:
        return await chart(grounded, input.kind);
    }
  },
});

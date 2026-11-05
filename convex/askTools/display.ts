import { v, type ObjectType, type PropertyValidators } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { MAX_DISPLAY_REFS, type AskDisplayPart } from "../lib/askSchema";
import {
  orgViewerValidator,
  requireOrgViewer,
  type OrgViewer,
  type ResolvedViewer,
} from "../lib/orgAuth";
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

const kindValidator = v.union(v.literal("function"), v.literal("department"), v.literal("process"));

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
  return { refs: kept, names, dropped: refs.length - kept.length };
}

const NOT_GROUNDED =
  "Nothing shown. Show only entities a tool returned in this conversation, using the ids it gave.";

// ---- showEntities ------------------------------------------------------------

export const showEntitiesInput = {
  refs: v.array(v.object({ kind: kindValidator, id: v.string() })),
};

/** Entity cards (FR-11.1): a carousel from three. */
export const showEntities = askDisplayQuery({
  input: showEntitiesInput,
  handler: async (ctx, viewer, input, allowed) => {
    const { refs, names, dropped } = await groundedRefs(ctx, viewer, input.refs, allowed, MAX_DISPLAY_REFS);
    if (refs.length === 0) return { part: null, note: NOT_GROUNDED };
    return {
      part: { type: "display", display: "entities", refs },
      note: `Shown under your answer: ${refs.length} card${refs.length === 1 ? "" : "s"} (${names.join(", ")}).${
        dropped ? ` ${dropped} left out: not returned by a tool, unreadable, repeated or over ${MAX_DISPLAY_REFS}.` : ""
      }`,
    };
  },
});

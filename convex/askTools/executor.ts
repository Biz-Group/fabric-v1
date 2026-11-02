import type { ObjectType, PropertyValidators } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";
import {
  orgViewerValidator,
  requireOrgViewer,
  type OrgViewer,
  type ResolvedViewer,
} from "../lib/orgAuth";
import type { AskToolResult } from "./results";

/**
 * Defines a tool executor (FR-1.3): an internal query that takes the viewer
 * from the turn, never from the model, and re-resolves it through the shared
 * resolver on every call. A member removed mid-turn gets the access error on
 * their next tool call, which ends the turn (FR-2.9).
 *
 * `input` is the model-facing argument set; the registry derives the strict
 * JSON schema from it, so the schema the model sees and the validator Convex
 * enforces cannot drift apart.
 */
export function askToolQuery<Input extends PropertyValidators>(definition: {
  input: Input;
  handler: (
    ctx: QueryCtx,
    viewer: ResolvedViewer,
    input: ObjectType<Input>,
  ) => Promise<AskToolResult>;
}) {
  return internalQuery({
    args: { viewer: orgViewerValidator, ...definition.input },
    handler: async (ctx, args): Promise<AskToolResult> => {
      const { viewer, ...input } = args as { viewer: OrgViewer } & Record<
        string,
        unknown
      >;
      const resolved = await requireOrgViewer(ctx, viewer);
      return await definition.handler(
        ctx,
        resolved,
        input as ObjectType<Input>,
      );
    },
  });
}

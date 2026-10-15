import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";

type MyPlacement = FunctionReturnType<typeof api.users.getMyPlacement>;

/** Whether the member owes this org a department right now, or null while
 * that isn't known (still loading, or the membership isn't provisioned yet).
 * The profile is global (once per person); placement is per org. It's only
 * asked once the org has departments to choose from, and not after the member
 * said they don't know (an admin places them instead). */
export function livePlacementGate(
  placement: MyPlacement | undefined,
): boolean | null {
  if (!placement) return null;
  return (
    placement.orgHasDepartments &&
    !placement.placement &&
    !placement.placementSkipped
  );
}

/** Latches the gate for one mount of the workspace page. It can close (the
 * member was placed or skipped) but never opens mid-session: the first
 * department someone creates would otherwise swap the workbench for "Where do
 * you sit?" under every unplaced member who's online, the creator included.
 * They're asked on the next load instead. An unknown `next` changes nothing. */
export function resolvePlacementGate(
  previous: boolean | null,
  next: boolean | null,
): boolean | null {
  if (next === null) return previous;
  if (previous === null) return next;
  return previous && next;
}

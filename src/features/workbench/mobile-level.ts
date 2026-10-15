import type { Id } from "../../../convex/_generated/dataModel";

/** Phone drill-down screens: 1 home/browse, 2 departments, 3 processes,
 * 4 process detail. */
export type MobileLevel = 1 | 2 | 3 | 4;

type MobileSelection = {
  fn: Id<"functions"> | null;
  dept: Id<"departments"> | null;
  proc: Id<"processes"> | null;
};

/** The deepest phone screen the selection can fill. */
export function deepestMobileLevel(sel: MobileSelection): MobileLevel {
  if (sel.proc) return 4;
  if (sel.dept) return 3;
  if (sel.fn) return 2;
  return 1;
}

/**
 * The phone screen to show. Deleting the open item, here or by another
 * member, clears part of the selection, and a screen deeper than what's left
 * would render empty with no way back, so step up to the deepest screen the
 * selection still fills. A shallower level is kept: tapping a row
 * previews an item without drilling in.
 */
export function clampMobileLevel(
  level: MobileLevel,
  sel: MobileSelection,
): MobileLevel {
  return Math.min(level, deepestMobileLevel(sel)) as MobileLevel;
}

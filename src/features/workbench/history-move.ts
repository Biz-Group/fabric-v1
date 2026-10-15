import type { SelectionParams } from "@/features/workbench/use-selection-params";
import { readSelectionParams } from "@/features/workbench/use-selection-params";

// --- Browser history for selection changes ---
// Back, in the app or the browser, should always go up the hierarchy. Moving
// deeper adds a history entry; switching tab or flow step at the same place
// replaces it; and moving up returns to the entry the user drilled down from,
// so the next Back can't go back down into what they just left.

type PlaceIds = Pick<SelectionParams, "fn" | "dept" | "proc">;

/** The workbench entries this session created, and which one is showing.
 * Entries are query strings. */
export type HistoryTrail = { entries: string[]; index: number };

export type HistoryMove =
  | { kind: "push" }
  | { kind: "replace" }
  | { kind: "back"; steps: number };

function deepestId(sel: PlaceIds): string | null {
  return sel.proc ?? sel.dept ?? sel.fn ?? null;
}

function isSamePlace(a: PlaceIds, b: PlaceIds): boolean {
  return deepestId(a) === deepestId(b);
}

/** Whether `ancestor` is a level above `sel` on its path (Home is above
 * everything). */
export function isStrictAncestor(ancestor: PlaceIds, sel: PlaceIds): boolean {
  if (ancestor.proc) return false;
  if (ancestor.dept) return ancestor.dept === sel.dept && sel.proc !== null;
  if (ancestor.fn) {
    return ancestor.fn === sel.fn && (sel.dept !== null || sel.proc !== null);
  }
  return deepestId(sel) !== null;
}

export function startTrail(query: string): HistoryTrail {
  return { entries: [query], index: 0 };
}

/** How to write the move from `current` (the URL) to `next`. */
export function planHistoryMove(
  trail: HistoryTrail,
  current: SelectionParams,
  next: SelectionParams,
): HistoryMove {
  if (isSamePlace(current, next)) return { kind: "replace" };
  if (!isStrictAncestor(next, current)) return { kind: "push" };

  // Walk back through the entries the user drilled down through. Stop at
  // anything outside `next`: going back past it would replay a detour.
  for (let i = trail.index - 1; i >= 0; i--) {
    const entry = readSelectionParams(new URLSearchParams(trail.entries[i]));
    if (isSamePlace(entry, next)) {
      return { kind: "back", steps: trail.index - i };
    }
    if (!isStrictAncestor(next, entry)) break;
  }
  // Nothing to return to (a deep link, or a reload): replace, so the entry
  // being left isn't one Back away.
  return { kind: "replace" };
}

/** The trail after the workbench writes `query` with `move`. */
export function applyHistoryMove(
  trail: HistoryTrail,
  move: HistoryMove,
  query: string,
): HistoryTrail {
  if (move.kind === "push") {
    const entries = [...trail.entries.slice(0, trail.index + 1), query];
    return { entries, index: entries.length - 1 };
  }
  if (move.kind === "replace") {
    const entries = [...trail.entries];
    entries[trail.index] = query;
    return { entries, index: trail.index };
  }
  return { entries: trail.entries, index: trail.index - move.steps };
}

/** The trail after the URL changed to `query` from outside the workbench:
 * Back, Forward, or a link. A single step either way is followed; anything
 * else starts a new trail, since its position in history is unknown. */
export function followUrlChange(
  trail: HistoryTrail,
  query: string,
): HistoryTrail {
  if (trail.entries[trail.index] === query) return trail;
  if (trail.entries[trail.index - 1] === query) {
    return { entries: trail.entries, index: trail.index - 1 };
  }
  if (trail.entries[trail.index + 1] === query) {
    return { entries: trail.entries, index: trail.index + 1 };
  }
  return startTrail(query);
}

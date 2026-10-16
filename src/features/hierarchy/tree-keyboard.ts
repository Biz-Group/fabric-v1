/**
 * Keyboard model for the process tree, following the WAI-ARIA tree view
 * pattern. Pure so it can be tested without a DOM: the navigator flattens its
 * visible rows, asks what a key does, and applies the answer.
 */

/** A row currently rendered in the tree, in display order. */
export type TreeNavRow = {
  id: string;
  /** The row this one is nested under, or null at the top level. */
  parentId: string | null;
  label: string;
  expandable: boolean;
  expanded: boolean;
};

export type TreeKeyInput = {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
};

export type TreeKeyAction =
  | { type: "focus"; id: string }
  | { type: "expand"; id: string }
  | { type: "collapse"; id: string }
  /** Open the row's actions menu (Shift+F10 or the ContextMenu key). */
  | { type: "openActions"; id: string }
  /** The key belongs to the tree but there's nothing to do (e.g. Down on the
   * last row). The caller still prevents the default so the list doesn't
   * scroll. */
  | { type: "none" };

/** What a key press on the row `currentId` does, or null if the tree doesn't
 * handle that key (Enter and Space are left to the row's native button, and
 * printable characters go to {@link findTypeaheadMatch}). */
export function getTreeKeyAction(
  rows: readonly TreeNavRow[],
  currentId: string,
  input: TreeKeyInput,
): TreeKeyAction | null {
  const index = rows.findIndex((row) => row.id === currentId);
  if (index === -1) return null;
  const row = rows[index];
  const { key, shiftKey, ctrlKey, metaKey, altKey } = input;

  if (
    !ctrlKey &&
    !metaKey &&
    !altKey &&
    ((key === "F10" && shiftKey) || (key === "ContextMenu" && !shiftKey))
  ) {
    return { type: "openActions", id: row.id };
  }
  if (shiftKey || ctrlKey || metaKey || altKey) return null;

  const focus = (target: TreeNavRow | undefined): TreeKeyAction =>
    target && target.id !== row.id
      ? { type: "focus", id: target.id }
      : { type: "none" };

  switch (key) {
    case "ArrowDown":
      return focus(rows[index + 1]);
    case "ArrowUp":
      return focus(rows[index - 1]);
    case "Home":
      return focus(rows[0]);
    case "End":
      return focus(rows[rows.length - 1]);
    case "ArrowRight": {
      if (row.expandable && !row.expanded) {
        return { type: "expand", id: row.id };
      }
      const next = rows[index + 1];
      return focus(next?.parentId === row.id ? next : undefined);
    }
    case "ArrowLeft": {
      if (row.expandable && row.expanded) {
        return { type: "collapse", id: row.id };
      }
      return focus(
        row.parentId
          ? rows.find((candidate) => candidate.id === row.parentId)
          : undefined,
      );
    }
    default:
      return null;
  }
}

/** Whether a key press should feed type-ahead: a single printable character
 * with no modifier other than Shift. Space is excluded, it activates. */
export function isTypeaheadKey(input: TreeKeyInput) {
  return (
    input.key.length === 1 &&
    input.key !== " " &&
    !input.ctrlKey &&
    !input.metaKey &&
    !input.altKey
  );
}

/** The row type-ahead moves to for `query` (what's been typed so far). A
 * query of one repeated character cycles through the rows starting with it;
 * anything longer matches from the current row onward. Wraps around. */
export function findTypeaheadMatch(
  rows: readonly TreeNavRow[],
  currentId: string,
  query: string,
): string | null {
  if (!query || rows.length === 0) return null;
  const needle = query.toLocaleLowerCase();
  const repeated = [...needle].every((char) => char === needle[0]);
  const search = repeated ? needle[0] : needle;
  const currentIndex = Math.max(
    0,
    rows.findIndex((row) => row.id === currentId),
  );
  // A fresh character starts after the current row; a longer query keeps the
  // current row if it still matches.
  const start = repeated ? currentIndex + 1 : currentIndex;
  for (let offset = 0; offset < rows.length; offset += 1) {
    const row = rows[(start + offset) % rows.length];
    if (row.label.trim().toLocaleLowerCase().startsWith(search)) return row.id;
  }
  return null;
}

/** The row that holds the tree's single tab stop: the first candidate that's
 * visible (the focused row, then the selection and its ancestors), else the
 * first row. */
export function pickTabStop(
  rows: readonly TreeNavRow[],
  candidates: readonly (string | null | undefined)[],
): string | null {
  for (const id of candidates) {
    if (id && rows.some((row) => row.id === id)) return id;
  }
  return rows[0]?.id ?? null;
}

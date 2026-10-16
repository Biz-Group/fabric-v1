// Pure helpers behind the command palette's combobox/listbox semantics, kept
// out of the component so they can be tested without a DOM.

/** Text for the palette's polite live region. */
export function resultCountMessage(count: number): string {
  if (count === 0) return "No results";
  return count === 1 ? "1 result" : `${count} results`;
}

/**
 * Splits the flat, already-ordered result list into consecutive runs of the
 * same kind, keeping each item's index in the flat list. The flat index is what
 * the keyboard highlight and aria-activedescendant follow.
 */
export function groupConsecutive<T extends { kind: string }>(
  items: readonly T[],
): { kind: T["kind"]; entries: { item: T; index: number }[] }[] {
  const groups: { kind: T["kind"]; entries: { item: T; index: number }[] }[] =
    [];
  items.forEach((item, index) => {
    const last = groups[groups.length - 1];
    if (last && last.kind === item.kind) {
      last.entries.push({ item, index });
    } else {
      groups.push({ kind: item.kind, entries: [{ item, index }] });
    }
  });
  return groups;
}

/** Moves the highlight by `delta`, wrapping at both ends. -1 when empty. */
export function moveHighlight(
  current: number,
  delta: number,
  count: number,
): number {
  if (count <= 0) return -1;
  // A cleared highlight (-1) arrowing down lands on the first row.
  const from = current < 0 ? (delta > 0 ? -1 : 0) : current;
  return (((from + delta) % count) + count) % count;
}

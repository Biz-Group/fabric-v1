// Roving focus across the transcript's "Play from" timestamp buttons. The
// transcript is one tab stop however long it is; Up and Down move between
// lines, Home and End go to the first and last.

/** The line a key moves focus to, or null when the key isn't a move key. */
export function transcriptKeyTarget(
  key: string,
  index: number,
  count: number,
): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  const from = Math.max(0, Math.min(index, last));
  switch (key) {
    case "ArrowDown":
      return Math.min(from + 1, last);
    case "ArrowUp":
      return Math.max(from - 1, 0);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

/**
 * The one line whose button is in the tab order. While focus is in the
 * transcript it's the focused line. Otherwise Tab lands on the line that's
 * playing, else the line last used, else the first.
 */
export function transcriptTabStop({
  focused,
  playing,
  lastFocused,
  count,
}: {
  focused: number | null;
  playing: number;
  lastFocused: number;
  count: number;
}): number {
  if (count <= 0) return -1;
  const clamp = (i: number) => Math.max(0, Math.min(i, count - 1));
  if (focused !== null) return clamp(focused);
  if (playing >= 0) return clamp(playing);
  return clamp(lastFocused);
}

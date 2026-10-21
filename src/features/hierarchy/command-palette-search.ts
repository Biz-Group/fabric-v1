// Pure matching and ranking behind the command palette's search, kept out of
// the component so it can be tested without a DOM.

export type SearchCandidate = {
  name: string;
  /** Ancestor names shown beside the result (function, department). */
  path: readonly string[];
};

/** Lower rank sorts first. */
function matchRank(
  candidate: SearchCandidate,
  query: string,
  tokens: readonly string[],
): number | null {
  const name = candidate.name.toLowerCase();
  const path = candidate.path.map((p) => p.toLowerCase());
  const everyTokenMatches = tokens.every(
    (t) => name.includes(t) || path.some((p) => p.includes(t)),
  );
  if (!everyTokenMatches) return null;
  if (name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;
  if (tokens.every((t) => name.includes(t))) return 2;
  // At least one token only matched the ancestor path.
  return 3;
}

/**
 * Filters `items` to those where every whitespace-separated query token
 * appears in the name or an ancestor name. Direct name matches rank above
 * path-only matches; ties sort by name, then path, so identically named
 * items in different departments stay in a stable order. Returns the first
 * `limit` matches and the total before the cap. An empty query returns
 * everything, uncapped.
 */
export function searchCandidates<T>(
  items: readonly T[],
  rawQuery: string,
  toCandidate: (item: T) => SearchCandidate,
  limit: number,
): { matches: T[]; total: number } {
  const query = rawQuery.trim().toLowerCase().replace(/\s+/g, " ");
  if (!query) return { matches: [...items], total: items.length };
  const tokens = query.split(" ");

  const ranked: { item: T; rank: number; name: string; path: string }[] = [];
  for (const item of items) {
    const candidate = toCandidate(item);
    const rank = matchRank(candidate, query, tokens);
    if (rank === null) continue;
    ranked.push({
      item,
      rank,
      name: candidate.name,
      path: candidate.path.join(" › "),
    });
  }
  ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.name.localeCompare(b.name) ||
      a.path.localeCompare(b.path),
  );
  return {
    matches: ranked.slice(0, limit).map((r) => r.item),
    total: ranked.length,
  };
}

/** Visible note under a capped group, e.g. "Showing 8 of 12". */
export function truncationMessage(shown: number, total: number): string | null {
  if (total <= shown) return null;
  return `Showing ${shown} of ${total} — refine your search`;
}

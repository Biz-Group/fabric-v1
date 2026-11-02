/**
 * Text normalisation for AskFabric's aggregation tools (T11, T15, T16, T17).
 *
 * Phase 1 merges items only when their normalised text is identical
 * (FR-1.14): "Re-keying into the ERP." and "re-keying into the ERP" are one
 * item; "Re-keying into SAP" is another. Semantic merging is Phase 2.
 */

/** Case-folded, punctuation-light, single-spaced. The merge key. */
export function normalizeKey(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[^\p{L}\p{N}'&+/#.\- ]+/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.\-/]+|[\s.\-/]+$/g, "")
    .trim();
}

const STOPWORDS = new Set([
  "a", "an", "and", "the", "of", "to", "in", "on", "for", "with", "by", "or", "at", "from", "into", "is", "are",
]);

/** Content words of a label, for similarity checks. */
export function keyTerms(text: string): Set<string> {
  return new Set(
    normalizeKey(text)
      .split(" ")
      .filter((word) => word.length > 1 && !STOPWORDS.has(word)),
  );
}

/** Jaccard overlap of two labels' content words, 0–1. */
export function termOverlap(a: string, b: string): number {
  const left = keyTerms(a);
  const right = keyTerms(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const term of left) if (right.has(term)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Whether `name` (a party, tool or actor) is mentioned in `text`, as whole words. */
export function mentions(text: string, name: string): boolean {
  const needle = normalizeKey(name);
  if (!needle) return false;
  const haystack = ` ${normalizeKey(text)} `;
  return haystack.includes(` ${needle} `);
}

/**
 * Phrases that mark manual rework (FR-1.14 `manualRework`). A heuristic, and
 * labelled as one in results. Maintained here: add a phrase when the eval shows
 * a miss, and keep each specific enough not to match ordinary work.
 */
export const MANUAL_REWORK_PHRASES = [
  "re-key",
  "rekey",
  "re key",
  "manual entry",
  "manually enter",
  "manually entered",
  "manually input",
  "manual input",
  "manual data entry",
  "copy-paste",
  "copy paste",
  "copy and paste",
  "copying and pasting",
  "duplicate entry",
  "double entry",
  "entered twice",
  "typed twice",
  "type it again",
  "spreadsheet workaround",
  "retype",
  "re-type",
  "re-enter",
  "reenter",
];

export function isManualRework(text: string): boolean {
  const key = normalizeKey(text);
  return MANUAL_REWORK_PHRASES.some((phrase) => key.includes(phrase));
}

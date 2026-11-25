/**
 * The flow model is told to omit `totalEstimatedDuration` when no duration is
 * stated, but it sometimes fills the field with a placeholder instead
 * ("<UNKNOWN>", "N/A", "Not specified"). Shown as is, that reads as a broken
 * value, so placeholders count as no duration at all.
 *
 * Used where the model's output is parsed and again wherever the value is
 * shown, because flows stored before this check can still hold a placeholder.
 */
const PLACEHOLDER_DURATIONS = new Set([
  "",
  "-",
  "unknown",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "tbd",
  "unspecified",
  "not specified",
  "not stated",
  "not known",
  "not available",
]);

export function cleanEstimatedDuration(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  // Strip wrapping brackets and quotes: "<UNKNOWN>", "[n/a]", "(unknown)".
  const bare = text
    .replace(/^[\s<[({"'`]+|[\s>\])}"'`.]+$/g, "")
    .trim()
    .toLowerCase();
  if (PLACEHOLDER_DURATIONS.has(bare)) return undefined;
  return text;
}

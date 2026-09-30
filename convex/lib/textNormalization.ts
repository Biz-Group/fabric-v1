/** Shared helpers for normalizing untrusted model output before it is stored. */

type UnknownRecord = Record<string, unknown>;

export function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

/** Collapses all whitespace to single spaces, then caps the length. */
export function normalizeInlineText(
  value: unknown,
  maxChars: number,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxChars).trim() : null;
}

/** Keeps paragraph breaks (at most one blank line), then caps the length. */
export function normalizeBlockText(
  value: unknown,
  maxChars: number,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized ? normalized.slice(0, maxChars).trim() : null;
}

/** Case-, punctuation- and width-insensitive form used to compare wording. */
export function normalizedSemanticText(value: string): string {
  return (
    value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.join(" ") ?? ""
  );
}

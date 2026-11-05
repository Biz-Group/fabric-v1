/**
 * "Ask about this" (Phase 2B.1): the page a question starts from travels in
 * the URL as `?context=process:<id>`, so the link works from anywhere and Back
 * returns to the page. The server re-checks it as the viewer (FR-4.2).
 */

export type AskContextRef = { kind: "function" | "department" | "process"; id: string };

export const CONTEXT_PARAM = "context";

const KINDS = new Set(["function", "department", "process"]);

/** The context in a `?context=` value, or null for anything malformed. */
export function parseContextParam(value: string | null): AskContextRef | null {
  const match = value?.match(/^(function|department|process):([A-Za-z0-9_-]{1,64})$/);
  if (!match || !KINDS.has(match[1])) return null;
  return { kind: match[1] as AskContextRef["kind"], id: match[2] };
}

/** A question put in the composer, not sent (Cmd+K, Phase 2B.2). */
export const PREFILL_PARAM = "q";

/** Questions longer than this are cut when carried in a link. */
const MAX_PREFILL_CHARS = 500;

export function askAboutHref(askHref: string, ref: AskContextRef | null, prefill?: string): string {
  const params = new URLSearchParams();
  if (ref) params.set(CONTEXT_PARAM, `${ref.kind}:${ref.id}`);
  const question = prefill?.trim().slice(0, MAX_PREFILL_CHARS);
  if (question) params.set(PREFILL_PARAM, question);
  const search = params.toString();
  return search ? `${askHref}?${search}` : askHref;
}

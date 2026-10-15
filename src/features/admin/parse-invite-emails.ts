const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Anything with an @ between separators. Names, angle brackets and quotes
// around an address (as pasted from Outlook or a spreadsheet) fall away.
const CANDIDATE_RE = /[^\s<>,;"'()[\]]+@[^\s<>,;"'()[\]]+/g;

export const MAX_INVITES_PER_BATCH = 50;

export type ParsedInviteEmails = {
  /** Distinct valid addresses, in the order pasted. */
  valid: string[];
  /** Things that look like an address but aren't one. */
  invalid: string[];
};

/** Reads one address or a pasted list, separated by commas, semicolons,
 * spaces or new lines. */
export function parseInviteEmails(text: string): ParsedInviteEmails {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const candidate of text.match(CANDIDATE_RE) ?? []) {
    const email = candidate.replace(/^mailto:/i, "").replace(/\.$/, "");
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (EMAIL_RE.test(email)) valid.push(email);
    else invalid.push(email);
  }
  return { valid, invalid };
}

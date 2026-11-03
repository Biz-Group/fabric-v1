/**
 * Inline mentions in the composer's plain text (FR-4.3). Typing `@` opens the
 * picker; the chosen entity goes into the text as a token: an invisible mark
 * followed by its name, so the chip drawn behind it shows just the name. The
 * reference is kept alongside and sent only while its token is still in the
 * text, so editing or deleting the token drops the mention.
 */

/** U+2063 INVISIBLE SEPARATOR: zero width, so the overlay stays aligned. */
export const MENTION_MARK = "\u2063";

export function mentionToken(name: string): string {
  return `${MENTION_MARK}${name}`;
}

/** The question as sent: mention marks removed, names left in place. */
export function plainText(text: string): string {
  return text.split(MENTION_MARK).join("");
}

/**
 * Inserts the mention token and a space at the caret, replacing the `@` the
 * user typed to open the picker when it sits just before the caret.
 */
export function insertMention(text: string, caret: number, name: string): { text: string; caret: number } {
  const at = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, at).replace(/@$/, "");
  const after = text.slice(at);
  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
  const inserted = `${needsLeadingSpace ? " " : ""}${mentionToken(name)} `;
  const rest = after.replace(/^ /, "");
  return { text: `${before}${inserted}${rest}`, caret: before.length + inserted.length };
}

/** Mentions whose token is still present in the text. */
export function activeMentions<T extends { name: string }>(mentions: T[], text: string): T[] {
  return mentions.filter((mention) => text.includes(mentionToken(mention.name)));
}

export type Segment = { text: string; mention: boolean };

/**
 * The text split into plain runs and mention tokens, for the highlight layer.
 * Longer names match first, so "Sales Ops" isn't read as "Sales".
 */
export function mentionSegments(text: string, names: string[]): Segment[] {
  const tokens = [...new Set(names)].map(mentionToken).sort((a, b) => b.length - a.length);
  const segments: Segment[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    const token = text[i] === MENTION_MARK ? tokens.find((t) => text.startsWith(t, i)) : undefined;
    if (token) {
      if (plain) segments.push({ text: plain, mention: false });
      plain = "";
      segments.push({ text: token, mention: true });
      i += token.length;
    } else {
      plain += text[i];
      i += 1;
    }
  }
  if (plain) segments.push({ text: plain, mention: false });
  return segments;
}

/**
 * Backspace right after a mention token deletes the whole token, so a mention
 * behaves as one unit. Null when the caret isn't at the end of a token.
 */
export function deleteMentionBefore(
  text: string,
  caret: number,
  names: string[],
): { text: string; caret: number } | null {
  const before = text.slice(0, caret);
  const token = [...new Set(names)]
    .map(mentionToken)
    .sort((a, b) => b.length - a.length)
    .find((t) => before.endsWith(t) || before.endsWith(`${t} `));
  if (!token) return null;
  const start = before.endsWith(`${token} `) ? caret - token.length - 1 : caret - token.length;
  return { text: text.slice(0, start) + text.slice(caret), caret: start };
}

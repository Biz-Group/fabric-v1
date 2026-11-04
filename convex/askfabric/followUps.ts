/**
 * Suggested follow-up questions under the latest answer. One short call after
 * the answer is stored, so it never slows the answer or touches its prompt.
 * Built from the answer and the sources it cited, so each suggestion points at
 * evidence AskFabric holds.
 */

export const FOLLOW_UP_COUNT = 3;
export const FOLLOW_UP_MAX_TOKENS = 200;
const MAX_ANSWER_CHARS = 6_000;
const MAX_QUESTION_CHARS = 1_000;
const MAX_LENGTH = 120;
const MIN_LENGTH = 8;

export const FOLLOW_UP_SYSTEM_PROMPT =
  "You suggest follow-up questions for AskFabric, which answers questions about how an organization works from " +
  "its interviews (called contributions), processes, process flows, departments and functions. " +
  `Reply with exactly ${FOLLOW_UP_COUNT} questions, one per line, and nothing else.`;

export type FollowUpInput = {
  question: string;
  answer: string;
  /** Titles of the sources the answer cited. */
  sources: string[];
  /** Every question already asked in the thread, so none is suggested again. */
  asked: string[];
};

export function followUpPrompt(input: FollowUpInput): string {
  const list = (items: string[]) => (items.length ? items.map((item) => `- ${item}`).join("\n") : "- none");
  return [
    `Question: ${input.question.slice(0, MAX_QUESTION_CHARS)}`,
    "",
    `Answer: ${input.answer.slice(0, MAX_ANSWER_CHARS)}`,
    "",
    "Sources the answer cited:",
    list([...new Set(input.sources)].slice(0, 20)),
    "",
    "Questions already asked in this thread:",
    list(input.asked.map((q) => q.slice(0, 200)).slice(-10)),
    "",
    `Write ${FOLLOW_UP_COUNT} follow-up questions this person is likely to ask next:`,
    "- one that digs deeper into a specific point in the answer,",
    "- one that compares with or widens to another area,",
    "- one about what to do next.",
    "Each must be under 12 words, in the person's own voice, and answerable from the same kind of evidence. " +
      "Name processes or departments from the sources where it helps. Don't repeat an earlier question. No numbering.",
  ].join("\n");
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The usable questions in the model's reply, at most three: one per line,
 * stripped of list marks and quotes, ending in a question mark, and none that
 * repeats an earlier question.
 */
export function parseFollowUps(raw: string, asked: string[]): string[] {
  const seen = new Set(asked.map(normalize));
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const text = line
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
      .replace(/^["“'`]+|["”'`]+$/g, "")
      .replace(/\*\*/g, "")
      .trim();
    if (text.length < MIN_LENGTH || text.length > MAX_LENGTH || !text.endsWith("?")) continue;
    const key = normalize(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === FOLLOW_UP_COUNT) break;
  }
  return out;
}

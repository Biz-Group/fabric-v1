/**
 * Fabric's official language is British English (2026-11-20). Every prompt
 * that writes text people read ends with this instruction.
 *
 * Adding it deliberately does not bump SUMMARY_V2_PROMPT_VERSIONS or the
 * recommendations prompt version: it changes spelling, not meaning, so stored
 * evidence, overviews and recommendations are not marked stale and nothing is
 * regenerated. Content picks up British spelling as it is next refreshed.
 */
export const BRITISH_ENGLISH_INSTRUCTION =
  "Write in British English spelling and usage (for example organisation, analyse, colour, centre, prioritise, judgement). " +
  "Quote people, names, systems and product labels exactly as given, and keep JSON keys, field names and fixed values exactly as specified.";

export function withBritishEnglish(systemPrompt: string): string {
  return `${systemPrompt.trimEnd()}\n\n${BRITISH_ENGLISH_INSTRUCTION}`;
}

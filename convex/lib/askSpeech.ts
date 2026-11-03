import { env } from "../_generated/server";

/**
 * Read aloud for AskFabric answers: which ElevenLabs voice and model, and the
 * answer's markdown turned into text worth hearing.
 */

/** The Fabric interviewer's voice, so AskFabric sounds like the rest of Fabric. */
export const DEFAULT_TTS_VOICE_ID = "l4Coq6695JDX9xtLqXDE";
/**
 * The lowest text-to-speech rate, shared with v4 Turbo, and much faster
 * without streaming: on 3 Nov, 2,451 characters took 3 s on Flash and 1,083
 * took 20 s on v4 Turbo.
 */
export const DEFAULT_TTS_MODEL = "eleven_flash_v2_5";
export const TTS_PROVIDER = "elevenlabs";
/** Speech-quality MP3, about half the size of the 128 kbps default. */
export const TTS_OUTPUT_FORMAT = "mp3_44100_64";
/** Far above any answer, and well inside a request's limit. */
export const MAX_SPEECH_CHARS = 10_000;

// The voice goes into the request path, so keep its alphabet narrow.
const VOICE_ID = /^[A-Za-z0-9]{1,64}$/;
const MODEL_ID = /^[a-z0-9_]{1,64}$/;

export function readSpeechConfig(): { voiceId: string; model: string } {
  const voiceId = env.ASKFABRIC_TTS_VOICE_ID?.trim();
  const model = env.ASKFABRIC_TTS_MODEL?.trim();
  return {
    voiceId: voiceId && VOICE_ID.test(voiceId) ? voiceId : DEFAULT_TTS_VOICE_ID,
    model: model && MODEL_ID.test(model) ? model : DEFAULT_TTS_MODEL,
  };
}

const TABLE_DIVIDER = /^\|?[\s:|-]*-{3,}[\s:|-]*$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;
const HEADING = /^#{1,6}\s+/;
const LIST_ITEM = /^([-*+]|\d+[.)])\s+/;
// A sources section the model wrote itself: the chips already cover it.
const SOURCES_HEADING = /^(#{1,6}\s+|\*\*)?(sources|references)\b[*:\s]*$/i;

function inline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<?https?:\/\/[^\s>)]+>?/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/**
 * The answer as it should sound: citation markers and markdown syntax gone,
 * table rows read as lists, and headings, list items and rows ended with a
 * full stop so the voice pauses instead of running them together.
 */
export function speakableText(markdown: string): string {
  const lines: string[] = [];
  for (const raw of markdown.replace(/\[\[cite:\d+\]\]/g, "").split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) {
      lines.push("");
      continue;
    }
    if (SOURCES_HEADING.test(line)) break;
    if (line.startsWith("```") || RULE.test(line) || TABLE_DIVIDER.test(line)) continue;
    const structural = HEADING.test(line) || LIST_ITEM.test(line) || line.startsWith("|");
    if (line.startsWith("|")) {
      line = line
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => inline(cell))
        .filter(Boolean)
        .join(", ");
    }
    line = inline(line.replace(HEADING, "").replace(/^>\s?/, "").replace(LIST_ITEM, ""));
    if (!line) continue;
    if (structural && !/[.!?:;]$/.test(line)) line += ".";
    lines.push(line);
  }
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length <= MAX_SPEECH_CHARS) return text;
  const cut = text.slice(0, MAX_SPEECH_CHARS);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
  return `${end > 0 ? cut.slice(0, end + 1) : cut} The rest of this answer is on screen.`;
}

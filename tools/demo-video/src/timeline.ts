// Scene timing, derived from the generated voiceover. Every visual cue in the
// composition is anchored to the moment a word is spoken (via ElevenLabs alignment).
import intro from "../public/vo/intro.json";
import tree from "../public/vo/tree.json";
import capture from "../public/vo/capture.json";
import conversations from "../public/vo/conversations.json";
import overview from "../public/vo/overview.json";
import flow from "../public/vo/flow.json";
import insights from "../public/vo/insights.json";
import automations from "../public/vo/automations.json";
import outro from "../public/vo/outro.json";
import durations from "../public/vo/durations.json";

export const FPS = 30;

type Alignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

// Exact clip lengths, written by tts.mjs.
const DURATIONS = durations as Record<(typeof ORDER)[number], number>;

export type SceneId = (typeof ORDER)[number];

const ALIGN: Record<SceneId, Alignment> = {
  intro, tree, capture, conversations, overview, flow, insights, automations, outro,
} as Record<SceneId, Alignment>;

export const ORDER = [
  "intro", "tree", "capture", "conversations", "overview", "flow", "insights", "automations", "outro",
] as const;

const LEAD: Partial<Record<SceneId, number>> = { intro: 1.2 };
const GAP = 0.55;
export const END_CARD = 3.2;

export const SCENES = (() => {
  let t = 0;
  const out = {} as Record<SceneId, { start: number; vo: number; end: number; dur: number }>;
  for (const id of ORDER) {
    const vo = t + (LEAD[id] ?? 0.3);
    const end = vo + DURATIONS[id] + GAP;
    out[id] = { start: t, vo, end, dur: DURATIONS[id] };
    t = end;
  }
  return out;
})();

export const TOTAL_SECONDS = SCENES.outro.end + END_CARD;

/** Absolute time (s) at which `phrase` starts (or ends) being spoken in a scene. */
export function w(scene: SceneId, phrase: string, edge: "start" | "end" = "start"): number {
  const a = ALIGN[scene];
  const text = a.characters.join("").toLowerCase();
  const i = text.indexOf(phrase.toLowerCase());
  if (i < 0) throw new Error(`"${phrase}" not found in ${scene}`);
  const local =
    edge === "start"
      ? a.character_start_times_seconds[i]
      : a.character_end_times_seconds[i + phrase.length - 1];
  return SCENES[scene].vo + local;
}

/** Spoken cues (tags stripped) with absolute times, for building WebVTT captions. */
export function captionCues(maxWords = 14) {
  const cues: { start: number; end: number; text: string }[] = [];
  for (const id of ORDER) {
    const a = ALIGN[id];
    // Build words with their timings, skipping [audio tags].
    const words: { text: string; start: number; end: number }[] = [];
    let cur = "";
    let s = 0;
    let inTag = false;
    a.characters.forEach((ch, i) => {
      if (ch === "[") inTag = true;
      if (inTag) {
        if (ch === "]") inTag = false;
        return;
      }
      if (/\s/.test(ch)) {
        if (cur) words.push({ text: cur, start: s, end: a.character_end_times_seconds[i - 1] });
        cur = "";
        return;
      }
      if (!cur) s = a.character_start_times_seconds[i];
      cur += ch;
    });
    if (cur) words.push({ text: cur, start: s, end: a.character_end_times_seconds.at(-1)! });

    let group: typeof words = [];
    const flush = () => {
      if (!group.length) return;
      cues.push({
        start: SCENES[id].vo + group[0].start,
        end: SCENES[id].vo + group.at(-1)!.end,
        text: group.map((g) => g.text).join(" ").replace(/\.\.\.$/, "…"),
      });
      group = [];
    };
    for (const word of words) {
      group.push(word);
      if (/[.!?:]$/.test(word.text) || (group.length >= 4 && /,$/.test(word.text)) || group.length >= maxWords) flush();
    }
    flush();
  }
  return cues;
}

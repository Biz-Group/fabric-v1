export type VttCue = {
  /** Seconds from the start of the video. */
  start: number;
  end: number;
  text: string;
};

const TIMING = /^\s*((?:\d+:)?\d{1,2}:\d{2}\.\d{3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}\.\d{3})/;

function toSeconds(timestamp: string) {
  const parts = timestamp.split(":").map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** The cues of a WebVTT file, in file order, for the tour transcript. Only
 * what the transcript needs: timings and plain text. Cue identifiers, NOTE
 * and STYLE blocks and settings after the timing are dropped, and inline tags
 * such as `<v Speaker>` or `<i>` are stripped. */
export function parseVtt(source: string): VttCue[] {
  const blocks = source.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const cues: VttCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex((line) => TIMING.test(line));
    if (timingIndex === -1) continue;
    const [, start, end] = lines[timingIndex].match(TIMING)!;
    const text = lines
      .slice(timingIndex + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    if (text) cues.push({ start: toSeconds(start), end: toSeconds(end), text });
  }
  return cues;
}

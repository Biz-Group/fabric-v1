// Writes WebVTT captions (audio tags stripped) aligned to the rendered video.
import fs from "node:fs";
import { captionCues } from "./timeline";

const ts = (s: number) => {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};
const cues = captionCues();
const body = cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(Math.min(Math.max(c.end + 0.25, c.start + 1), cues[i + 1]?.start ?? Infinity))}\n${c.text}`).join("\n\n");
fs.writeFileSync("out/fabric-tour.en.vtt", `WEBVTT\n\n${body}\n`);
console.log(cues.length, "cues");

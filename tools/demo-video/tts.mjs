// Generates one MP3 (+ character alignment) per script scene with Eleven v4.
// Also records each clip's exact duration (ffprobe) in public/vo/durations.json.
// Usage: ELEVENLABS_API_KEY=... node tts.mjs [sceneId ...]
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const VOICE = "tnSpp4vdxKPjI9w0GnoV";
const key = process.env.ELEVENLABS_API_KEY;
const scenes = JSON.parse(fs.readFileSync("script.json", "utf8"));
const only = process.argv.slice(2);
fs.mkdirSync("public/vo", { recursive: true });

for (const s of scenes) {
  if (only.length && !only.includes(s.id)) continue;
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=mp3_44100_192`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        text: s.text,
        model_id: "eleven_v4",
        seed: 7,
        voice_settings: { stability: 0.5, similarity_boost: 0.8 },
      }),
    },
  );
  if (!res.ok) {
    console.error(s.id, res.status, await res.text());
    process.exit(1);
  }
  const j = await res.json();
  fs.writeFileSync(`public/vo/${s.id}.mp3`, Buffer.from(j.audio_base64, "base64"));
  fs.writeFileSync(`public/vo/${s.id}.json`, JSON.stringify(j.alignment ?? j.normalized_alignment));
  const a = j.alignment;
  console.log(s.id, "ok", a ? `${a.character_end_times_seconds.at(-1).toFixed(2)}s` : "no alignment");
}

const durations = {};
for (const s of scenes) {
  durations[s.id] = Number(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `public/vo/${s.id}.mp3`])
      .toString()
      .trim(),
  );
}
fs.writeFileSync("public/vo/durations.json", JSON.stringify(durations, null, 1));

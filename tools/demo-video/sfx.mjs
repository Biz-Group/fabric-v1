// Downloads the UI sound effects (CC0 sounds from @remotion/sfx) into public/sfx/,
// trimmed so each one starts on its first audible sample: cues land on exact frames.
// Usage: node sfx.mjs
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const SOUNDS = {
  click: "https://remotion.media/mouse-click.wav", // Pixeliota, freesound 678248, CC0
  whoosh: "https://remotion.media/whoosh.wav", // 1bob, freesound 831936, CC0
};

fs.mkdirSync("public/sfx", { recursive: true });
for (const [name, url] of Object.entries(SOUNDS)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  const raw = `public/sfx/${name}.raw.wav`;
  fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-af", "silenceremove=start_periods=1:start_threshold=-50dB", `public/sfx/${name}.wav`]);
  fs.rmSync(raw);
  console.log(name, "ok");
}

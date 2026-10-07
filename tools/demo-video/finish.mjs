// Turns the Remotion master into the files the app serves from public/demo:
// a web-sized MP4 (loudness-normalised, faststart), a poster frame, and WebVTT captions.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { buildSync } from "esbuild";

const MASTER = "out/fabric-demo-master.mp4";
const DEST = "../../public/demo";
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

fs.mkdirSync(DEST, { recursive: true });

// Captions come from the same timeline module the composition uses.
buildSync({ entryPoints: ["src/gen-vtt.ts"], bundle: true, platform: "node", outfile: "out/gen-vtt.cjs", logLevel: "warning" });
run(process.execPath, ["out/gen-vtt.cjs"]);
fs.copyFileSync("out/fabric-tour.en.vtt", `${DEST}/fabric-tour.en.vtt`);

run("ffmpeg", [
  "-v", "error", "-y", "-i", MASTER,
  "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-tune", "stillimage", "-pix_fmt", "yuv420p",
  "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "128k",
  "-movflags", "+faststart",
  `${DEST}/fabric-tour.mp4`,
]);

// Poster: the intro title card once its tagline is fully on screen.
run("ffmpeg", ["-v", "error", "-y", "-ss", "9.6", "-i", MASTER, "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "3", `${DEST}/fabric-tour-poster.jpg`]);

for (const f of fs.readdirSync(DEST)) console.log(f, (fs.statSync(`${DEST}/${f}`).size / 1e6).toFixed(1), "MB");

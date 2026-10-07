# Product tour video

Builds the two-minute tour that first-time users open from the "Watch the 2-min tour"
button in the workspace header (`src/features/shell/product-tour.tsx`). The output
lives in `public/demo/`.

The video is built from real screens of the `biz-group` tenant. Before any screenshot
is taken, people's names are swapped for stand-ins in the browser. Captures are then
animated in [Remotion](https://remotion.dev) and synced to an ElevenLabs Eleven v4
voiceover.

Requirements: Node 24, Google Chrome, and `ffmpeg`/`ffprobe` on `PATH`.

```sh
cd tools/demo-video
npm install
```

## Regenerating

1. **Sign in.** Run `npm run login`. It opens Chrome on `biz-group.bizfabric.ai`. Sign
   in as an admin, and the window closes by itself. The session is kept in `profile/`,
   which is gitignored.
2. **Names to mask.** Copy `mask-names.example.json` to `mask-names.json`, then list
   every real name that can appear on screen, along with its stand-in. That includes
   contributors, people named in transcripts, and your own name. This file is
   gitignored.
3. **Capture.** Run `npm run capture`. It walks the tenant headlessly at 2× density and
   writes the stills, the scroll/pan frame sequences, and `manifest.json` to
   `public/cap/`. The run aborts if any real name from `mask-names.json` is still on
   screen in any state.
4. **Voiceover.** Run:
   ```sh
   ELEVENLABS_API_KEY=$(npx convex env get ELEVENLABS_API_KEY) npm run voice
   ```
   Run that last line from the repo root, or pass the key yourself. It sends
   `script.json` to the `eleven_v4` model with voice `tnSpp4vdxKPjI9w0GnoV` and writes
   one MP3 per scene, the character timings, and `durations.json` to `public/vo/`.
   - The `[tags]` in the script are Eleven v4 audio tags. They are performance
     direction, not words, and they are stripped from the captions.
   - Pass scene ids to regenerate only some scenes, for example `npm run voice -- intro`.
5. **Preview.** Run `npm run studio` to scrub the timeline.
6. **Render.** Run `npm run render`, then `npm run finish`. These write
   `fabric-tour.mp4`, `fabric-tour-poster.jpg`, and `fabric-tour.en.vtt` into
   `../../public/demo/`.

## When the UI changes

All visual cues in `src/Demo.tsx` are timed off spoken words through `w(scene, phrase)`,
so editing the script re-times the video automatically.

Cursor targets, highlights, and zooms use element boxes in 1920×1080 CSS pixels:

- Most boxes come from `public/cap/manifest.json`.
- A few were measured by hand from the stills, for example the evidence pills and the
  insight cards. These are marked in `B` in `src/Demo.tsx`. Re-check them after a
  layout change.

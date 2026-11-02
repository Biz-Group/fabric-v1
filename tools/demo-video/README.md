# Product tour video

Builds the two-minute tour that new members watch in the first-run welcome, and that
anyone can replay from the header's Help menu (`src/features/onboarding/tour-player.tsx`
plays it). The output lives in `public/demo/`. The welcome's transcript is read from the
`.vtt` captions, so keep them in step with the narration.

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
   `public/cap/`. It also takes a hover still before each click and one still per
   keystroke in the command palette. The run aborts if any real name from
   `mask-names.json` is still on screen in any state.
   - The check only knows the listed names. Look over new screens for anyone else,
     such as people named in recommendations.
   - It only views. It never clicks a decision, rating or regenerate control.
   - It clears any page zoom saved in `profile/`. A Ctrl+ during sign-in would
     otherwise rescale every capture.
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
5. **Sound effects.** Run `npm run sfx`. It downloads the click and whoosh (CC0, from
   `@remotion/sfx`) into `public/sfx/`.
6. **Preview.** Run `npm run studio` to scrub the timeline.
7. **Render.** Run `npm run render`, then `npm run finish`. These write
   `fabric-tour.mp4`, `fabric-tour-poster.jpg`, and `fabric-tour.en.vtt` into
   `../../public/demo/`. The render takes about 4 minutes.

## When the UI changes

All visual cues in `src/Demo.tsx` are timed off spoken words through `w(scene, phrase)`,
so editing the script re-times the video automatically.

Cursor targets, highlights, and zooms use element boxes in 1920×1080 CSS pixels. They
all come from `public/cap/manifest.json`, which `capture.mjs` measures from the live DOM.
After a layout change, run the capture again. Then check the boxes by drawing them over
their stills before you render.

## Notes

- There is deliberately no motion blur, light leak or text shine. They were tried in
  November 2026 and taken out:
  - `CameraMotionBlur` blends a stack of layers, which washed out and tinted frames as it
    switched on and off.
  - `HtmlInCanvasMotionBlur` fails to render on Windows in 4.0.539.
  - The `@remotion/effects` light leak shifted hue from frame to frame.
- To catch flashes before shipping, run `ffmpeg ... -vf signalstats` on the web MP4 and
  look for frames whose average colour jumps away and straight back.
- Highlights are drawn as depth of field. The target is a sharp copy of the screen,
  clipped to its box and lifted off a blurred, faded page.
  - Small targets inside a focused one use `ring: true`.
  - Back-to-back highlights share one focus span, so the page doesn't sharpen between
    them.
- The intro rings must stay strong enough to survive the web encode. At their earlier
  strength they sat 2–3 brightness levels off the paper and vanished.
- Remotion needs a Company License for organizations with more than 3 employees.

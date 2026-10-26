---
id: contribute-upload-audio
title: Upload existing audio
summary: Add a meeting recording, interview or voice memo to a process by uploading an audio file.
audience: [contributor, admin]
tags: [capture, upload, audio]
related: [label-speakers, contribute-record-conversation, after-you-contribute, contribute-on-behalf]
verifiedAgainst:
  - src/features/recording/recording-modal.tsx
  - src/features/recording/audio-file-type.ts
  - src/features/status/conversation-failure.ts
  - convex/lib/audioUpload.ts
  - src/features/release-notes/release-notes-data.ts
---

If you already have a recording, such as an interview, a meeting or a voice memo, you can upload it instead of recording again. Fabric handles it the same way as a live voice note. You need contributor or admin access.

## Upload a file

1. Open the process.
2. In the process header, select **Upload files**. On a phone, tap the **+** button (Add a contribution) and choose it there.
3. Check your name and read the recording notice, which says the uploaded audio will be transcribed and stored to help document your organization's processes.
4. Select **Choose audio file** and pick your file.
5. When it shows "Audio file ready", select **Upload and process**.

Keep the tab open until the upload finishes. If it is interrupted, select **Retry upload**.

## What Fabric accepts

- Formats: MP3, M4A, MP4, WAV, WebM, OGG, FLAC, AAC, AIFF or AMR.
- Size: up to 100 MB per file.
- Length: up to four hours of audio.
- Meeting videos saved as MP4 or WebM are accepted. For a very long meeting video, export just the audio as M4A or MP3 and upload that.

Fabric also checks that the file really is audio, and rejects files that are not.

## What happens next

Fabric transcribes the file and identifies the speakers. You then name each speaker before analysis starts. See "Label speakers before analysis". When processing finishes, the upload appears on the Contributions tab as an uploaded recording.

## When an upload fails

A contribution can show as Failed for reasons Fabric states, such as:

- The file could not be read, or no speech was found. Retrying will not help, so capture it again with a corrected file.
- The recording is longer than four hours. Upload a shorter one.
- Transcription or analysis did not finish. These are usually temporary, and an admin can retry them.

See "What happens after you contribute" for the full list of states.

---
id: contribute-record-conversation
title: Record a voice note in your browser
summary: Record yourself, or a conversation between people, directly in the browser without an AI interviewer.
audience: [contributor, admin]
tags: [capture, voice-note, recording]
related: [label-speakers, contribute-ai-interview, contribute-upload-audio, after-you-contribute, contribute-on-behalf]
verifiedAgainst:
  - src/features/recording/recording-modal.tsx
  - src/features/workbench/process-header.tsx
  - src/features/recording/speaker-label-review.tsx
  - docs/prd.md
---

A voice note records audio in your browser with no AI interviewer. Use it to describe a process in your own words, or to capture a conversation between people. You need contributor or admin access.

## Record a voice note

1. Open the process.
2. In the process header, select **Record a voice note**. On a phone, tap the **+** button (Add a contribution) and choose it there.
3. Check your name and read the recording notice, which says the recording will be transcribed and stored to help document your organization's processes.
4. Select **Start recording** and allow microphone access when your browser asks.
5. Speak through the steps, tools, handoffs and exceptions. A timer shows how long you have been recording.
6. Select **Stop recording**.
7. Choose **Submit voice note**, or **Discard** to throw the recording away.

Your recording is not saved until you submit it. If you close the window while recording or before submitting, Fabric asks you to confirm and then deletes it.

## What happens next

After you submit, the audio uploads and a progress percentage shows. Keep the tab open until the upload finishes. Fabric then transcribes the recording and identifies the different speakers.

Voice notes always go through a speaker step: you name each speaker before Fabric analyzes the content. See "Label speakers before analysis".

Once analysis finishes, the voice note appears on the Contributions tab and the dialog says "Voice note saved". Long recordings can take a few minutes, and you can close the window while Fabric works.

## If recording will not start

The dialog explains each cause and how to fix it: microphone access is blocked, no microphone is found, another app such as Teams or Zoom is using it, or the browser cannot record. You can choose **Upload files instead** if you already have the audio.

If the upload is interrupted, your recording stays on screen and you can select **Retry upload**.

## Recording for someone else

Admins can record on another person's behalf. See "Record on behalf of someone else".

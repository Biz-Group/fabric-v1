---
id: label-speakers
title: Label speakers before analysis
summary: After a voice note or upload is transcribed, name each speaker so Fabric can analyze the conversation. Analysis does not start until you do.
audience: [contributor, admin]
tags: [capture, speakers, review]
related: [contribute-record-conversation, contribute-upload-audio, after-you-contribute]
verifiedAgainst:
  - src/features/recording/speaker-label-review.tsx
  - src/features/recording/recording-modal.tsx
  - src/features/conversations/conversation-log.tsx
  - src/features/workbench/process-header.tsx
  - src/features/status/status-meta.ts
  - src/app/[org]/admin/conversations/page.tsx
  - convex/voiceRecordings.ts
  - docs/prd.md
---

When you record a voice note or upload audio, Fabric transcribes it and works out how many people are speaking. Before it analyzes anything, it asks you to say who they are. This is a deliberate review step: the names you give are used in the transcript, the summary and the process analysis, and Fabric does not identify speakers by their voices.

## Label the speakers

The review appears right after transcription, inside the same dialog. For each speaker it shows:

- A name field, starting with a default such as Speaker 1. Replace it with the person's real name.
- A **Member** choice. Pick a workspace member to link the speaker to their Fabric account, or leave it as **No linked member** for someone outside the workspace.
- A couple of sample lines, so you can tell who is who.
- A player for the recording audio, when it is available.

Every speaker needs a name. When you are done, select **Save and Analyze**. Fabric confirms "Speaker labels saved. Analysis is running." and begins analysis.

## If you leave before labeling

You can close the dialog at any time. The contribution is kept and waits for you. Fabric tells you that you can label the speakers later from this process.

To come back to it:

- Select the **Needs labels** badge next to the process title. It jumps you to the Contributions tab.
- Or open the contribution on the Contributions tab. The speaker review appears there.
- Admins can also choose **Label speakers** from the actions menu on Admin, then Contributions.

While a contribution is waiting, it shows as **Needs labels** in the process and in the tree. Nothing is analyzed, and the process overview does not include it yet.

## Who can label

Contributors and admins can label speakers. Viewers see a note that Fabric is waiting for a contributor to name the speakers before analysis runs.

## Does this apply to AI interviews?

No. AI interviews have no speaker step. Speaker labeling applies only to voice notes and uploaded audio.

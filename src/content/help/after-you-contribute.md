---
id: after-you-contribute
title: What happens after you contribute
summary: The stages a contribution goes through, what Processing, Needs labels, Completed and Failed mean, and how failed ones are retried.
audience: [viewer, contributor, admin]
tags: [capture, status, processing, retry]
related: [label-speakers, contribute-upload-audio, reading-the-overview, reading-the-process-flow, admin-members-and-workspace]
verifiedAgainst:
  - src/features/status/status-meta.ts
  - src/features/status/conversation-failure.ts
  - src/features/conversations/conversation-failure-notice.tsx
  - src/features/conversations/use-retry-conversation.ts
  - src/features/conversations/conversation-log.tsx
  - src/features/recording/recording-modal.tsx
  - src/features/workbench/process-header.tsx
  - convex/lib/conversationPipelines.ts
  - convex/voiceRecordings.ts
---

Once you finish a contribution, Fabric does the rest on its own. You do not need to press a separate "generate" button.

## The stages

1. **Processing**: Fabric is transcribing and analyzing. Long recordings can take a few minutes. You can close the dialog and carry on, and the contribution appears on the process's Contributions tab when it is ready.
2. **Needs labels** (voice notes and uploads only): Fabric is waiting for someone to name the speakers before it analyzes anything. See "Label speakers before analysis".
3. **Completed**: processing finished and the contribution is part of the evidence. This does not mean it covers the whole process.
4. **Failed**: something stopped processing.

You will see these as badges on each contribution, and the most urgent one also shows beside the process title. A process with nothing pending shows no badge.

## What updates next

When a contribution completes, Fabric starts refreshing the process Overview and the Process Flow, independently of each other. While that happens, the Overview shows Refreshing and the Process Flow tab shows its progress. Department and function overviews can show New evidence until they are refreshed to include the change. See "Reading the Overview" and "Reading the Process Flow".

## When something fails

A failed contribution explains why, in plain words:

- The audio could not be read, was no longer available, was longer than four hours, or contained no speech. Retrying will not help. Capture it again.
- Transcription or analysis did not finish, or Fabric could not fetch the interview. These are usually temporary, and a retry can fix them.
- The voice service reported that an interview did not complete. Capture it again.

## Retrying

Only admins can retry. On a failed contribution, the button reads **Retry fetch** for an AI interview, **Retry transcription** if there is no transcript yet, or **Retry summary generation** if the transcript was saved. Fabric reruns only the stage that failed. Admins can also retry from Admin, then Contributions.

If you are not an admin, the contribution says "Ask an admin to retry it." If you were still in the dialog, you can also choose **Discard recording** to delete it.

## Closing early

If you close a voice note before submitting it, Fabric asks you to confirm and deletes it. Once it is submitted, it is kept even if you close the window.

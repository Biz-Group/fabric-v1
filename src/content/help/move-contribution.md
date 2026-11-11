---
id: move-contribution
title: Move a contribution to another process
summary: Admins can move a finished contribution recorded under the wrong process to any other process in the workspace.
audience: [admin]
tags: [admin, contributions, move, process]
related: [admin-members-and-workspace, reading-the-overview, after-you-contribute]
verifiedAgainst:
  - convex/conversations.ts
  - convex/lib/processEvidenceInvalidation.ts
  - src/features/admin/move-contribution-dialog.tsx
  - src/features/admin/conversation-transcript-dialog.tsx
  - src/app/[org]/admin/conversations/page.tsx
  - src/features/conversations/conversations-tab.tsx
---

Sometimes a contribution is recorded under the wrong process. An admin can move it to the process it belongs to instead of deleting it and recording it again.

## How to move one

1. Find the contribution. On a process's **Contributions** tab, open the **⋯** menu on its card. Or open **Admin**, then **Contributions**, and open the row's menu.
2. Choose **Move**. You can also use the same button at the bottom of a contribution's transcript.
3. Search for the process it belongs in and pick it. Processes are grouped by function and department.
4. Read what will happen, add a reason if you like, and choose **Move**.

Only finished contributions can be moved. If a contribution still needs speaker labels, label them first. If it failed, retry it first. Contributions that are still processing can't be moved until they finish.

## What changes

- **Both processes are marked out of date.** Their overviews and flows keep showing what they had, with a Rebuild control, until someone rebuilds them. Nothing is rebuilt automatically, so tidying up several contributions doesn't run a rebuild for each one.
- **The old process's last contribution:** if nothing finished is left there, its overview and flow are cleared.
- **The new process's first contribution:** its overview and flow start building straight away.
- **The contribution itself doesn't change.** Its transcript, summary, audio and contributor stay the same, and it doesn't need to be processed again.
- **AI interviews still mention the old process.** The interviewer was asked about the process the interview was recorded under, so the transcript refers to that process. Fabric warns you before you move an AI interview.

## After the move

The transcript shows who moved the contribution, when, where it moved from and to, and the reason if one was given. Links to the contribution in its old process show where it lives now, with a button to open it there.

Only admins can move contributions, and only within the same workspace. The same **⋯** menu also has **Delete**, which needs a reason.

---
id: contribute-on-behalf
title: Record on behalf of someone else
summary: Admins can file an interview, voice note or upload for another person, with their consent recorded and both names shown.
audience: [admin]
tags: [capture, admin, attribution, consent]
related: [roles-and-permissions, contribute-ai-interview, contribute-record-conversation, contribute-upload-audio]
verifiedAgainst:
  - src/features/recording/recording-modal.tsx
  - convex/postCall.ts
  - src/features/workbench/process-header.tsx
  - src/features/conversations/conversations-tab.tsx
  - src/features/admin/conversations-export.ts
  - docs/prd.md
---

Sometimes the person who knows a process cannot sit at the keyboard, for example when you interview a colleague or someone outside your workspace. Admins can file a contribution for them. Only admins can do this, because the recording notice is consent from whoever is present, and Fabric wants a record of who submitted it.

## How to do it

1. Open the process and start any capture option: **Start AI interview**, **Record a voice note** or **Upload files**.
2. In the first step, under **Who is being recorded?**, choose **Myself**, **A team member** or **Someone else**.
   - **A team member**: select the person from the list of workspace members.
   - **Someone else**: type their full name. Use this for people who do not have a Fabric account.
3. Read the recording notice. Because you are recording on their behalf, show or read it to the person before you start, or before uploading their audio.
4. Tick the confirmation that the person was shown the notice and consented to being recorded, transcribed and analyzed. The confirmation is stored against your account. You cannot continue without it.
5. Continue as usual: start the interview, start recording, or choose the file.

Everything else works the same as a normal contribution, including naming speakers for voice notes and uploads.

## How it appears

The contribution is attributed to the person who was recorded, not to you:

- The process header shows their name with "(submitted by" and your name.
- On the Contributions tab, the contribution shows "Submitted by" with your name.
- The admin CSV export includes who submitted it and when consent was confirmed.

## If you are not an admin

Contributors and viewers do not see the "Who is being recorded?" choice. Contributors always record as themselves. Ask an admin if you need a contribution filed for someone else.

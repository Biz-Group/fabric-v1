---
id: askfabric
title: Ask questions with AskFabric
summary: Ask about how your organization works in plain words and get answers built from your workspace's evidence, with every claim linked to its source.
audience: [viewer, contributor, admin]
tags: [askfabric, questions, sources, threads, beta]
related: [reading-the-overview, reading-the-process-flow, insights-and-recommendations, roles-and-permissions]
verifiedAgainst:
  - src/features/ask/ask-page.tsx
  - src/features/ask/ask-conversation.tsx
  - src/features/ask/ask-composer.tsx
  - src/features/ask/ask-citations.tsx
  - src/features/ask/ask-thought-trace.tsx
  - src/features/ask/ask-thread-list.tsx
  - src/features/ask/ask-feedback.tsx
  - src/features/ask/ask-answer-actions.tsx
  - src/app/[org]/admin/askfabric/page.tsx
  - convex/lib/askLimits.ts
  - convex/askfabric/systemPrompt.ts
---

AskFabric answers questions about how your organization works from the contributions, overviews and process flows you can see in Fabric, and links every claim to its evidence.

## Asking a question

Open **AskFabric** in the sidebar and type a question, or pick a suggested one. To point at a process, department or function, type **@** or press the **@** button and pick it.

A status line shows what AskFabric is doing. When the answer arrives, its steps fold into a line you can open. The stop button ends an answer early and keeps what it wrote. If an answer fails, press **Retry**.

## Checking the sources

Each claim carries a numbered source. Hover over it, or tap it on a phone, to read the quoted evidence. Follow it to the finding, flow step, contribution or transcript line it came from. The **Sources** list under each answer groups them. A source reads "Source no longer available" if what it quoted was deleted.

## What it will and won't do

- It answers only from your workspace's evidence and Fabric's help, never from general knowledge.
- It says how much of the organization its answer covers.
- Fabric holds no financial data, so "impact" is judged from the evidence: how many processes and people a problem affects.
- It doesn't profile, rank or judge individual people, or recommend products or vendors.
- It sees only what you can see.

## Your threads

Each conversation is a thread in the side panel, or under **Threads** on a phone. Threads are private to you; admins can't read them. From a thread's menu you can rename, pin (up to 10), archive or delete it. If you leave a workspace, your threads there are deleted.

## Daily limits during the beta

Each person can ask 10 questions a day, and each workspace 100. Failed answers don't count, and the limits reset at midnight Gulf time. With 5 or fewer left, the line under the question box says how many. You can have one answer in progress at a time.

## Under each answer

The copy button copies the answer with its sources listed. The speaker reads it aloud; press again to pause. Use the thumbs to rate it. If you mark it unhelpful, you can tick **Share this exchange with the Fabric team** and add a note. A shared exchange holds your question, the answer and the quoted content. It is kept for 90 days, and you can unshare it at any time.

## For admins

**Admin**, then **AskFabric**, shows questions, active users, ratings and error rates over 30 days, with counts per member and a list of ratings. It never shows anyone's questions or answers.

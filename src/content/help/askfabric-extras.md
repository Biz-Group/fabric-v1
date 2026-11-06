---
id: askfabric-extras
title: Cards, charts and asking from a page in AskFabric
summary: The cards, flow snippets, charts, choices and contribution shortcuts that can follow an AskFabric answer, and how to ask about the page you're on.
audience: [viewer, contributor, admin]
tags: [askfabric, cards, charts, flow, ask-about-this, beta]
related: [askfabric, reading-the-process-flow, insights-and-recommendations]
verifiedAgainst:
  - src/features/ask/display/ask-display.tsx
  - src/features/ask/display/entity-cards.tsx
  - src/features/ask/display/flow-snippet.tsx
  - src/features/ask/display/ask-chart.tsx
  - src/features/ask/display/choice-picker.tsx
  - src/features/ask/display/contribute-card.tsx
  - src/features/ask/ask-about-link.tsx
  - src/features/hierarchy/command-palette.tsx
  - convex/askTools/display.ts
---

Some AskFabric answers end with something you can open or use. It always comes after the full answer and adds to it; the answer still reads in full without it.

## What can follow an answer

- **Cards** for the processes, departments or functions an answer is about. Each card opens that page.
- **A flow snippet** when a question is about one step: the step, with the steps just before and after it. Select a step, or **Open in Flow**, to open the Process Flow tab on it.
- **A chart** when an answer compares counts, such as friction by process or coverage by department. Select a bar to open where it comes from. **Show as table** shows the same numbers as a table.
- **A choice** when the name you used matches more than one thing. Pick one and AskFabric answers about it. A choice counts as a question.
- **Ways to add evidence** when a process has little: **Start AI interview**, **Record a voice note** and **Upload files**. Only contributors and admins see these.

## Always current

Cards, snippets and charts load when you view them, so they show today's data and only what you can see now. A chart says "updated since this answer" when its data has changed since the answer was written; the answer keeps the numbers it cited then.

The copy and speaker buttons use the answer text only.

## Asking about what you're looking at

On a process, department or function page, press **Ask about this**. AskFabric opens a new thread about it, with a few suggested questions to start from.

In the workbench, the search box (**Ctrl K**, or **⌘ K** on a Mac) offers **Ask Fabric** once you've typed a few letters. It puts what you typed in the question box without sending it, so it doesn't use a question until you send it.

---
id: reading-the-overview
title: Reading the Overview
summary: How to read a process, department or function Overview, including evidence levels, coverage and what the status labels mean.
audience: [viewer, contributor, admin]
tags: [overview, evidence, coverage, status]
related: [what-is-fabric, after-you-contribute, reading-the-process-flow, insights-and-recommendations]
verifiedAgainst:
  - src/features/overview/process-overview.tsx
  - src/features/overview/hierarchy-overview.tsx
  - src/features/overview/overview-primitives.tsx
  - src/features/overview/overview-view-model.ts
  - src/features/overview/process-overview-key-facts.ts
  - src/features/status/status-meta.ts
  - docs/prd.md
---

The Overview answers "How does this work, and what should I know first?" Every statement in it is built from contributions and links back to them.

## Reading a process Overview

- **Headline and brief** at the top give the short version. Below them, key facts such as what starts the process, what finished looks like, who runs it and what it depends on appear, plus the first open question. Select a fact to jump to the full finding and its sources.
- **Evidence coverage** shows Contributions included, Eligible contributions, Unique contributors, and whether coverage is Complete or Partial.
- **Scope and participants** covers what contributors say the process includes, who runs it and what it depends on.
- **Reported practice** lists different ways people describe doing the work. These are reported differences, not measurements.
- **Evidence alignment** separates Agreements from Knowledge gaps and tensions.
- **Context worth carrying forward** holds other useful background.

The "On this page" row jumps between sections. At the bottom, "Continue exploring" opens the Process Flow and Process Insights and tells you whether each is ready.

## Evidence levels

Each finding shows how well supported it is:

- **Corroborated**, with the number of sources, means several contributions back it.
- **Single source** means one contribution supports it.
- **Evidence gap** means nothing directly supports it. Fabric flags it as a gap rather than guessing.

Source chips next to a finding open the contribution it came from.

## Status labels

The label beside the title tells you how current the Overview is. Select it to read more.

- **Not documented**: no Overview yet.
- **Current**: reflects the latest evidence.
- **New evidence**: contributions arrived after it was built. The previous version stays visible.
- **Refreshing**: Fabric is rebuilding it in the background, sometimes with a progress count.
- **Partial coverage**: useful, but not every eligible source was included.
- **Refresh failed**: the last refresh failed, and the previous version remains available.


## Copying and rebuilding

**Copy** copies the Overview as text. Contributors and admins also see **Build overview**, **Refresh overview** or **Rebuild overview**. The button is turned off, with the reason on hover, when there is nothing new to include, or when no contribution has been completed yet.

## Department and function Overviews

These roll up the overviews beneath them and lead with a brief. A coverage section lists each child with its status and how many sources it used. Department Overviews cover cross-process dependencies, shared patterns, and variations and tensions. Function Overviews cover cross-department dependencies, strategic patterns, and variations and tensions. Both end with knowledge gaps and context worth carrying forward. Select a child to open it.

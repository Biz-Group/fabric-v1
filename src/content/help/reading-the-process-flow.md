---
id: reading-the-process-flow
title: Reading the Process Flow
summary: How to read the process diagram, open step details, spot bottlenecks and handoffs, and use the map controls.
audience: [viewer, contributor, admin]
tags: [process-flow, diagram, navigation]
related: [reading-the-overview, insights-and-automations, after-you-contribute]
verifiedAgainst:
  - src/features/process-flow/process-flow.tsx
  - src/features/process-flow/process-flow-tab.tsx
  - src/features/process-flow/process-flow-nodes.tsx
  - src/features/process-flow/process-flow-detail-panel.tsx
  - src/features/process-flow/process-flow-edges.tsx
  - src/features/process-flow/flow-spotlight.ts
  - src/features/process-flow/flow-view-preferences.ts
  - docs/prd.md
---

The Process Flow tab shows the order work happens in, as a diagram built from what contributors said. The tab header shows when it was last generated.

## When the flow appears

Fabric builds the flow automatically after a contribution completes. First it maps the process ("Generating process flow…"). As soon as the diagram exists it appears, and a banner shows "Describing steps" with a count while each step's details fill in. You can use the diagram while that finishes.

If no flow exists yet, contributors and admins see **Generate Process Flow**, which needs at least one completed contribution. Viewers are told a contributor or admin can generate it.

Two banners are worth knowing:

- **New evidence available**: new contributions arrived after the flow was built. Contributors and admins can select **Refresh**.
- **Couldn't refresh, showing the previous version**: the last attempt failed, and the earlier flow is still shown. Use **Try Again**.

## Reading the diagram

Each box is a step, labelled as a Start, End, Action, Decision, Handoff or Wait. Lines show what leads to what, with labels on branches. Conditional, parallel, fallback and normal connections look different. Steps may carry a **Bottleneck** or **Tribal Knowledge** tag.

Select a step to open its details panel. It can show the description, actors, tools and systems, estimated duration, automation potential, confidence, pain points, risk indicators and sources. Confidence reads High (confirmed by multiple sources), Medium (single clear source) or Low (inferred or vague). Source entries open the original contribution, and the connected steps listed there are clickable. If a step could not be described, contributors and admins can choose **Retry this step**.

## Spotlights

A summary bar shows the number of steps, the estimated total duration when known, and four buttons: **Bottlenecks**, **Handoffs**, **Automatable steps** and **Tools**. Select one to highlight the matching steps, and select it again to clear it. **Open Insights** takes you to the Insights tab.

## Controls

- **Zoom in** and **Zoom out**, **Fit entire process**, and **Center selected step**.
- **Horizontal layout** or **Vertical layout**.
- **Process view** or **Owner lanes**, which groups steps by who does them. Steps with several actors sit in a Shared lane.
- **Show minimap** or **Hide minimap**.
- **Enter fullscreen**, and **Exit fullscreen** (or press Esc).
- Drag the divider beside the details panel to resize it.

The diagram opens around the first step. Your layout choices are remembered on your device.

## Keyboard

With a step focused, use the arrow keys to move to a directly connected step, press Enter to open its details, and press Escape to close them.

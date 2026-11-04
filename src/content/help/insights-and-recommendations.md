---
id: insights-and-recommendations
title: Using Insights and Recommendations
summary: Find where a process needs attention on the Insights tab, and decide what to change from the Recommendations tab — technical or not.
audience: [viewer, contributor, admin]
tags: [insights, recommendations, change plan, brief]
related: [reading-the-process-flow, reading-the-overview, pdf-report]
verifiedAgainst:
  - src/features/insights/process-insights-tab.tsx
  - src/features/insights/insights-derivations.ts
  - src/features/recommendations/process-recommendations-tab.tsx
  - src/features/recommendations/recommendation-detail.tsx
  - src/features/recommendations/change-plan.ts
  - src/features/automations/opportunity-brief.ts
  - convex/recommendations.ts
  - convex/lib/recommendationScoring.ts
  - docs/process-improvement-recommendations-plan.md
---

Insights shows where a process needs attention. Recommendations says what to change and what evidence supports it. Both are built from the process's Process Flow, so they update when it does.

## Insights tab

It appears once the flow's steps are described. Without a flow, contributors and admins can generate one.

- **Key findings** come first: the places to look at first, each with a button such as **Show in flow** or **Open Recommendations**.
- **Metric tiles** count Evidence (contributions used), Mapped Steps, Handoffs, Tools, Decisions, Bottlenecks, Automations and Low Confidence.
- **Detail sections** go deeper, from Handoffs and Automation Opportunities to Tribal Knowledge Risk and Evidence Coverage.

An empty Key findings reflects what contributors described, not proof of no issues. Watch for these notices:

- **Some steps could not be described**: the counts are a minimum. Use **Regenerate**.
- **Insights may be based on stale flow data**: use **Refresh**.

## Recommendations tab

A process gets up to five once its flow is ready. Zero is a real answer: nothing described needs changing.

Each is one kind of change:

- **Non-technical**: Remove a step, Simplify, Standardise, Role or policy, Training.
- **Technical**: Workflow, Integration, AI assist, Agent.

Fabric prefers the lighter change when two would work equally well. The list is ranked by **Value**, then **Effort**, both worked out from the flow:

- **Value** weighs how often the work happens, the problems and bottlenecks reported on those steps, and the roles involved. It shows **Unknown** when contributors described neither frequency nor problems.
- **Effort** weighs the kind of change and, for technical changes, the systems involved and the steps that need human judgment.
- **Evidence** shows how many interviews it rests on. With one, it is one person's account and worth confirming.

Open one to see the problem and its steps, why it happens, what to change, a small pilot and its measure, the people affected, and what isn't known yet.

## Change plans and build briefs

A non-technical recommendation has a **change plan**: who is affected, the pilot, the measure, a review date four weeks out, and how to undo it. Select **Copy change plan**. A technical one has a **build brief**: select **Copy for Copilot Studio** and paste it into Copilot Studio's agent builder.

## Deciding

Contributors and admins can **Shortlist**, **Start**, **Mark done** or **Dismiss** a recommendation. Dismissing asks for a reason. Every decision is kept in the recommendation's history and survives a regenerated flow. A recommendation that a new analysis drops moves to **No longer recommended**. Anyone can answer **Was this useful?**

## When the tab is empty or out of date

- **No recommendations yet** or **Recommendations didn't finish**: select **Generate recommendations** or **Retry**.
- **New interviews since these recommendations**: regenerate the Process Flow, and recommendations follow.

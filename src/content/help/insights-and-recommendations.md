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

Insights answers "Where should we investigate or improve?" Recommendations answers "What should we change, and what evidence supports it?" Both are read from the process's Process Flow, so they update when the flow does.

## Insights tab

Insights waits until the flow's steps are described. Until then it says it is generating, and if no flow exists contributors and admins can generate one.

- **Key findings** come first: the places a reviewer should look at first, each with a button such as **Show in flow** or **Open Recommendations**.
- **Metric tiles** count Evidence (contributions used), Mapped Steps, Handoffs, Tools, Decisions, Bottlenecks, Automations and Low Confidence.
- **Detail sections** follow: Handoffs, Tools And Systems, Bottlenecks, Automation Opportunities, Tribal Knowledge Risk, Decision Points and Evidence Coverage. Evidence Coverage shows the confidence spread and the source citations.

If Key findings reports nothing, that reflects what contributors described. It does not prove the process has no issues.

## Notices to watch for

- **Some steps could not be described**: the counts cover only described steps, so treat them as a minimum, not a total. Contributors and admins can **Regenerate**.
- **Insights may be based on stale flow data**: new contributions arrived after the flow was built. Use **Refresh** before relying on the numbers.
- **Couldn't refresh, showing the previous version**: the numbers come from the earlier flow.

## Recommendations tab

Recommendations are worked out after the Process Flow is ready, so the flow is usable while they are still being prepared. A process gets between zero and five. Zero is a real answer: nothing contributors described needs changing.

Each recommendation is one kind of change, simplest first:

- **Non-technical**: Remove a step, Simplify, Standardise, Role or policy, Training.
- **Technical**: Workflow, Integration, AI assist, Agent.

A technical recommendation explains why a simpler, non-technical change would not be enough.

The list is ranked by **Value**, then **Effort**. Both are worked out from the flow, not guessed, and each shows the facts behind it:

- **Value** weighs how often the work happens, how many problems and bottlenecks contributors reported on those steps, and how many roles are involved. It says **unknown** when neither frequency nor problems were described.
- **Effort** weighs the kind of change, and for technical changes, the systems involved and steps that need human judgment.
- **Evidence** says how many interviews describe the steps. With one interview, it is one person's account and worth confirming.

Select a recommendation to read:

- **The problem**, with buttons that open each affected step in the Process Flow.
- **Why it happens**, labeled as reported by a contributor, Fabric's reading of the evidence, or not known yet.
- **What to change**, and **Try it**: a small pilot and the one measure that would show it worked.
- **People affected**: the roles on those steps, as contributors named them.
- **What we don't know**: open questions and what could go wrong.

## Change plans and build briefs

- A **non-technical** recommendation has a **change plan**: who is affected, the pilot, the measure, a suggested review date four weeks out, and how to undo the change. Select **Copy change plan** to share it.
- A **technical** recommendation has a **build brief**. Select **Copy for Copilot Studio** and paste it into Copilot Studio's agent builder as the description of what to build.

Both can be previewed before copying.

## Deciding

Contributors and admins can **Shortlist**, **Start**, **Mark done** or **Dismiss** a recommendation. Dismissing asks for a reason (Not a real problem, Already fixed, Too costly, Not a priority, Wrong recommendation) and an optional note. Every change is recorded in the recommendation's history with who made it.

Decisions are kept when the flow is regenerated. A dismissed recommendation is not suggested again unless the evidence changes. If a new analysis no longer returns a recommendation that someone had decided about, it moves to **No longer recommended** rather than disappearing.

Everyone, viewers included, can answer **Was this useful?** on a recommendation.

## When the tab is empty or out of date

- **No process flow yet**: generate the flow first.
- **No recommendations yet** or **Recommendations didn't finish**: contributors and admins can select **Generate recommendations** or **Retry**. This does not regenerate the Process Flow.
- **No changes recommended from current evidence**: the analysis ran and found nothing that needs changing. More contributions covering exceptions, handoffs and waiting time usually surface something.
- **New interviews since these recommendations**: regenerate the Process Flow to include them. Recommendations follow automatically.
- **Earlier automation suggestions**: processes analyzed before recommendations covered non-technical changes show their earlier suggestions until new recommendations are ready. Afterwards, **Compare with earlier automation suggestions** shows them side by side.

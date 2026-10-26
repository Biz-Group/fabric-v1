---
id: insights-and-automations
title: Using Insights and Automations
summary: Find where a process needs attention on the Insights tab, and copy an evidence-based build brief from the Automations tab.
audience: [viewer, contributor, admin]
tags: [insights, automations, brief]
related: [reading-the-process-flow, reading-the-overview, pdf-report]
verifiedAgainst:
  - src/features/insights/process-insights-tab.tsx
  - src/features/insights/insights-derivations.ts
  - src/features/automations/process-automations-tab.tsx
  - src/features/automations/opportunity-brief.ts
  - src/features/automations/opportunity-confidence.ts
  - docs/prd.md
---

Insights answers "Where should we investigate or improve?" Automations answers "What might we build, and what evidence supports it?" Both are read from the process's Process Flow, so they update when the flow does.

## Insights tab

Insights waits until the flow's steps are described. Until then it says it is generating, and if no flow exists contributors and admins can generate one.

- **Key findings** come first: the places a reviewer should look at first, each with a button such as **Show in flow** or **Open Automations**.
- **Metric tiles** count Evidence (contributions used), Mapped Steps, Handoffs, Tools, Decisions, Bottlenecks, Automations and Low Confidence.
- **Detail sections** follow: Handoffs, Tools And Systems, Bottlenecks, Automation Opportunities, Tribal Knowledge Risk, Decision Points and Evidence Coverage. Evidence Coverage shows the confidence spread and the source citations.

If Key findings reports nothing, that reflects what contributors described. It does not prove the process has no issues.

## Notices to watch for

- **Some steps could not be described**: the counts cover only described steps, so treat them as a minimum, not a total. Contributors and admins can **Regenerate**.
- **Insights may be based on stale flow data**: new contributions arrived after the flow was built. Use **Refresh** before relying on the numbers.
- **Couldn't refresh, showing the previous version**: the numbers come from the earlier flow.

## Automations tab

The tab lists **Potential automations**. Each row shows a title, a type (Agent, Workflow, Integration or Automation), how many steps it covers, and a confidence level. Confidence reflects how many contributors independently described the friction. With only one contributor, it is capped at medium.

Select a row to read its brief. Select **Copy** and paste it into Copilot Studio's agent builder as the description of what to build.

A brief can include these sections, leaving out any that have nothing to report:

- What to build
- Who does this today, and with what
- Where this sits in the process
- Friction reported today
- Risks it has to handle
- Prerequisites before building
- What the evidence does not tell us

The last section lists what the contributions did not establish, so you do not assume more than the evidence supports. Steps that have not been described yet are named there rather than guessed at.

## When the tab is empty

- **No process flow yet**: generate the flow first.
- **Automations were not analysed for this run**: only steps that looked automatable were found, which is not enough to brief a build. Regenerate the flow from the Process Flow tab.
- **No automations recommended**: the analysis found nothing worth automating yet. More contributions covering exceptions and handoffs usually help.

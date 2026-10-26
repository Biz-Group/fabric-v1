---
id: pdf-report
title: Download a process report as a PDF
summary: Download a PDF of a process with its overview, flow steps and insights, or export a single contribution.
audience: [viewer, contributor, admin]
tags: [pdf, export, report, sharing]
related: [reading-the-overview, reading-the-process-flow, insights-and-recommendations]
verifiedAgainst:
  - src/features/workbench/process-header.tsx
  - src/features/workbench/process-pdf/use-process-pdf-download.ts
  - src/features/workbench/process-pdf/process-pdf-document.tsx
  - src/features/workbench/process-pdf/build-process-pdf-data.ts
  - src/features/conversations/conversation-log.tsx
  - docs/prd.md
---

You can take a process out of Fabric as a PDF to share in a meeting, an email or a review. The report is built from the same current Overview, Process Flow and Insights that you see in the app, so the numbers match. Anyone in the workspace, including viewers, can download it.

## Download a process report

1. Open the process.
2. Select the **More actions** (three dots) button in the process header.
3. Choose **Download PDF**.

The menu item changes to "Preparing PDF…" and a message says "Generating PDF…". When it finishes, your browser downloads the file, named after the process with "process-report" at the end, and Fabric shows "PDF downloaded". The report is put together in your browser using the latest data at the moment you click, so rebuild or refresh stale content first if you want it up to date.

If something goes wrong, Fabric shows "Could not generate the PDF. Please try again."

## What is in the report

- **The front page**: the process name, its Overview status, the latest contributor, who submitted it if someone filed it on another person's behalf, when it was last updated, and when the report was generated.
- **Evidence coverage**: how many contributions are included out of those eligible, how many unique contributors there are, and whether coverage is Complete or Partial.
- **A contents list** showing whether the Process Flow and Flow Insights sections are included.
- **Overview**: the process brief.
- **Process Steps**: a readable sequence of the steps, with details such as actors, tools, pain points and risks.
- **Flow Insights**: a summary of the process's open recommendations, then bottlenecks, automation opportunities, tools and systems, decision points, tribal knowledge risk and evidence coverage. Change plans and build briefs stay in the app.

If the process flow has not been built, or its steps have not been described yet, the report leaves out the flow sections and says so in the contents list.

## Exporting a single contribution

You can also export one contribution. Open it on the Contributions tab and select the **Export PDF** icon. That file contains the contribution's summary and transcript, and shows who submitted it if it was filed on someone's behalf. The icon only appears once the contribution has a summary or transcript.

## Admin CSV export

Admins can export the workspace's contributions as a CSV file. See "Admin: members, contributions and branding".

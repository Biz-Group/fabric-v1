# Review notes

Open items per article. Under FR-1.18 of the AskFabric functional requirements, an article is excluded from `searchFabricHelp` while a `## <id>` section for it exists here. Other headings are ignored by that check.

Add a `## <id>` section when an article needs re-checking, for example after a feature it describes changes.

## insights-and-recommendations

Rewritten on 2026-10-26 when the Automations tab became Recommendations (technical and non-technical changes). Not yet approved; excluded from AskFabric until it is.

- Check the wording of the ranking explanation (Value, Effort, Evidence) against the UI once it is live on dev.
- The Insights metric tile and detail section are still labeled **Automations** and **Automation Opportunities**; the article quotes them as they are.
- Renamed from `insights-and-automations`; links in `pdf-report`, `reading-the-overview` and `reading-the-process-flow` were updated.

## General

- Spelling: UI copy is predominantly US English ("organization", "analyze"). A few strings use British forms ("analysed" in the consent checkbox and the Insights/Automations notices). Articles use US spelling, except where quoting a UI label verbatim ("Automations were not analysed for this run").
- The PRD calls the second process tab "Conversations". The UI tab is **Contributions** (the admin page is also "Contributions"). Articles follow the UI.
- The PRD says capture entry points are "AI Interview, Voice Record, Audio Upload". The UI labels are **Start AI interview**, **Record a voice note**, **Upload files**. Articles follow the UI.

## Resolved

Saish approved all 14 articles as written on 2026-10-23. Items that were left out of the articles stay out:

- **contribute-ai-interview:** no interview length limits stated; audio playback not mentioned.
- **contribute-record-conversation:** no voice note length limit stated; supported browsers taken from the in-app microphone error text. The article follows the code: closing at the speaker-label step keeps the contribution.
- **contribute-upload-audio:** upload rate limits are not documented.
- **label-speakers:** "Contributors and admins can label speakers" stands.
- **contribute-on-behalf:** no open items.
- **after-you-contribute:** no processing times or stuck-run recovery window stated; cautious wording on department and function refresh stands.
- **reading-the-overview:** the "Process Coverage" heading is not named; "key facts" is used descriptively.
- **reading-the-process-flow:** connection styles and spotlight bar position are not described.
- **insights-and-automations** (now `insights-and-recommendations`, re-opened above): Copilot Studio wording kept from the UI copy.
- **pdf-report:** the article follows the code (no transcript section). The June 2026 release note wording is a separate product fix, not a help-corpus item.
- **admin-members-and-workspace:** invitation expiry length and member limit are not documented.

## Features expected but not found

- A way for viewers to request a role change from within the app. None found.
- Natural-language question answering (AskFabric) has no help article yet. Add one when AskFabric launches.

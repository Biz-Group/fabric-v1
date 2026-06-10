# Fabric UI/UX Redesign PRD and Implementation Brief

Status: Draft for review  
Owner: Saish / Biz Group  
Created: 2026-06-04  
Related: `PRD.md`, `PLATFORM_ARCHITECTURE.md`, current `MillerColumns` UI

## 1. Executive Summary

Fabric should evolve from a pure Miller-column capture interface into a process workbench: a persistent app shell for navigating the product, a contextual hierarchy navigator for finding work, and a rich process detail area for capturing, reviewing, and operationalizing knowledge.

The attached mock is a strong directional step. It makes Fabric feel more like a durable system of record than a prototype: there is global navigation, search, process metadata, tabbed work areas, primary capture actions, health/status metrics, and a split workbench for conversations and synthesized knowledge. The main correction is information architecture: Function, Department, and Process are not independent peer sections. The real product model is `Function -> Department -> Process -> Conversations`, so the new UI should preserve that tree while presenting it in a more compact, modern navigator.

The redesign should be implemented in phases with minimal rework of established logic. Phase 1 should focus on the app shell and process workbench using the current data model, Convex queries, recording modal, conversation playback/transcript behavior, and process-flow generation. Later phases can add dedicated Home, Conversations, and Documents surfaces when those destinations have real functionality, expand search beyond hierarchy keywords, and introduce generated document workflows.

## 2. Current State

Fabric currently provides a single authenticated workspace at `/[org]` centered on `MillerColumns`.

Current product strengths:

- Clear hierarchy model: users navigate from function to department to process.
- Deep links are already modeled through query params: `fn`, `dept`, `proc`, and `tab`.
- Convex data model is cleanly tenant-scoped with `clerkOrgId`.
- Process detail already supports the core knowledge workflow: AI interview, voice record, audio upload, process summary, conversation log, and process flow.
- Process-flow generation already exposes structured node categories, pain points, automation potential, bottlenecks, tools, actors, confidence, and insights.
- Conversation rows already include status, input mode, transcript, summary, duration, and audio playback.

Current UX constraints:

- The Miller-column layout is efficient for browsing a hierarchy, but it does not scale well into a broader application shell with role-aware destinations such as Processes, Settings, and Help today, plus Home, Conversations, and Documents later.
- The main surface gives equal width to hierarchy columns and less visual priority to the selected process, even though the process is the user's primary work object.
- Process summary and conversations are vertically stacked, which makes synthesis and evidence harder to scan together.
- The current tabs only cover Conversations and Process Flow. The redesign should add a process Overview tab for the rolling summary and make process-level Insights a first-class tab; Documents should stay hidden until document generation or export exists.
- Global search currently behaves like a command palette for hierarchy jumps. That is the right Phase 1 scope.

## 3. Mock Assessment

### What Works Well

The mock introduces the right product direction:

- Persistent primary sidebar: separates real product destinations from hierarchy browsing.
- Workspace card: makes tenant context obvious.
- Global search: gives users a fast hierarchy keyword entry point now and a place to expand search later.
- Process header: shows where the user is, what process is selected, status, last contributor, and freshness.
- Process tabs: creates a scalable mental model for Conversations, Process Flow, and process-level Insights. Documents can join later when backed by real functionality.
- Capture action group: makes the three ingestion modes visible without hiding them in a modal launcher.
- Process health metrics: turns raw conversation and flow data into operational signals.
- Split workbench: conversations on the left and synthesis on the right is a better review workflow than a long single-column page.
- Process-level Insights decomposition: handoffs, tools, bottlenecks, automation opportunities, and related flow-derived signals are closer to what users need when operationalizing a process.

### What Needs Correction

The mock has a few structural issues that should not be implemented literally:

- Function, Department, and Process should not be three independent sections in the side panel. A department only makes sense under its parent function, and a process only makes sense under its parent department.
- The mock implies "Departments" can be browsed globally while also showing child departments under a selected department-like row. This can confuse ownership and create impossible paths.
- The "Last synced" metric should be removed. It is not required for this redesign and would add ambiguity.
- Owner and Team should be removed from the header. Replace them with "Last contributor", derived from the latest conversation for the selected process.
- Documents are not currently modeled. Hide Documents until there is a real export, generation, or persistence workflow.
- The Conversations tab should not split the process summary into Key Stages, Decision Rules, Pain Points, or Suggested Automations. Those belong in the process-level Insights tab.

### Recommended Interpretation

Use the mock as a directional workbench, not a literal layout spec. The target should be:

- Left rail: product navigation.
- Middle navigator: contextual organization tree, focused on process discovery.
- Main area: selected process workbench.
- Top bar: hierarchy keyword search and account/workspace actions.
- Tabs: process-specific work modes.
- Summary and metrics: derived from existing Convex data first, with richer metadata added only when product decisions require it.

## 4. Goals

Primary goals:

- Make Fabric feel like a mature workspace application rather than a prototype hierarchy browser.
- Preserve the canonical hierarchy while reducing the cognitive load of Miller columns.
- Put the selected process at the center of the experience.
- Make conversations, summaries, flows, and insights feel like related views of the same process.
- Improve scanability for process status, freshness, knowledge coverage, and next action.
- Build the redesign in phases without blocking on large backend migrations.
- Minimize rework of established functions and logic so the redesign does not break working capture, playback, transcript, summary, and process-flow behavior.

Secondary goals:

- Create an app shell that shows only real destinations at first and can support future pages later.
- Make hierarchy keyword search a visible core primitive, with future room for transcript, summary, and document search.
- Improve responsive behavior by replacing desktop-only Miller columns with a shell and drill-down tree pattern.
- Prepare for role-aware sharing and collaboration workflows.
- Make the product feel evolutionary rather than disruptive: easy to use, scalable, and polished enough for an executive-quality demo.

Non-goals for the first implementation phase:

- Replacing the Convex hierarchy model.
- Building full semantic search across all transcripts.
- Building a full document generation/publishing system.
- Adding workflow automation execution.
- Reworking Clerk/tenant routing.
- Rewriting process-flow generation.
- Rewriting the existing recording modal, speaker-labeling pipeline, audio player, transcript viewer, or summary generation pipeline.

## 5. Target Users and Jobs

### Contributor

Jobs:

- Find the process they work on.
- Record or upload knowledge quickly.
- Resolve speaker-labeling tasks.
- Confirm that captured knowledge was processed.

Design implications:

- The primary action group must be prominent.
- Rows with attention states should be visible in the navigator.
- The process page should make "what needs my action" obvious.

### Viewer / Learner

Jobs:

- Understand how a process works.
- Review conversations and transcripts as evidence.
- Navigate from summary to flow and insight details.
- Search for hierarchy entries now and process knowledge later.

Design implications:

- Summary should be the primary readable artifact.
- Conversation cards should be compact, filterable, and sortable.
- Process flow and insights should be one click away.

### Admin

Jobs:

- Manage hierarchy structure.
- Manage captured conversations.
- Monitor coverage and freshness.
- Invite users and maintain workspace settings.

Design implications:

- Primary nav needs real admin/settings entry points.
- Create, edit, move, delete controls should remain role-gated.
- Global pages should eventually support cross-process administration.

## 6. Information Architecture

### App Shell

Primary navigation:

- Processes
- Settings / Admin
- Help and Feedback

Initial implementation:

- Processes is fully functional.
- Settings / Admin links to existing role-appropriate settings and admin surfaces where available.
- Help and Feedback links to a real support or feedback destination.
- Home, Conversations, and Documents remain hidden until each has a real destination for the intended audience.
- Do not add a sidebar Insights destination in this redesign. Insights is process-level only for now.

Shell details:

- Brand lockup shows "Fabric" plus the active org logo.
- Workspace card shows the active org name and "Workspace".
- Workspace dropdown only appears if switching workspaces is real for the current user; otherwise it behaves as static context.
- User account menu remains available, either in the top bar or as the bottom sidebar account card.
- Settings / Admin can be role-aware: admins see admin surfaces, non-admin users see only settings they can actually use.
- Help and Feedback should not be decorative; it must open a real support, feedback, or help destination.

### Contextual Process Navigator

The navigator replaces the three desktop Miller columns with a compact tree.

Canonical structure:

```text
Function
  Department
    Process
      Conversations
```

Recommended behavior:

- Show all functions as top-level expandable groups.
- Expanding a function reveals its departments.
- Expanding a department reveals its processes.
- Selecting a process opens the process workbench.
- Selecting a function or department can show an overview state, but the Phase 1 priority is process selection.
- Preserve deep links and browser navigation.
- Preserve create, rename, move, and delete functionality.
- Counts and status dots should be carried forward:
  - Function count: child departments.
  - Department count: child processes.
  - Process count: conversations or completed conversations.
  - Attention dot: at least one conversation needs speaker labels.
  - Stale dot: process summary or flow has newer input data.

Decision: implement the true nested tree. It resolves the mock's logical issue and gives Fabric a scalable navigator.

## 7. Process Workbench Requirements

### 7.1 Top Bar

Requirements:

- Hierarchy keyword search input centered or left-aligned in the top bar.
- Phase 1 placeholder should be honest, for example "Search functions, departments, or processes...".
- Keyboard shortcut hint for command palette, currently Command/Ctrl+K.
- Help icon links to Help and Feedback.
- User menu remains available.
- Do not include notification UI or notification behavior in this redesign. Notifications are a future product area.

Phase 1 behavior:

- Search opens the existing `CommandPalette`.
- Search result scope: functions, departments, processes.
- Later behavior: transcripts, summaries, documents, and insights.

### 7.2 Process Header

Requirements:

- Breadcrumb: Function > Department > Process.
- Process title.
- Process status badge.
- Last contributor metadata.
- Last updated metadata.
- Share button and overflow menu.
- Edit/delete actions remain available for contributors/admins.

Initial data mapping:

- Status: derived from pending conversation work, similar in spirit to the status column on `/admin/conversations`.
- Status priority:
  - `Needs labels` if any conversation has `status === "needs_speaker_labels"`.
  - `Failed` if any conversation has `status === "failed"`.
  - `Processing` if any conversation has `status === "processing"`.
  - `Current` if the process has no pending or failed conversation work.
- Last contributor: derive from the latest conversation for the selected process.
- Last updated: derive from the latest of completed conversation creation time, process-flow `generatedAt`, or available summary timestamp.
- Share: copy current authenticated deep link. Any signed-in org member can share.
- Overflow: edit, move, delete, copy link.

Future data model candidates:

- `processes.summaryUpdatedAt`
- `processes.archivedAt`

### 7.3 Tabs

Target tabs:

- Overview
- Conversations
- Process Flow
- Insights

Phase 1:

- Overview, Conversations, and Process Flow are fully functional.
- Insights can show a lightweight derived view if flow data exists.
- The Documents tab is hidden until document export, generation, or persistence exists.

Tab state:

- Preserve URL syncing.
- Use stable URL tokens, for example: default/no token for Overview, then `tab=conversations`, `tab=flow`, `tab=insights`.
- If preserving the current numeric internal state is easier, keep that internal state but avoid numeric URL semantics long term.

### 7.4 Capture Actions

Requirements:

- Display the three capture modes directly:
  - Start AI Interview
  - Record Voice
  - Upload Audio
- Maintain existing role gates.
- Maintain existing recording modal and speaker-labeling flow.
- Use the process name and hierarchy context in modal dynamic variables, as today.

Behavior:

- `Start AI Interview` opens `RecordingModal` with `mode="agent"`.
- `Record Voice` opens `RecordingModal` with `mode="voice"`.
- `Upload Audio` opens `RecordingModal` with `mode="upload"` or triggers the upload step inside the modal.

### 7.5 Process Metrics

The mock's stat cards should become compact process health indicators.

Initial metrics from existing data:

- Conversations: count of conversations for the process, optionally completed count.
- Stages: count of flow nodes excluding `start` and `end`, or total nodes if that is more intuitive.
- Decision Points: count of flow nodes where `category === "decision"`.
- Pain Points: unique count across `processFlows.nodes[].painPoints`, or count of bottleneck nodes.
- Needs Attention: count of conversations with `status === "needs_speaker_labels"`.
- Last Contributor: contributor name from the latest conversation for the process.

Decision:

- Do not include "Last synced" in the redesigned UI.

### 7.6 Conversations Tab Layout

Target layout:

- Left panel: conversation list.
- Right panel: focused conversation playback and transcript review.
- Both panels should be independently scrollable on desktop.
- On mobile, show the conversation list first, then focused playback/review.

Conversation list requirements:

- Filter by conversation status or type.
- Sort newest first by default.
- Show compact rows by default:
  - Type icon
  - Contributor/title, initially formatted from input mode and contributor, for example "AI Interview with Saish"
  - Status
  - Date/time
  - Duration
  - Play affordance when audio is available
- Status labels map from current conversation states:
  - `done` -> Completed.
  - `processing` -> In progress.
  - `needs_speaker_labels` -> Needs labels.
  - `failed` -> Failed.
- Clicking a conversation row or pressing its play affordance selects it for review in the right-hand playback panel.
- The playback panel is an open, unframed review surface: waveform and playback controls at the top, then the conversation summary, then the expanded transcript using the behavior already implemented today.
- The playback panel should not duplicate row metadata such as title, type, status, date/time, or duration; that information remains visible in the selected conversation row.
- "View all conversations" expands or paginates the in-process list in Phase 1. It should only navigate to a global Conversations page once that page exists.
- Existing speaker-label review remains inline or in a focused panel.
- Existing audio playback, waveform, rolling transcript, PDF export, listened state, and mini-player logic should be preserved as much as possible. The main change is moving the focused playback/review experience into the Conversations tab panel instead of an additional modal.

Recommended interaction:

- The list row should be compact like the mock.
- The right-side playback panel is the primary focused review surface for a single conversation and should avoid nested cards or extra boundary boxes.
- Avoid rendering every full conversation card expanded by default when a process has many conversations.

### 7.7 Overview Tab and Process Summary Panel

Target:

- Preserve the current process rolling summary as the primary readable artifact.
- Move the process summary into its own Overview tab.
- Expand the process summary panel to fill the Overview tab.
- Preserve markdown rendering.
- Provide "Copy summary".
- Do not show Key Stages, Decision Rules, Pain Points, or Suggested Automations in the Conversations tab.
- Use existing `processes.rollingSummary` as the data source.

Phased approach:

- Phase 1: render the existing rolling summary in the larger summary panel.
- Later: improve the summary generation format only if necessary, without blocking the UI redesign.

### 7.8 Process Flow Tab

Requirements:

- Preserve current React Flow capabilities.
- Move surrounding UI into the new workbench tab style.
- Keep fullscreen, minimap, controls, staleness banner, node detail panel, and insights bar.
- Use stat-card data in the process header when flow exists.

Potential improvement:

- Add a small "Generate or refresh flow" action in the process header or tab toolbar when the flow is stale.

### 7.9 Insights Tab

Purpose:

- Turn process-flow data into an operational view for the selected process.

Phase 1 content from process flow:

- Handoffs: count, involved actors, source/target steps, and where ownership changes.
- Tools: tools mentioned by flow nodes, where each tool appears, and whether tool usage creates handoffs or bottlenecks.
- Bottlenecks: nodes marked as bottlenecks, associated pain points, duration signals, and supporting sources.
- Automation opportunities: items from `processFlows.insights.automationOpportunities`, plus node-level automation potential.
- Tribal knowledge risks: nodes marked as tribal knowledge and their risk indicators.
- Decision points: decision nodes, branch labels, and confidence.
- Evidence coverage: source citations and confidence distribution across nodes.

Data source:

- `processFlows.insights`
- `processFlows.nodes`
- `processFlows.edges`

Future content:

- Coverage scores.
- Time-to-complete estimates.
- Risk severity.
- Suggested next interviews.

### 7.10 Future Documents Surface

Purpose:

- Convert captured knowledge into durable artifacts.

Phase 1 decision:

- Hide the tab until the feature exists.

Future requirements:

- Generate SOP.
- Generate onboarding guide.
- Generate process brief.
- Generate RACI or responsibility matrix.
- Keep document versions.
- Track generated-from data freshness.

Potential data model:

```text
documents
  clerkOrgId
  processId
  title
  type
  content
  sourceConversationIds
  sourceFlowId
  status
  generatedAt
  updatedAt
```

## 8. Visual and Interaction Direction

Target tone:

- Quiet, operational, and polished.
- More like a serious workspace tool than a marketing product.
- Light, high-density, high-readability UI with restraint.

Design principles:

- Prioritize the work object: selected process is the star.
- Keep hierarchy visible without letting it dominate.
- Build the UI on shadcn components and patterns, extending them only where Fabric needs product-specific behavior.
- Continue adapting accent colors to the active org theme.
- Treat the logo beside "Fabric" as the current org logo, not a fixed Fabric mascot or global brand mark.
- Use the org accent sparingly for primary actions and active selection.
- Use icons for repeated controls and text+icon for core commands.
- Avoid excessive nested cards.
- Keep row heights stable.
- Make status obvious without making the UI noisy.
- Preserve fast scanning at 1440px desktop and usable drill-down on mobile.

Responsive behavior:

- Desktop: primary nav + process navigator + workbench.
- Tablet: collapsible primary nav and navigator.
- Mobile: bottom or top app bar, process navigator as a sheet/drill-down, process tabs full-width.

Accessibility:

- All icon-only buttons require labels/tooltips.
- Tree navigator must support keyboard navigation.
- Tab state must be accessible via proper tab semantics.
- Focus rings should remain visible.
- Metrics need text labels, not only icons.
- Color cannot be the only signal for status.

## 9. Data and API Implications

Can be done with current schema:

- App shell.
- Process tree navigator using existing functions, departments, and processes queries.
- Process header breadcrumb.
- Last contributor metadata derived from existing conversations.
- Process status derived from existing conversation statuses.
- Capture action group.
- Conversation list.
- Process summary panel.
- Conversation playback panel using existing audio/transcript behavior.
- Process-flow tab.
- Basic metrics from conversations and processFlows.
- Copy link and copy summary.

Likely new or changed queries:

- `hierarchy.getTree`: return functions, departments, processes, child counts, conversation counts, and attention/stale indicators in one bounded org-scoped query.
- `processes.getWorkbench`: return selected process, parent department, parent function, conversation counts, latest contributor, latest timestamps, and flow summary metadata.
- `conversations.listByProcessPaginated`: replace the current `.take(200)` list for better long-term scalability.
- Search can continue using the existing command palette/hierarchy keyword source in Phase 1; a future `search.global` can expand into summaries, transcripts, insights, and documents.

Potential schema additions:

- `processes.summaryUpdatedAt`
- `documents` table for generated artifacts in a later phase
- Search indexes for summaries, document titles/content, and possibly transcript text in a later phase

Performance considerations:

- Avoid per-row child count queries in the tree.
- Avoid loading full transcripts for every conversation row in the list if the process has many conversations.
- Paginate conversation rows.
- Split compact list data from selected conversation detail data if needed.
- Derive process metrics server-side where possible.

Security and authorization:

- Keep all reads org-scoped.
- Derive user/org identity server-side.
- Keep role gates for create, edit, delete, capture, speaker labeling, and admin surfaces.
- Share should copy an authenticated deep link. Any signed-in member of the org can share it; it does not create public access.

## 10. Phased Implementation Plan

### Phase 0: Alignment and Design Contract

Outcome:

- Finalize information architecture and target scope.
- Confirm the Phase 1 sidebar destinations: Processes, Settings / Admin, and Help and Feedback.
- Confirm the true nested process tree interaction details.
- Confirm the process header metadata: pending-work status, last contributor, and last updated.
- Confirm that Documents is hidden until there is real document functionality.
- Confirm no notification UI is included in this redesign.
- Confirm implementation approach favors moving/recomposing existing components over rewriting established behavior.

Deliverables:

- Approved brief.
- Annotated mock or Figma updates.
- Component inventory.
- Acceptance checklist.

### Phase 1: App Shell and Process Workbench Foundation

Goal:

- Achieve the visible transformation while preserving existing functionality and data model.

Scope:

- Add persistent primary sidebar.
- Add top bar with hierarchy keyword search trigger and user menu.
- Reframe `/[org]` as the Processes workspace.
- Replace the four-column desktop layout with:
  - primary nav
  - contextual process navigator
  - process workbench
- Preserve existing mobile drill-down behavior in a new shell.
- Add process header with breadcrumb, title, status, last contributor, last updated, and share/overflow actions.
- Add target tab bar for Overview, Conversations, Process Flow, and Insights.
- Keep Overview, Conversations, and Process Flow working.
- Do not add notification UI.

Acceptance criteria:

- Existing deep links still open the same selected process.
- Existing capture flows work unchanged.
- Existing create/edit/delete hierarchy operations still work for authorized users.
- Existing command palette still works from the hierarchy keyword search input.
- Existing recording, speaker-labeling, audio playback, transcript, summary, and process-flow generation logic remains intact.
- Viewer/contributor/admin role differences are preserved.
- No tenant isolation changes.

### Phase 2: Overview, Conversations, and Playback Workbench

Goal:

- Make the default process view split summary, conversation scanning, and focused playback into clear process tabs.

Scope:

- Compact conversation list panel with filters and sorting.
- Conversation playback panel opened from the list row or play button.
- Preserve audio playback, waveform, rolling transcript, speaker-label review, PDF export, and mini-player behavior as much as possible.
- Overview tab with Copy Summary.
- Expanded process summary panel using the existing rolling summary only.
- Process metrics row.

Acceptance criteria:

- A user can scan conversations without every transcript/summary taking vertical space.
- A user can still complete speaker-labeling tasks.
- Pressing play selects an open focused conversation panel with waveform playback first, then summary, then expanded transcript.
- A user can copy the process summary.
- Metrics degrade gracefully when no process flow exists.
- Empty states are clear for no conversations, no summary, and no flow.

### Phase 3: Process Flow Integration and Insights Tab

Goal:

- Connect visual flow data to operational insight views.

Scope:

- Restyle Process Flow tab within new workbench.
- Add flow-derived metric cards.
- Add Insights tab using existing `processFlows` data.
- Surface handoffs, tools, bottlenecks, automation opportunities, tribal knowledge risks, decision points, and evidence coverage.
- Add refresh affordances when flow is stale.

Acceptance criteria:

- Insights tab is useful when flow exists and has a clear generate-flow prompt when it does not.
- Stale flow states are visible.
- Flow generation and refresh behavior remains unchanged.

### Phase 4: Global Product Surfaces

Goal:

- Make sidebar destinations real product areas.

Scope:

- Home dashboard with coverage and activity.
- Conversations page for cross-process review and admin-like filtering where role allows.
- Documents page or tab backed by a new documents model.
- Search beyond hierarchy.

Acceptance criteria:

- Sidebar entries lead to useful surfaces.
- Search can retrieve knowledge, not just hierarchy names.
- Documents have a coherent creation, versioning, and freshness model.

### Phase 5: Knowledge Operations

Goal:

- Move from capture/review into managed process intelligence.

Scope:

- Generated SOPs and onboarding guides.
- Suggested follow-up interviews.
- Coverage and confidence scoring.
- Process review cadence.
- Share workflows and permissions beyond copying authenticated links.

## 11. Risks and Tradeoffs

Risk: The visual redesign could hide hierarchy management.

Mitigation:

- Keep create/edit/delete available in the tree and overflow menus.
- Add role-aware empty states and clear add actions.

Risk: Adding primary nav entries before features exist can feel unfinished.

Mitigation:

- Only show sidebar destinations that have real functionality. Hide Home, Conversations, and Documents until each destination is useful. Do not include a sidebar Insights destination in this redesign.

Risk: Metrics may imply precision that does not exist.

Mitigation:

- Define every metric explicitly and show empty/unknown states honestly.

Risk: Conversation list compacting may bury important speaker-label tasks.

Mitigation:

- Keep attention badges and pin unresolved items at the top or provide a filter.

Risk: Backend query fanout could grow with a full tree navigator.

Mitigation:

- Add aggregated tree/workbench queries before scaling beyond small tenant data.

Risk: Summary structure may be brittle if parsed from markdown.

Mitigation:

- Phase 1 renders the existing rolling summary only. Flow-derived subsections move to the Insights tab, where they can use existing structured process-flow data.

Risk: UI redesign could regress working capture, playback, transcript, or flow behavior.

Mitigation:

- Reuse existing components and Convex functions wherever possible. Prefer moving component placement, adding thin wrapper components, and composing existing behavior over rewriting business logic.

## 12. Settled Decisions and Remaining Questions

Settled decisions:

- The primary sidebar should show only real destinations in Phase 1.
- The process navigator should be a true nested `Function -> Department -> Process` tree.
- "Last synced" should be removed.
- Owner and Team should be removed from the process header.
- The process header should show Last Contributor instead.
- Process status should indicate pending process work derived from conversation statuses, similar to `/admin/conversations`.
- Documents should be hidden until there is real document functionality.
- Search should remain the current hierarchy keyword / command palette experience in Phase 1.
- The visual system should continue adapting to the active org theme.
- The logo beside "Fabric" is the active org logo.
- The process summary belongs in the Overview tab, not the Conversations tab.
- Sidebar Insights page is out of scope for now.
- Process Insights tab should expand flow-derived handoffs, tools, bottlenecks, automation opportunities, tribal knowledge risks, decisions, and evidence.
- Any signed-in org member can share authenticated process links.
- Notification functionality should be removed entirely from this redesign and revisited later.
- Conversations tab should not include Key Stages, Decision Rules, Pain Points, or Suggested Automations in the summary panel.
- Pressing play on a conversation selects the in-tab playback panel with waveform playback first, then that conversation's summary and expanded transcript.
- The implementation should minimize rework of established functions and logic.
- The redesign should be easy to use, scalable, and executive-demo quality.
- The whole UI should be shadcn-based.

Remaining questions:

- None blocking for Phase 1.

## 13. Recommended Immediate Next Step

Approve the Phase 1 direction:

- App shell.
- True nested process tree.
- Process workbench header.
- Overview, Conversations, and Process Flow tabs working.
- Search opens existing command palette.
- Header metadata is pending-work status, last contributor, and last updated.
- Sidebar only shows real destinations.
- Documents remain hidden.
- No notification UI.
- Minimal rework of existing logic.

Then implement Phase 2 as the first UX depth pass:

- Compact conversation list.
- Overview tab for the rolling process summary.
- Expanded process summary panel.
- Conversation playback panel.
- Process metrics.
- Summary copy.
- Flow-derived process Insights tab.

## 14. Mock Coverage Checklist

Addressed directly:

- Fabric brand lockup with active org logo.
- Workspace card and workspace context.
- Primary navigation shell.
- Processes as the active real destination.
- Settings / Admin and Help and Feedback as real destinations.
- True nested hierarchy navigator.
- Create actions for hierarchy management through role-gated controls.
- Counts and status dots in the hierarchy navigator.
- Top search with Command/Ctrl+K.
- User/account menu.
- Process breadcrumb.
- Process title and status badge.
- Last updated metadata.
- Last contributor metadata replacing Owner and Team.
- Pending-work process status derived from conversation statuses.
- Share and overflow actions.
- Overview, Conversations, Process Flow, and Insights tabs.
- Direct capture actions: Start AI Interview, Record Voice, Upload Audio.
- Compact process metrics for stages, decision points, pain points, conversations, attention, and last contributor.
- Overview summary tab and split Conversations + Playback workbench.
- Conversation filters and sorting.
- Compact conversation rows with play, title, status, date/time, and duration.
- Open conversation playback panel with waveform player, summary, and expanded transcript, without duplicating row metadata.
- View all conversations behavior inside the process until a global Conversations page exists.
- Copy summary action.
- Expanded process summary panel using the current rolling summary.
- Process Insights tab with handoffs, tools, bottlenecks, automation opportunities, tribal knowledge risks, decisions, and evidence coverage.

Intentionally changed from the mock:

- Function, Department, and Process are not separate peer sections; they become a true tree.
- "Last synced" is removed.
- Owner and Team are removed.
- Documents is hidden until backed by real functionality.
- Search placeholder and scope stay limited to hierarchy keywords in Phase 1.
- Sidebar hides Home, Conversations, and Documents until those are useful destinations.
- Sidebar Insights page is not included for now.
- Notification functionality is removed entirely for this redesign.
- Key Stages, Decision Rules, Pain Points, and Suggested Automations are removed from the Conversations summary panel.
- Org logo and org accent come from the active workspace theme, not a fixed Fabric red brand treatment.

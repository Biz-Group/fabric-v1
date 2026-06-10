# Fabric UI/UX Redesign Task List

Status: Phase 9 implemented; signed-in visual QA pending  
Created: 2026-06-04  
Reference: [fabric-ui-ux-redesign-brief.md](fabric-ui-ux-redesign-brief.md)  
Primary goal: evolve Fabric into a shadcn-based, easy-to-use, scalable, executive-quality demo app while preserving working capture, playback, transcript, summary, and process-flow logic.

## Implementation Principles

- Preserve the existing Convex data model unless a phase explicitly calls for a read-model helper.
- Prefer moving and composing existing components over rewriting business logic.
- Keep the UI shadcn-based. Use existing local shadcn primitives before introducing new primitives.
- Do not add notification UI.
- Do not add a sidebar Insights page.
- Keep Documents hidden until real document functionality exists.
- Keep search limited to the existing hierarchy keyword / command palette behavior.
- Keep sharing as authenticated deep-link copy for any signed-in org member.
- Before touching Next.js app/router behavior, read the relevant docs in `node_modules/next/dist/docs/`.
- Before touching Convex code, read `convex/_generated/ai/guidelines.md`.

## Phase 0: Alignment, Inventory, and Safety Baseline

### Tasks

- [x] Confirm this task list is the implementation source of truth alongside the redesign brief.
- [x] Record current behavior to preserve:
  - [x] Deep links using `fn`, `dept`, `proc`, and `tab`.
  - [x] Function, department, and process CRUD.
  - [x] Role gates for viewer, contributor, and admin.
  - [x] AI interview, voice record, and audio upload flows.
  - [x] Speaker-label review flow.
  - [x] Process rolling summary rendering.
  - [x] Conversation audio playback, waveform, rolling transcript, PDF export, listened state, and mini-player behavior.
  - [x] Process-flow generation, stale state, fullscreen, minimap, controls, and node detail panel.
- [x] Inventory current components and decide reuse targets:
  - [x] `src/components/miller-columns.tsx`
  - [x] `src/components/conversation-log.tsx`
  - [x] `src/components/process-flow.tsx`
  - [x] `src/components/process-flow-detail-panel.tsx`
  - [x] `src/components/recording-modal.tsx`
  - [x] `src/components/command-palette.tsx`
  - [x] `src/components/workspace-brand.tsx`
  - [x] `src/components/user-menu.tsx`
  - [x] `src/components/ui/*`
- [x] Identify shadcn primitives already available and gaps:
  - [x] Button
  - [x] Dialog
  - [x] Sheet
  - [x] Tabs
  - [x] Tooltip
  - [x] ScrollArea
  - [x] DropdownMenu
  - [x] Badge
  - [x] Card
  - [x] Select
  - [x] Input
  - [x] Skeleton
  - [x] Breadcrumb
- [x] Decide file split before implementation:
  - [x] App shell component.
  - [x] Process tree navigator component.
  - [x] Process workbench component.
  - [x] Process header component.
  - [x] Conversation list component.
  - [x] Conversation playback panel component.
  - [x] Process summary panel component.
  - [x] Process insights tab component.
- [x] Check current dirty worktree and avoid reverting unrelated changes.

### Tests and Verification

- [x] Run `npm run lint` and record the starting state.
- [x] Run `npm test` and record the starting state.
- [x] Run `npm run build` and record the starting state.
- [ ] Manually verify current app still opens at the org route before making implementation changes. Blocked on 2026-06-05: fresh headless browser redirects to tenant `/sign-in`, and no authenticated in-app browser backend/session is available in this Codex run.
- [ ] Capture baseline screenshots for:
  - [ ] Desktop process detail. Blocked: requires authenticated workspace session.
  - [ ] Mobile process drill-down. Blocked: requires authenticated workspace session.
  - [ ] Conversation playback/transcript. Blocked: requires authenticated workspace session with seeded conversation/audio.
  - [ ] Process flow tab. Blocked: requires authenticated workspace session with a selected process.

### Phase 0 Notes (2026-06-05)

Source of truth:

- `docs/fabric-ui-ux-redesign-task-list.md` is confirmed as the implementation checklist alongside `docs/fabric-ui-ux-redesign-brief.md`.
- The brief and task list are currently untracked under `docs/`; preserve them as user-authored planning artifacts.

Dirty worktree:

- Starting `git status --short`: `?? docs/`.
- No unrelated changes were reverted.

Behavior inventory:

- Deep links are centralized in `src/components/miller-columns.tsx` through `fn`, `dept`, `proc`, and `tab`. The current URL tab token only serializes Process Flow as `tab=flow`; Conversations is the default.
- `/[org]` renders `MillerColumns` after `users.getMe`, `users.store`, and profile onboarding. The route stays behind `src/proxy.ts` subdomain auth and `src/app/[org]/layout.tsx` active-org checks.
- Function CRUD uses `api.functions.create/update/remove`; department CRUD uses `api.departments.create/update/remove`; process CRUD uses `api.processes.create/update/remove`.
- Viewer/contributor/admin gates are enforced in the UI with `users.getMyMembership`; Convex enforces role gates through `requireOrgMember`, `requireOrgContributor`, and `requireOrgAdmin`.
- `RecordingModal` is the reuse target for all capture modes: `agent`, `voiceRecord`, and `audioUpload`. It builds dynamic variables from contributor, hierarchy names, safe descriptions, and prior conversation summaries.
- Speaker-label review is preserved through `SpeakerLabelReview` inside `ConversationLog` and inside the post-upload/post-recording completion flow.
- Process summary rendering uses `processes.rollingSummary` with `MarkdownSummary`; manual rebuild uses `summaries.forceRefreshProcessSummary`.
- Conversation playback lives in `ConversationLog`: audio URL retrieval, waveform scrubber, synced transcript, PDF export, localStorage listened state, localStorage playback position, keyboard shortcuts, and sticky mini-player.
- Process Flow lives in `ProcessFlow`: lazy loaded from `MillerColumns`; preserves generation, generating, failed, stale/newer-conversations states, fullscreen, React Flow minimap/controls, node selection, desktop detail panel, and mobile bottom sheet.

Component reuse targets:

- `MillerColumns`: source for selection state, URL sync, role-gated CRUD, capture action wiring, current summary placement, and tab behavior. Extract carefully instead of rewriting first.
- `ConversationLog`: source for playback/transcript/PDF/listened/mini-player behavior. Phase 6 should extract playback pieces only after the compact list exists.
- `ProcessFlow` and `ProcessFlowDetailPanel`: move into the new tab surface with stable canvas dimensions; do not alter generation logic or prompt.
- `RecordingModal`: keep capture internals intact; new UI should only call existing modes.
- `CommandPalette`: keep hierarchy keyword search behavior; update trigger text in the new top bar.
- `WorkspaceBrand` / `WorkspaceBrandLockup`: reuse active org logo/initial fallback beside Fabric.
- `UserMenu`: reuse admin link, role badge, user button, and multi-org switcher behavior.
- `src/components/ui/*`: all Phase 0 named shadcn primitives are available locally. No primitive gaps were found.

Initial file split decision:

- App shell: `src/components/process-workspace/process-app-shell.tsx`
- Process tree navigator: `src/components/process-workspace/process-tree-navigator.tsx`
- Process workbench: `src/components/process-workspace/process-workbench.tsx`
- Process header: `src/components/process-workspace/process-header.tsx`
- Conversation list: `src/components/process-workspace/conversation-list.tsx`
- Conversation playback panel: composed from `src/components/process-workspace/conversation-list.tsx` and existing `ConversationListWithPlayer`
- Process summary panel: `src/components/process-workspace/process-summary-panel.tsx`
- Process insights tab: `src/components/process-workspace/process-insights-tab.tsx`

Baseline commands:

- `npm run lint`: fails with 26 errors and 23 warnings before redesign edits. Primary existing error clusters are React Compiler/react-hooks rules in `src/components/conversation-log.tsx`, `src/components/profile-edit-dialog.tsx`, `src/components/ui/orb.tsx`, `src/components/ui/transcript-viewer.tsx`, `src/components/ui/waveform.tsx`, `src/hooks/use-mobile.ts`, and `src/hooks/use-transcript-viewer.ts`.
- `npm test`: passes, 6 test files and 65 tests.
- `npm run build`: passes on Next.js 16.2.7/Turbopack. Existing warning: Next inferred workspace root from `C:\Users\saish.gaonkar\package-lock.json` because multiple lockfiles are present.

Visual baseline attempt:

- Port 3000 was already running this repo's Next server (`node ...next/dist/server/lib/start-server.js`).
- Browser plugin had no available `iab` backend in this session, so local visual verification used headless Playwright.
- `http://biz-group.lvh.me:3000/` redirected to `http://biz-group.lvh.me:3000/sign-in?redirect_url=...` in a fresh headless browser.
- Captured auth-route fallback screenshots:
  - `docs/phase-0-baseline/desktop-org-route.png`
  - `docs/phase-0-baseline/mobile-org-route.png`
- Signed-in process detail, mobile drill-down, conversation playback/transcript, and process flow screenshots remain pending until an authenticated browser session is available.

## Phase 1: Read Models and Data Contracts

Goal: provide the data needed by the new UI without changing core write flows.

### Tasks

- [x] Read `convex/_generated/ai/guidelines.md` before editing Convex files.
- [x] Add or adapt a bounded hierarchy read query if needed:
  - [x] Return functions for the active org.
  - [x] Return departments grouped by function.
  - [x] Return processes grouped by department.
  - [x] Include child counts.
  - [x] Include process conversation counts.
  - [x] Include attention indicators from `needs_speaker_labels`.
  - [x] Include stale indicators from process summary/flow state where available.
  - [x] Keep all reads org-scoped.
- [x] Add or adapt a process workbench read query if needed:
  - [x] Selected process.
  - [x] Parent department.
  - [x] Parent function.
  - [x] Latest contributor.
  - [x] Last updated timestamp.
  - [x] Pending-work status.
  - [x] Conversation counts by status.
  - [x] Flow summary metadata.
- [x] Define pending-work process status derivation:
  - [x] `Needs labels` when any conversation needs speaker labels.
  - [x] `Failed` when any conversation failed and there are no label-needed conversations.
  - [x] `Processing` when any conversation is processing and there are no higher-priority pending states.
  - [x] `Current` when there is no pending or failed work.
- [x] Keep process status derived for now; do not add a persisted `processes.status`.
- [x] Decide whether existing `conversations.listByProcess` is sufficient for Phase 1 or whether a compact/paginated query is needed for the new list.
- [x] If adding a compact conversation query:
  - [x] Return row data needed for the list.
  - [x] Avoid loading full transcripts unless needed by the modal.
  - [x] Preserve org scoping.
  - [x] Preserve role behavior.
- [x] Do not change existing capture, speaker-labeling, summary, or flow-generation mutations/actions.

### Tests and Verification

- [x] Add or update Convex tests for any new query:
  - [x] Tenant isolation.
  - [x] Viewer access.
  - [x] Contributor/admin access where relevant.
  - [x] Cross-org process IDs return `null`, `[]`, or not found behavior consistent with current conventions.
  - [x] Pending-work status priority.
  - [x] Latest contributor derivation.
- [x] Run `npm test`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [ ] Manually verify existing UI still works before wiring the new UI to these queries. Existing UI was not wired to the new queries in Phase 1. Signed-in manual verification remains blocked by the Phase 0 authenticated-browser/session issue.

### Phase 1 Notes (2026-06-05)

Read-model contracts added:

- `convex/hierarchy.ts`
  - New `hierarchy.getTree` query.
  - Returns a bounded active-org tree: functions -> departments -> processes.
  - Includes child counts, process conversation counts by status, attention from `needs_speaker_labels`, derived pending-work status/label, summary presence, and compact flow stale/metric metadata.
  - Uses bounded caps and returns `limits` / `truncated` metadata.
- `convex/processes.ts`
  - New `processes.getWorkbench` query.
  - Returns selected process, parent department, parent function, pending-work status, conversation counts, latest contributor, last updated timestamp, and compact flow summary metadata.
  - Cross-org process IDs return `null`.
- `convex/conversations.ts`
  - New `conversations.listCompactByProcess` query.
  - Returns row data for the redesigned conversation list without transcript or summary payloads.
  - Keeps `conversations.listByProcess` unchanged for existing playback/review behavior.
- `convex/readModelHelpers.ts`
  - Shared pure helpers for pending-work priority, labels, counts, latest conversation, grouping, and flow metadata.

Data-contract decisions:

- Process status remains derived, not persisted on `processes`.
- Status priority is `needs_labels` -> `failed` -> `processing` -> `current`, with UI labels `Needs labels`, `Failed`, `Processing`, and `Current`.
- `listByProcess` is preserved for existing behavior; `listCompactByProcess` is the new UI list contract.
- Existing capture, speaker-labeling, summary, and process-flow mutations/actions were not changed.

Verification:

- `npx convex codegen`: passed and regenerated `convex/_generated/api.d.ts`.
- `npx vitest run convex/readModels.test.ts`: passed, 7 tests.
- `npm test`: passed, 7 test files and 72 tests.
- `npm run lint`: still fails with the same Phase 0 baseline count, 26 errors and 23 warnings. No new Phase 1 files appear in the lint failure list.
- `npm run build`: passed on Next.js 16.2.7/Turbopack. Existing warning remains: Next inferred workspace root from `C:\Users\saish.gaonkar\package-lock.json` because multiple lockfiles are present.

## Phase 2: App Shell Foundation

Goal: introduce the new shadcn-based shell without breaking current process workflows.

### Tasks

- [x] Read relevant Next.js docs in `node_modules/next/dist/docs/` before changing app route/layout behavior.
- [x] Create the shell component structure:
  - [x] Primary sidebar.
  - [x] Workspace card.
  - [x] Top bar.
  - [x] Main workbench region.
- [x] Sidebar destinations for Phase 1:
  - [x] Processes.
  - [x] Settings / Admin, role-aware and only if it links to real surfaces.
  - [x] Help and Feedback omitted because no real support/help destination exists.
- [x] Hide sidebar destinations for Phase 1:
  - [x] Home.
  - [x] Conversations.
  - [x] Insights.
  - [x] Documents.
- [x] Implement brand/workspace area:
  - [x] Show "Fabric".
  - [x] Show active org logo beside Fabric.
  - [x] Use active org theme tokens.
  - [x] Show active org workspace name.
  - [x] Only show workspace dropdown behavior if workspace switching is real.
- [x] Implement top bar:
  - [x] Hierarchy keyword search trigger.
  - [x] Honest placeholder: "Search functions, departments, or processes..."
  - [x] Command/Ctrl+K hint.
  - [x] Existing `CommandPalette` opens from search.
  - [x] User menu.
  - [x] No notification icon or notification behavior.
- [x] Reframe `/[org]` as the Processes workspace.
- [x] Preserve profile onboarding behavior.
- [x] Preserve loading states.
- [x] Preserve Clerk/Convex provider behavior.

### Tests and Verification

- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [ ] Manually verify:
  - [x] Signed-out route behavior is unchanged.
  - [ ] Org subdomain route loads. Blocked: requires authenticated workspace session.
  - [ ] Profile onboarding still appears when needed. Blocked: requires authenticated workspace session.
  - [ ] User menu still works. Blocked: requires authenticated workspace session.
  - [ ] Command palette still opens from keyboard and search trigger. Keyboard path remains code-preserved; signed-in browser verification is blocked.
  - [x] No notification UI is present.
- [ ] Browser visual checks:
  - [ ] Desktop 1440px. Blocked: no authenticated browser session available.
  - [ ] Desktop narrow. Blocked: no authenticated browser session available.
  - [ ] Tablet width. Blocked: no authenticated browser session available.
  - [ ] Mobile width. Blocked: no authenticated browser session available.
- [ ] Accessibility spot check:
  - [ ] Keyboard can reach sidebar, search, and user menu. Blocked: requires authenticated browser session.
  - [x] Icon buttons have labels/tooltips.

### Phase 2 Notes (2026-06-05)

Shell implementation:

- Added `src/components/process-workspace/process-app-shell.tsx`.
- `MillerColumns` now renders inside `ProcessAppShell`, preserving existing selection state, deep-link behavior, CRUD wiring, capture modal wiring, conversation log, and process-flow lazy loading.
- Desktop shell includes a 252px primary sidebar, workspace card, role-aware Processes/Admin navigation, top search trigger, and compact `UserMenu`.
- Mobile shell uses a left `Sheet` for primary navigation and keeps the existing mobile hierarchy drill-down inside the workbench area.
- Help/Feedback, Home, Conversations, Insights, Documents, and notifications remain hidden because there are no real Phase 2 destinations or behaviors for them.
- Workspace branding uses `WorkspaceBrandLockup` with the active Clerk organization logo/initials and the existing org theme provider remains untouched.

Verification:

- `npm run build`: passed on Next.js 16.2.7/Turbopack. Existing warning remains: Next inferred workspace root from `C:\Users\saish.gaonkar\package-lock.json` because multiple lockfiles are present.
- `npm test`: passed, 7 test files and 72 tests.
- `npm run lint`: still fails with the same Phase 0 baseline count, 26 errors and 23 warnings. No Phase 2 shell files appear in the lint failure list.
- Browser plugin attempt: blocked because the in-app browser backend reported `Browser is not available: iab`.
- Local Playwright fallback: blocked because Playwright is not installed in this repo.
- HTTP smoke check: `http://biz-group.lvh.me:3000/` returns 307 to `/sign-in?redirect_url=...`, matching the expected signed-out guard. `http://biz-group.lvh.me:3000/sign-in` returns 200.
- Signed-in visual, user-menu, command-palette, profile-onboarding, and responsive checks remain pending until an authenticated browser session is available.

## Phase 3: True Nested Process Tree Navigator

Goal: replace the three-column hierarchy presentation with a scalable tree while preserving hierarchy behavior.

### Tasks

- [x] Build `Function -> Department -> Process` tree UI with shadcn-compatible controls.
- [x] Show all functions as top-level expandable nodes.
- [x] Expanding a function reveals its departments.
- [x] Expanding a department reveals its processes.
- [x] Selecting a process opens the process workbench.
- [x] Preserve function and department overview behavior if feasible; otherwise keep process selection as the Phase 1 priority.
- [x] Preserve deep-link initialization:
  - [x] `fn`
  - [x] `dept`
  - [x] `proc`
  - [x] `tab`
- [x] Preserve URL updates when selecting tree nodes.
- [x] Preserve browser back/forward behavior.
- [x] Preserve create controls:
  - [x] Add function.
  - [x] Add department under selected function.
  - [x] Add process under selected department.
- [x] Preserve edit/move/delete controls:
  - [x] Function rename/delete.
  - [x] Department rename/move/delete.
  - [x] Process rename/move/delete.
  - [x] Existing delete eligibility behavior.
- [x] Display counts:
  - [x] Function child department count.
  - [x] Department child process count.
  - [x] Process conversation count.
- [x] Display status dots:
  - [x] Attention for speaker labels needed.
  - [x] Stale summary/flow where available.
- [x] Keep the tree compact and stable:
  - [x] No row height shifts on hover.
  - [x] Long labels truncate cleanly.
  - [x] Counts and status dots do not overlap labels.
- [x] Mobile behavior:
  - [x] Use sheet/drill-down behavior.
  - [x] Preserve process-first page behavior once a process is selected.
  - [x] Keep touch targets usable.

### Tests and Verification

- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Run `npm test` if Convex query behavior changed.
- [ ] Manual hierarchy tests:
  - [ ] Deep link to function/department/process opens correct tree state.
  - [ ] Browser back/forward works through selections.
  - [ ] Create, rename, move, delete function.
  - [ ] Create, rename, move, delete department.
  - [ ] Create, rename, move, delete process.
  - [ ] Delete blockers still show correct eligibility.
  - [ ] Viewer cannot perform contributor/admin actions.
  - [ ] Contributor/admin role gates are preserved.
- [ ] Visual checks:
  - [ ] Long labels.
  - [ ] Empty functions/departments/processes.
  - [ ] Large hierarchy.
  - [ ] Attention/stale dots.
- [ ] Accessibility checks:
  - [ ] Tree is keyboard navigable.
  - [ ] Expand/collapse is screen-reader understandable.
  - [ ] Focus states are visible.

### Phase 3 Notes (2026-06-05)

Tree navigator implementation:

- Added `src/components/process-workspace/process-tree-navigator.tsx`.
- Desktop hierarchy now uses a single nested `Function -> Department -> Process` tree backed by `hierarchy.getTree`.
- The existing process detail/workbench surface remains in `MillerColumns`; conversation playback, process summary, recording modal, process flow lazy loading, command palette, URL state, and CRUD dialog logic were not rewritten.
- Function and department rows still open their overview panels; process rows open the existing selected-process detail panel.
- Tree row actions reuse the existing CRUD flow:
  - Function: add department, rename, delete.
  - Department: add process, rename/move, delete.
  - Process: rename/move, delete.
  - Delete eligibility still comes from the existing server queries used by `CrudDialog`.
- Header create controls support add function, add department under selected function, and add process under selected department.
- Counts now come from `hierarchy.getTree`: function department count, department process count, and process conversation count.
- Status dots show speaker-label attention and stale summary/flow state where the read model exposes it.
- Tree rows use fixed heights, reserved action space, truncation, and separated count/status regions to avoid hover layout shifts.
- Tree items expose `aria-selected`, `aria-expanded`, and visible focus rings; Left/Right arrow keys collapse/expand expandable rows.
- Mobile keeps the existing drill-down/list plus bottom-sheet preview behavior for Phase 3, with the selected-process page preserved.

Verification:

- `npx eslint src\components\process-workspace\process-tree-navigator.tsx src\components\miller-columns.tsx`: passed.
- `npm run build`: passed on Next.js 16.2.7/Turbopack. Existing warning remains: Next inferred workspace root from `C:\Users\saish.gaonkar\package-lock.json` because multiple lockfiles are present.
- `npm test`: passed, 7 test files and 72 tests.
- `npm run lint`: still fails with the same Phase 0 baseline count, 26 errors and 23 warnings. The new tree component and edited `MillerColumns` file do not appear in the failure list.
- `npx tsc --noEmit --pretty false`: not a useful repo-level signal because it fails on existing Convex test typing issues around `vite/client`, `import.meta.glob`, and test-only system-table index typing. `npm run build` type checking passed.
- Browser plugin attempt: blocked because the in-app browser backend reported `Browser is not available: iab`.
- Standalone Playwright fallback is unavailable because `node_modules/playwright` is not installed.
- HTTP smoke check: `http://biz-group.lvh.me:3000/` returns 200 after redirecting to `http://biz-group.lvh.me:3000/sign-in?redirect_url=...`; `http://biz-group.lvh.me:3000/sign-in` returns 200.
- Signed-in manual hierarchy, CRUD, visual, and accessibility checks remain pending until an authenticated browser session is available.

## Phase 4: Process Workbench Header, Tabs, and Capture Actions

Goal: create the selected-process workbench while preserving existing capture and process-flow behaviors.

### Tasks

- [x] Build process workbench container.
- [x] Add breadcrumb:
  - [x] Function.
  - [x] Department.
  - [x] Process.
- [x] Add process title.
- [x] Add pending-work status badge:
  - [x] Needs labels.
  - [x] Failed.
  - [x] Processing.
  - [x] Current.
- [x] Add last contributor metadata.
- [x] Add last updated metadata.
- [x] Add Share action:
  - [x] Copies authenticated deep link.
  - [x] Available to any signed-in org member.
  - [x] Does not create public access.
- [x] Add overflow actions:
  - [x] Copy link.
  - [x] Edit process.
  - [x] Move process.
  - [x] Delete process.
  - [x] Role-gated where appropriate.
- [x] Add tabs:
  - [x] Overview.
  - [x] Conversations.
  - [x] Process Flow.
  - [x] Insights.
- [x] Preserve URL tab state.
- [x] Add direct capture actions:
  - [x] Start AI Interview.
  - [x] Record Voice.
  - [x] Upload Audio.
- [x] Wire capture actions to existing `RecordingModal` modes.
- [x] Preserve modal dynamic variables:
  - [x] Contributor context.
  - [x] Function name.
  - [x] Department name.
  - [x] Process name.
  - [x] Safe department/process descriptions.
  - [x] Existing summary/prior context.
- [x] Do not rewrite recording or upload logic.

### Tests and Verification

- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [ ] Manual process header tests:
  - [ ] Breadcrumb matches selected process.
  - [ ] Status priority is correct for mixed conversation statuses.
  - [ ] Last contributor updates from latest conversation.
  - [ ] Last updated displays a sensible timestamp.
  - [ ] Share copies a valid authenticated link.
  - [ ] Viewer can share but cannot edit/delete.
- [ ] Capture flow smoke tests:
  - [ ] Start AI Interview opens existing modal.
  - [ ] Record Voice opens existing modal.
  - [ ] Upload Audio opens existing modal/upload path.
  - [ ] Closing modal behavior is unchanged.
  - [ ] Speaker-label gate remains unchanged.
- [ ] Tab tests:
  - [ ] URL tab state persists refresh.
  - [ ] Back/forward works between tabs.
  - [ ] Process Flow tab still lazy-loads safely.

### Phase 4 Notes (2026-06-05)

Workbench implementation:

- Added `src/components/process-workspace/process-header.tsx`.
- Added `src/components/process-workspace/process-insights-tab.tsx`.
- `MillerColumns` now renders a selected-process workbench header above the existing tab content.
- Header uses `processes.getWorkbench` for pending-work status, latest contributor, last updated, and flow stale metadata.
- Breadcrumb actions preserve existing hierarchy selection behavior: function breadcrumb returns to the function overview, department breadcrumb returns to the department overview.
- Share and overflow Copy Link build an authenticated in-org deep link from the existing `fn`, `dept`, `proc`, and `tab` state. No public access or notification UI was added.
- Overflow actions include Copy link for all signed-in members, with Edit process, Move process, and Delete process shown only to contributors/admins. Edit and Move both open the existing process edit/move dialog path.
- Capture actions moved to the header and open the existing `RecordingModal` modes:
  - `agent`
  - `voiceRecord`
  - `audioUpload`
- `RecordingModal` was moved outside the Conversations tab so capture works from Conversations, Process Flow, or Insights. Recording/upload internals were not changed.
- Recording context still passes function name, department name, process name, and safe department/process descriptions, with workbench fallbacks while older per-row queries load.
- URL tab mapping now supports:
  - default Overview tab with no `tab` param.
  - `tab=conversations`.
  - `tab=flow`.
  - `tab=insights`.
- Added a lightweight process Insights tab using existing `processes.getWorkbench.flow` summary metadata. The full Insights implementation remains Phase 8.

Verification:

- `npx eslint src\components\miller-columns.tsx src\components\process-workspace\process-header.tsx src\components\process-workspace\process-insights-tab.tsx src\components\process-workspace\process-tree-navigator.tsx`: passed.
- `npm run build`: passed on Next.js 16.2.7/Turbopack. Existing warning remains: Next inferred workspace root from `C:\Users\saish.gaonkar\package-lock.json` because multiple lockfiles are present.
- `npm test`: passed, 7 test files and 72 tests.
- `npm run lint`: still fails with the same Phase 0 baseline count, 26 errors and 23 warnings. The new Phase 4 files and edited `MillerColumns` file do not appear in the failure list.
- Browser plugin attempt: blocked because the in-app browser backend reported `Browser is not available: iab`.
- Standalone Playwright fallback is unavailable because `node_modules/playwright` is not installed.
- HTTP smoke check: `http://biz-group.lvh.me:3000/` returns 200 after redirecting to `http://biz-group.lvh.me:3000/sign-in?redirect_url=...`.
- Signed-in manual process header, capture, tab, share, and role-gate checks remain pending until an authenticated browser session is available.

## Phase 5: Overview, Conversations Tab, and Playback Panel

Goal: make the default process view easier to scan while preserving existing summary, conversation, and playback logic.

### Tasks

- [x] Build Overview tab:
  - [x] Expanded process summary panel.
  - [x] Uses existing `processes.rollingSummary`.
  - [x] Preserves markdown rendering.
  - [x] Adds Copy Summary.
  - [x] Preserves summary refresh/rebuild behavior if currently available.
  - [x] Has useful empty state when no summary exists.
- [x] Build split Conversations tab layout:
  - [x] Left panel: compact conversation list.
  - [x] Right panel: focused conversation playback/review.
  - [x] Independent desktop scrolling.
  - [x] Mobile list-first layout with playback below.
- [x] Build compact conversation row:
  - [x] Type icon on the right with hover label.
  - [x] Title, e.g. "AI Interview with Saish".
  - [x] Status label.
  - [x] Date/time.
  - [x] Duration.
  - [x] Play affordance on the left when audio is available.
- [x] Map conversation statuses:
  - [x] `done` -> Completed.
  - [x] `processing` -> In progress.
  - [x] `needs_speaker_labels` -> Needs labels.
  - [x] `failed` -> Failed.
- [x] Add filters:
  - [x] All conversations.
  - [x] Status filter.
  - [x] Type filter if low-risk.
- [x] Add sorting:
  - [x] Newest first by default.
  - [x] Oldest first if low-risk.
- [x] Add "View all conversations":
  - [x] Expands or paginates in-place during Phase 1.
  - [x] Does not route to a global Conversations page until that page exists.
- [x] Preserve speaker-labeling workflow:
  - [x] Needs-label rows remain obvious.
  - [x] Existing review UI remains available in a focused panel.
- [x] Surface conversation playback in the Conversations tab:
  - [x] Selecting or playing a row loads the focused playback panel.
  - [x] Preserves existing conversation summary, waveform, transcript, PDF export, listened state, mini-player, and speaker-label review behavior.
  - [x] Avoids adding an extra playback modal.
- [x] Do not include Key Stages, Decision Rules, Pain Points, or Suggested Automations in the Conversations tab.
- [x] Keep the UI shadcn-based and avoid nested cards inside cards.

### Tests and Verification

- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Run `npm test` if conversation query shape changed.
- [ ] Manual conversation list tests:
  - [ ] Empty process.
  - [ ] One conversation.
  - [ ] Many conversations.
  - [ ] Mixed statuses.
  - [ ] Mixed input modes.
  - [ ] Long contributor names.
  - [ ] Missing duration.
  - [ ] Failed conversation.
  - [ ] Needs speaker labels.
- [ ] Manual process summary tests:
  - [ ] No summary empty state.
  - [ ] Existing markdown summary renders.
  - [ ] Long summary scrolls without layout breakage.
  - [ ] Copy Summary copies expected text.
- [ ] Manual playback panel tests:
  - [ ] Selecting a row updates the playback panel.
  - [ ] Play affordance selects the row and exposes playback.
  - [ ] Existing waveform/transcript/review UI remains usable in the panel.
  - [ ] No flow-derived section rows appear in the Conversations tab.
- [ ] Responsive checks:
  - [ ] Desktop split layout.
  - [ ] Overview summary is separate from Conversations.
  - [ ] Mobile Conversations list appears before playback panel.
  - [ ] Text does not overlap buttons or metrics.

### Phase 5 Notes (2026-06-05)

Conversations tab implementation:

- Added `src/components/process-workspace/conversation-list.tsx`.
- Added `src/components/process-workspace/process-summary-panel.tsx`.
- Exported `ConversationListWithPlayer` from `src/components/conversation-log.tsx` so the focused playback panel can show one selected conversation while preserving the existing waveform, transcript, PDF export, listened state, mini-player, and speaker-label review behavior.
- `MillerColumns` now renders a dedicated Overview tab for the process summary.
- `MillerColumns` now renders the Conversations tab as a responsive split surface:
  - Desktop: compact conversation list on the left and focused conversation playback on the right, each with independent scrolling.
  - Mobile: conversation list appears before the focused playback panel.
- Compact rows use the Phase 1 `conversations.listCompactByProcess` query with a bounded 100-row cap and local in-place filtering/sorting.
- Row titles use the input mode and contributor name, with mapped status labels, date/time, duration, a left play/detail affordance, and a right-side type icon with tooltip.
- Status labels map as `done` -> Completed, `processing` -> In progress, `needs_speaker_labels` -> Needs labels, and `failed` -> Failed.
- Filters include all/status/type; sorting supports newest-first by default and oldest-first.
- "View all conversations" expands the compact list in place and does not route to a global Conversations page.
- Needs-label rows use an amber treatment, and selecting or playing a row loads the existing review/player UI in the focused playback panel.

Overview summary implementation:

- The summary panel uses the selected process `rollingSummary` and continues to render through `MarkdownSummary`.
- Copy Summary copies the raw rolling summary text.
- Rebuild preserves the existing `summaries.forceRefreshProcessSummary` path and its previous availability gate.
- The Conversations tab no longer renders the process summary or flow-derived Key Stages, Decision Rules, Pain Points, or Suggested Automations.
- Empty summary state is handled in the summary panel.

Verification:

- `npx eslint src/components/process-workspace/conversation-list.tsx src/components/process-workspace/process-summary-panel.tsx src/components/miller-columns.tsx`: passed.
- `npm run lint`: still fails with the same Phase 0 baseline count, 26 errors and 23 warnings. The new Phase 5 files and edited `MillerColumns` file do not appear in the failure list.
- `npm run build`: passed on Next.js 16.2.7/Turbopack. Existing warning remains: Next inferred workspace root from `C:\Users\saish.gaonkar\package-lock.json` because multiple lockfiles are present.
- `npm test`: passed, 7 test files and 72 tests. Existing test stderr remains around intentionally missing OpenRouter configuration in failure-path tests.
- Signed-in manual conversation-list, process-summary, and responsive checks remain pending until an authenticated browser session is available.

Screenshot polish follow-up:

- 2026-06-05 signed-in screenshot review fixed Phase 5 layout issues where conversation filters overlapped the title, select triggers displayed raw values like `all` / `newest`, and the process summary header squeezed the title/subtitle beside action buttons.
- 2026-06-05 follow-up removed the redundant inner Conversations title and moved the conversation count badge into the Conversations tab trigger.
- 2026-06-05 follow-up moved process summary to its own Overview tab and replaced the Conversations right panel with focused conversation playback/review, removing the need for an additional playback modal.
- 2026-06-05 follow-up moved the conversation play/detail affordance to the left and the type icon to the right with a hover label.
- `npx eslint src/components/process-workspace/conversation-list.tsx src/components/process-workspace/process-summary-panel.tsx src/components/miller-columns.tsx`: passed after the Overview/playback-panel refactor.
- `npm run build`: passed after the Overview/playback-panel refactor. Existing multiple-lockfile warning remains unchanged.
- `npx eslint src/components/process-workspace/conversation-list.tsx src/components/process-workspace/process-summary-panel.tsx src/components/miller-columns.tsx`: passed after the polish.
- `npm run build`: passed after the polish. Existing multiple-lockfile warning remains unchanged.

## Phase 6: Conversation Playback Panel Refinement

Goal: harden focused conversation review inside the Conversations tab while preserving the playback/transcript behavior that works today.

### Tasks

- [x] Reuse existing playback/transcript pieces from `ConversationLog`.
- [x] Build focused playback panel inside the Conversations tab.
- [x] Opening behavior:
  - [x] Pressing play on a list row selects that conversation.
  - [x] The panel loads the selected conversation.
  - [x] Audio remains controlled by the existing explicit play conventions.
- [x] Panel content:
  - [x] Conversation metadata remains in the selected row instead of being duplicated in the playback panel.
  - [x] Waveform audio player appears at the top.
  - [x] Conversation summary appears below playback.
  - [x] Expanded transcript appears below summary.
  - [x] PDF export if currently available.
- [x] Panel presentation:
  - [x] Removes the extra boundary box around playback.
  - [x] Avoids nested conversation cards inside the playback surface.
  - [x] Avoids duplicated title/type/status/date/duration metadata.
- [x] Preserve existing behavior:
  - [x] Audio URL retrieval.
  - [x] Waveform rendering.
  - [x] Rolling transcript sync.
  - [x] Seek behavior.
  - [x] Playback position/listened state where practical.
  - [x] Mini-player behavior where practical.
- [x] Panel states:
  - [x] Loading.
  - [x] No audio.
  - [x] No transcript.
  - [x] Failed conversation.
  - [x] Processing conversation.
  - [x] Needs speaker labels.
- [ ] Selection behavior:
  - [x] Defaults to the first visible conversation.
  - [ ] Keeps keyboard focus predictable after selection.
  - [ ] Does not lose speaker-label progress.

### Phase 6 Notes (2026-06-05)

Playback panel refinement:

- Added `FocusedConversationPlayback` in `src/components/conversation-log.tsx`.
- The Conversations right panel now renders the selected conversation as one open playback surface instead of nesting the existing conversation card inside a playback container.
- The playback panel no longer has an extra boundary box or duplicated conversation title/type/status/date/duration metadata because those are already visible in the selected conversation row.
- Playback controls and waveform sit at the top of the panel, followed by the conversation summary and an expanded transcript section.
- The expanded transcript reuses the existing synced transcript logic, including active-line highlighting and click-to-seek behavior.
- Existing audio URL retrieval, waveform, explicit play controls, playback position/listened state, PDF export, speaker-label review, and mini-player wiring are preserved through the existing playback primitives.
- `npx eslint src/components/process-workspace/conversation-list.tsx`: passed.
- `npx eslint src/components/conversation-log.tsx src/components/process-workspace/conversation-list.tsx`: still fails on the existing `conversation-log.tsx` React Compiler `set-state-in-effect` baseline errors.
- `npm run lint`: still fails with the same Phase 0 baseline count, 26 errors and 23 warnings.
- `npm run build`: passed on Next.js 16.2.7/Turbopack. Existing multiple-lockfile warning remains unchanged.

### Tests and Verification

- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [ ] Manual playback tests:
  - [ ] AI interview audio plays.
  - [ ] Voice record audio plays.
  - [ ] Uploaded audio plays.
  - [ ] Waveform seeks correctly.
  - [ ] Rolling transcript follows playback.
  - [ ] Clicking transcript seeks if current behavior supports it.
  - [ ] Export PDF still works.
  - [ ] Changing selection handles active playback correctly.
- [ ] Accessibility checks:
  - [ ] Playback surface is identifiable to assistive technology without adding redundant visible metadata.
  - [ ] Selected row state is understandable.
  - [ ] Trigger focus remains predictable.
  - [ ] Keyboard can operate playback controls.
- [ ] Responsive checks:
  - [ ] Desktop split playback panel.
  - [ ] Mobile list and playback stacking.
  - [ ] Long transcript scrolls cleanly.

## Phase 7: Process Flow Tab Integration

Goal: restyle and embed the existing process-flow experience in the new workbench without rewriting generation logic.

### Tasks

- [x] Move current `ProcessFlow` into the new tab surface.
- [x] Preserve lazy loading and suspense behavior.
- [x] Preserve generation empty state.
- [x] Preserve generating state.
- [x] Preserve failed state.
- [x] Preserve stale banner and refresh behavior.
- [x] Preserve fullscreen mode.
- [x] Preserve minimap and controls.
- [x] Preserve node click selection.
- [x] Preserve node detail panel.
- [x] Preserve mobile bottom-sheet node details.
- [x] Ensure process-flow canvas has stable dimensions in the new layout.
- [x] Ensure flow-derived metrics can read from current `processFlows` data.
- [x] Do not modify the generation prompt or backend action unless required by a bug.

### Tests and Verification

- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [ ] Manual process-flow tests:
  - [ ] No conversations state.
  - [ ] No flow generated state.
  - [ ] Generate flow.
  - [ ] Generating state.
  - [ ] Ready flow.
  - [ ] Failed flow.
  - [ ] Stale flow refresh.
  - [ ] Fullscreen mode.
  - [ ] Node selection and detail panel.
  - [ ] Mobile flow interaction.
- [ ] Visual checks:
  - [ ] Canvas is not blank.
  - [ ] Canvas is correctly framed.
  - [ ] Controls are not obscured by shell/tabs.
  - [ ] Detail panel does not overlap unusably.

### Phase 7 Notes (2026-06-05)

Process Flow tab integration:

- Added `src/components/process-workspace/process-flow-tab.tsx` as the dedicated Process Flow tab surface.
- `MillerColumns` now delegates the Process Flow tab to `ProcessFlowTab`.
- Lazy loading and `Suspense` were preserved by moving the lazy `ProcessFlow` import into `ProcessFlowTab`.
- `ProcessFlowTab` reads the generated timestamp from `processes.getWorkbench().flow`, which is derived from current `processFlows` data.
- The redundant Process Flow tab title/status cluster and visible metric pills were removed; status and detailed metrics remain available through the canvas states and Insights tab.
- The canvas is now inside a stable, full-height bordered workbench surface with mobile minimum height and desktop `min-h-0` flex sizing.
- `ProcessFlow` now calls `fitView` after ready-flow generation and fullscreen size changes to reduce blank or poorly framed canvas states.
- Flow generation empty, generating, failed, stale/refresh, fullscreen, minimap, controls, node selection, desktop detail panel, and mobile bottom-sheet detail behavior were preserved.
- Start-action errors are now surfaced in the Process Flow UI instead of being stored but not rendered.
- The generated flow layout was changed from top-to-bottom to left-to-right in `src/hooks/use-process-flow-layout.ts`.
- Process-flow node handles now use left-side incoming and right-side outgoing connection points in `src/components/process-flow-nodes.tsx`.
- No process-flow generation prompt, Convex action, or backend flow generation logic was changed.

Verification:

- `npx eslint src/components/process-workspace/process-flow-tab.tsx src/components/process-flow.tsx src/components/process-flow-nodes.tsx src/hooks/use-process-flow-layout.ts src/components/miller-columns.tsx`: passed.
- `npm run build`: passed on Next.js 16.2.7/Turbopack. Existing multiple-lockfile workspace-root warning remains unchanged.
- `npm test`: passed, 7 test files and 72 tests.
- `npm run lint`: still fails on the known Phase 0 baseline React Compiler/react-hooks issues, 26 errors and 12 warnings. The edited Phase 7 files do not appear in the failure list.
- Browser plugin visual check: blocked because the in-app browser backend is unavailable (`Browser is not available: iab`).
- HTTP smoke fallback: `http://biz-group.lvh.me:3000/` returns 307 to auth handling, and `http://biz-group.lvh.me:3000/sign-in` returns 200.
- Signed-in manual process-flow and visual checks remain pending until an authenticated browser session is available.

## Phase 8: Process Insights Tab

Goal: create a process-level operational insights tab from existing process-flow data.

### Tasks

- [x] Build shadcn-based Insights tab layout.
- [x] Use existing `processFlows` data only:
  - [x] `processFlows.insights`
  - [x] `processFlows.nodes`
  - [x] `processFlows.edges`
- [x] Add empty state:
  - [x] No flow exists.
  - [x] Prompt user to generate process flow.
- [x] Add stale state:
  - [x] Show that insights may be based on stale flow data.
  - [x] Provide existing refresh/generate action.
- [x] Add handoffs section:
  - [x] Handoff count.
  - [x] Source and target steps.
  - [x] Actors involved.
  - [x] Related edges/nodes.
- [x] Add tools section:
  - [x] Unique tools.
  - [x] Steps where tools appear.
  - [x] Tool-heavy or handoff-heavy areas.
- [x] Add bottlenecks section:
  - [x] Bottleneck nodes.
  - [x] Associated pain points.
  - [x] Duration signals.
  - [x] Source citations.
- [x] Add automation opportunities section:
  - [x] Flow-level opportunities.
  - [x] Node-level automation potential.
  - [x] Recommendation-only wording.
- [x] Add tribal knowledge risk section:
  - [x] Tribal knowledge nodes.
  - [x] Risk indicators.
  - [x] Sources.
- [x] Add decision points section:
  - [x] Decision nodes.
  - [x] Branch labels.
  - [x] Confidence.
- [x] Add evidence coverage section:
  - [x] Source citations.
  - [x] Confidence distribution.
  - [x] Low-confidence nodes.
- [x] Avoid duplicating process summary content from the Conversations tab.
- [x] Do not add org-level Insights page.

### Tests and Verification

- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [ ] Manual Insights tests:
  - [ ] No flow empty state.
  - [ ] Ready flow with complete data.
  - [ ] Flow with no handoffs.
  - [ ] Flow with no tools.
  - [ ] Flow with no bottlenecks.
  - [ ] Flow with no automation opportunities.
  - [ ] Low-confidence nodes.
  - [ ] Stale flow.
- [ ] Visual checks:
  - [ ] Sections scan well.
  - [ ] Count pills and labels do not imply unsupported precision.
  - [ ] Long node labels and source lists wrap cleanly.
- [ ] Accessibility checks:
  - [x] Sections have semantic headings.
  - [x] Count/status information is text-readable, not color-only.

### Phase 8 Notes (2026-06-05)

Process Insights implementation:

- Replaced the metric-only `ProcessInsightsTab` with a full operational insights tab.
- The tab reads the full generated flow through the existing org-scoped `processFlows.getProcessFlow` query only when the Insights tab is active.
- Insight data is derived from existing `processFlows.insights`, `processFlows.nodes`, and `processFlows.edges`; no schema, generation prompt, or backend action changes were made.
- Empty, generating, failed, zero-node, and stale-flow states are handled inline.
- Empty and stale states use the existing `processFlows.generateProcessFlow` action for contributors/admins; viewers get a View Flow action instead.
- Added sections for handoffs, tools and systems, bottlenecks, automation opportunities, tribal knowledge risk, decision points, and evidence coverage.
- Automation language is framed as recommendation-only, and the tab avoids rendering the process rolling summary.
- No org-level Insights page or sidebar destination was added.

Verification:

- `npx eslint src/components/process-workspace/process-insights-tab.tsx src/components/miller-columns.tsx`: passed.
- `npm run build`: passed on Next.js 16.2.7/Turbopack. Existing multiple-lockfile workspace-root warning remains unchanged.
- `npm run lint`: still fails on the known Phase 0 baseline React Compiler/react-hooks issues, 26 errors and 12 warnings. The Phase 8 files do not appear in the failure list.
- Browser plugin visual check: blocked because the in-app browser backend is unavailable (`Browser is not available: iab`).
- HTTP smoke fallback: `http://biz-group.lvh.me:3000/` returns 307 to `/sign-in?redirect_url=...`, and `http://biz-group.lvh.me:3000/sign-in` returns 200.
- Signed-in manual Insights and visual checks remain pending until an authenticated browser session is available.

## Phase 9: Responsive, Accessibility, and Visual Polish

Goal: make the redesign easy to use, scalable, and executive-demo quality.

### Tasks

- [x] Review shadcn consistency:
  - [x] Buttons.
  - [x] Badges.
  - [x] Dialogs.
  - [x] Tabs.
  - [x] Dropdowns.
  - [x] Inputs.
  - [x] Tooltips.
- [x] Review org theme integration:
  - [x] Accent color on active nav.
  - [x] Accent color on primary actions.
  - [x] Org logo beside Fabric.
  - [x] Fallback logo/initials.
- [x] Review spacing and density:
  - [x] Sidebar width.
  - [x] Tree width.
  - [x] Workbench max/min widths.
  - [x] Metric row wrapping.
  - [x] Conversation row heights.
  - [x] Modal sizing.
- [x] Review text overflow:
  - [x] Long function names.
  - [x] Long department names.
  - [x] Long process names.
  - [x] Long contributor names.
  - [x] Long summary paragraphs.
  - [x] Long flow node labels.
- [x] Review mobile:
  - [x] Overview summary tab.
  - [x] Tree as sheet/drill-down.
  - [x] Capture actions.
  - [x] Playback panel.
  - [x] Process flow.
  - [x] Insights tab.
- [x] Review keyboard accessibility:
  - [x] Sidebar.
  - [x] Tree.
  - [x] Tabs.
  - [x] Capture actions.
  - [x] Conversation list.
  - [x] Playback panel.
  - [x] Process flow controls.
- [x] Review empty/loading/error states:
  - [x] No functions.
  - [x] No departments.
  - [x] No processes.
  - [x] No selected process.
  - [x] No conversations.
  - [x] No summary.
  - [x] No flow.
  - [x] Flow generation failed.
  - [x] Conversation processing failed.

### Tests and Verification

- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Run `npm test`.
- [ ] Browser visual verification:
  - [ ] Desktop 1440px.
  - [ ] Desktop 1280px.
  - [ ] Tablet width.
  - [ ] Mobile width.
  - [ ] Light mode.
  - [ ] Dark mode if supported.
  - [ ] Multiple org themes if available.
- [ ] Interaction verification:
  - [ ] Mouse.
  - [ ] Keyboard.
  - [ ] Touch/mobile.
- [ ] Accessibility verification:
  - [x] No unlabeled icon-only controls.
  - [x] Focus rings visible.
  - [ ] Dialog focus trap works.
  - [x] Color is not the only status signal.
- [ ] Executive-demo verification:
  - [ ] Seed/demo workspace looks credible.
  - [ ] Main path from process selection to summary to playback to flow to insights is smooth.
  - [x] No obvious placeholder destinations are visible.
  - [x] No notification UI appears.

### Phase 9 Notes (2026-06-05)

Responsive/accessibility polish implemented:

- Shell active navigation now uses the org accent selected surface, keeping primary actions tied to the org theme tokens.
- Desktop process tree width now steps from 320px to 360px by breakpoint, with an explicit process-tree landmark and org-accent focus ring on tree rows.
- Process header action buttons wrap at tablet widths, and long process names break instead of clipping.
- Workbench tabs now have an accessible label and horizontal overflow handling for mobile/narrow widths.
- Conversation rows expose selected state to assistive tech and keep the type icon out of the keyboard tab sequence.
- Summary markdown, shared empty states, insight metric tiles, section badges, flow nodes, and flow detail panels now wrap long generated text, labels, sources, tools, actors, and node names more defensively.
- Process-flow stale and metrics overlays wrap more safely on narrow screens.
- CRUD dialogs and recording dialogs are viewport-bounded; CRUD name/location/description fields and recording icon buttons now have explicit accessible labels.
- Existing empty/loading/error states were reviewed across tree, summary, conversation, process-flow, insights, CRUD, and recording surfaces. No notification UI or placeholder sidebar destinations were added.

Verification:

- `npx eslint src/components/process-workspace/process-app-shell.tsx src/components/process-workspace/process-tree-navigator.tsx src/components/process-workspace/process-header.tsx src/components/process-workspace/conversation-list.tsx src/components/markdown-summary.tsx src/components/process-flow-nodes.tsx src/components/process-flow-detail-panel.tsx src/components/process-flow.tsx src/components/process-workspace/process-insights-tab.tsx src/components/miller-columns.tsx src/components/ui/empty-state.tsx src/components/crud-dialog.tsx src/components/recording-modal.tsx`: passed.
- `npm run build`: passed on Next.js 16.2.7/Turbopack. Existing multiple-lockfile workspace-root warning remains unchanged.
- `npm test`: passed, 7 test files and 72 tests.
- `npm run lint`: still fails on the known Phase 0 baseline React Compiler/react-hooks issues, 26 errors and 12 warnings. The Phase 9 touched files do not appear in the failure list.
- Browser plugin visual check: blocked because the in-app browser backend is unavailable (`Browser is not available: iab`).
- HTTP smoke fallback: `http://biz-group.lvh.me:3000/` returns 307 to `/sign-in?redirect_url=...`, and `http://biz-group.lvh.me:3000/sign-in` returns 200.
- Authenticated desktop/mobile visual verification, interaction verification, dialog focus-trap verification, and executive-demo path verification remain pending until an authenticated browser session is available.

## Phase 10: Regression, Rollout, and Documentation

Goal: complete the transition in an organized way with clear verification and fallback.

### Tasks

- [ ] Re-read [fabric-ui-ux-redesign-brief.md](fabric-ui-ux-redesign-brief.md) and confirm every settled decision is implemented or intentionally deferred.
- [ ] Re-run the mock coverage checklist from the brief.
- [ ] Update product docs if behavior changes:
  - [ ] `PRD.md` if the old Miller-column description needs revision.
  - [ ] `PLATFORM_ARCHITECTURE.md` only if architecture changes.
  - [ ] This task list with completed items.
- [ ] Add implementation notes:
  - [ ] Components added.
  - [ ] Components moved.
  - [ ] Existing logic intentionally reused.
  - [ ] New queries, if any.
  - [ ] Known follow-ups.
- [ ] Decide rollout strategy:
  - [ ] Direct replacement if stable.
  - [ ] Feature flag if risk is high.
  - [ ] Temporary fallback route if needed.
- [ ] Finalize branch-specific Convex deployment cleanup plan:
  - [ ] Confirm `dev/ui-redesign` is no longer needed for active implementation or QA.
  - [ ] Export or back up any data that should be preserved from the `dev/ui-redesign` deployment.
  - [ ] Switch local `.env.local` / selected Convex deployment back to the intended ongoing dev deployment.
  - [ ] Verify the app no longer points at `dev/ui-redesign`.
  - [ ] Delete or retire the `dev/ui-redesign` Convex deployment from the Convex dashboard or Management API.
  - [ ] Confirm deleting the deployment is acceptable because it deletes that deployment's data and files, while leaving the Convex project and other deployments intact.
- [ ] Remove dead code only after verifying it is no longer referenced.
- [ ] Do not remove old logic solely because the UI moved; preserve reusable components.

### Tests and Verification

- [ ] Run `npm run lint`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Full manual regression:
  - [ ] Sign in.
  - [ ] Org routing.
  - [ ] Profile onboarding.
  - [ ] Process navigation.
  - [ ] Deep links.
  - [ ] Search/command palette.
  - [ ] CRUD.
  - [ ] Share links.
  - [ ] AI interview.
  - [ ] Voice record.
  - [ ] Audio upload.
  - [ ] Speaker labeling.
  - [ ] Conversation playback panel.
  - [ ] Process summary.
  - [ ] Process flow generation.
  - [ ] Process insights.
  - [ ] Admin/settings navigation.
  - [ ] Viewer/contributor/admin permissions.
  - [ ] Tenant isolation smoke checks.
- [ ] Final browser verification with screenshots:
  - [ ] Desktop process workbench.
  - [ ] Mobile process workbench.
  - [ ] Conversation playback panel.
  - [ ] Process flow.
  - [ ] Process insights.
- [ ] Convex deployment cleanup verification:
  - [ ] Original intended dev deployment is selected locally.
  - [ ] `NEXT_PUBLIC_CONVEX_URL` points to the intended deployment.
  - [ ] `npx convex dev --once` succeeds against the intended deployment.
  - [ ] `dev/ui-redesign` is deleted/retired only after final approval.
- [ ] Confirm no known broken workflows remain before marking the redesign complete.

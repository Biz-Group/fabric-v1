---
id: navigating-fabric
title: Finding your way around the workspace
summary: How to use the sidebar, the Process Tree, search with Ctrl+K or Cmd+K, process tabs and shareable links.
audience: [viewer, contributor, admin]
tags: [navigation, search, hierarchy, tabs]
related: [what-is-fabric, reading-the-overview, roles-and-permissions]
verifiedAgainst:
  - src/features/shell/process-app-shell.tsx
  - src/features/theming/theme-toggle.tsx
  - src/features/shell/help-menu.tsx
  - src/features/hierarchy/process-tree-navigator.tsx
  - src/features/hierarchy/command-palette.tsx
  - src/features/hierarchy/crud-dialog.tsx
  - src/features/workbench/process-workbench.tsx
  - src/features/workbench/process-header.tsx
  - src/features/workbench/use-selection-params.ts
  - src/features/home/workspace-home.tsx
  - src/features/onboarding/walkthrough-steps.ts
---

The workspace has a sidebar on the left, the Process Tree beside it, and a main panel that changes with whatever you select.

## The sidebar

The sidebar links to Home and Release notes. Admins also see Admin. You can collapse it with the collapse button. The theme button in the header (Appearance in the phone menu) lets you pick Light, Dark or System. Home shows the processes in your department, recently opened processes and your own contributions.

## The Process Tree

The Process Tree lists functions, then departments, then processes. Select a row to open it in the main panel, and use the arrow next to a row to expand or collapse it. You can hide the tree with Hide process tree and bring it back with Show process tree.

Contributors and admins also get an add menu in the tree and actions on each row to add a department or process, edit an item, or delete it. A function that still has departments, a department that still has processes, or a process that still has contributions cannot be deleted until those are removed first.

On a phone, the tree becomes a drill-down: functions, then departments, then processes.

## Search with Ctrl+K

Press Ctrl+K (Cmd+K on a Mac), or select the search box at the top, to open search. Type part of a name. Results are grouped as Functions, Departments and Processes. Choose one to jump straight to it.

## Tabs on a process

When you open a process, its tabs are Overview, Contributions, Process Flow, Insights and Automations. The Contributions tab shows how many contributions the process has.

## Sharing a view

Select Share in the process header to copy a link. The link opens the same item on the same tab. Share sits in the More actions menu when space is tight.

## Help

The question-mark icon in the header opens Help: Watch the 2-minute tour, Show me around, and Release notes.

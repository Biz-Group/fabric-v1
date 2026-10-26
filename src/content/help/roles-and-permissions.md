---
id: roles-and-permissions
title: Roles and permissions
summary: What viewers, contributors and admins can each see and do in a Fabric workspace.
audience: [viewer, contributor, admin]
tags: [roles, permissions, admin]
related: [what-is-fabric, contribute-on-behalf, admin-members-and-workspace]
verifiedAgainst:
  - convex/lib/orgAuth.ts
  - docs/prd.md
  - src/features/workbench/process-workbench.tsx
  - src/features/workbench/process-header.tsx
  - src/features/recording/recording-modal.tsx
  - src/features/conversations/conversation-log.tsx
  - src/app/[org]/admin/layout.tsx
  - convex/postCall.ts
  - convex/voiceRecordings.ts
  - convex/functions.ts
---

Every member of a workspace has one of three roles. Each role includes everything the one before it can do. Roles apply to one workspace at a time, and an admin sets them.

## Viewer

A viewer can read everything in the workspace:

- Browse the Process Tree, overviews, contributions, process flows, insights and recommendations.
- Rate whether a recommendation was useful.
- Use search, share links to a process, and download a process PDF report.

A viewer cannot capture contributions. The capture buttons do not appear for viewers.

## Contributor

A contributor can do everything a viewer can, plus:

- Start an AI interview, record a voice note, or upload files on a process.
- Label speakers on a recording that is waiting for labels.
- Add, edit, move and delete functions, departments and processes. A deletion only goes through when the item has nothing inside it.
- Build or refresh an overview, and generate or refresh a Process Flow.
- Shortlist, start, finish or dismiss a recommendation, and generate or retry recommendations.

## Admin

An admin can do everything a contributor can, plus:

- Open the Admin area: Overview, Members, Contributions and Branding.
- Invite members, change roles, and remove members.
- Retry contributions that failed processing, and delete contributions.
- Export contributions as a CSV file.
- Record on behalf of someone else.
- Approve the workspace's accent color.

## Good to know

- If you open the Admin area without admin access, Fabric tells you your current role and asks you to request admin access from a workspace admin.
- Role limits are enforced by the system, not just by which buttons you can see.
- If a button you expect is missing, check your role first. A workspace admin can change it from Admin, then Members.

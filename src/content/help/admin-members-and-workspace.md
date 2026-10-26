---
id: admin-members-and-workspace
title: Admin: members, contributions and branding
summary: How workspace admins invite members, manage roles, review and retry contributions, export data, and set the workspace accent color.
audience: [admin]
tags: [admin, members, invitations, contributions, branding]
related: [roles-and-permissions, after-you-contribute, contribute-on-behalf, navigating-fabric]
verifiedAgainst:
  - src/app/[org]/admin/layout.tsx
  - src/app/[org]/admin/admin-overview-page.tsx
  - src/app/[org]/admin/users/page.tsx
  - src/app/[org]/admin/conversations/page.tsx
  - src/app/[org]/admin/appearance/page.tsx
  - src/features/admin/invite-member-dialog.tsx
  - src/features/admin/parse-invite-emails.ts
  - src/features/admin/pending-invites-list.tsx
  - src/features/admin/edit-placement-dialog.tsx
  - src/features/admin/conversations-export.ts
  - convex/lib/orgAuth.ts
---

Admins manage the workspace from the Admin area. Open it from **Admin** in the sidebar or header. It has four pages: Overview, Members, Contributions and Branding. Other roles see "Admin access required".

## Overview

The Overview page shows counts for Members, Pending invites, Contributions this week and Failed contributions, with recent contributions below.

## Members

The Members page lists everyone in the workspace. Search by name, email or job title, and filter by role or department.

- **Invite members**: enter one or more email addresses, separated by commas or new lines (up to 50 at a time), choose a role (admin, contributor or viewer), and select **Send invite**. Fabric emails each person a link, and the role applies when they accept. Anyone who is already a member, or who already has a pending invitation, is skipped with a message.
- **Change a role**: use the role selector on the member's row. You cannot change your own role.
- **Edit placement**: set a member's department and job title from the row's menu.
- **Remove from workspace**: they lose access immediately and can be invited again later.
- Select several rows to **Change role** or **Remove** in bulk.

Pending invitations appear in a list below, with their expiry date. You can **Resend** or **Revoke** each one. A revoked link stops working.

## Contributions

This page lists every contribution in the workspace. Search by contributor, process, title or summary, and filter by status.

From a row's menu you can **View transcript**, **Label speakers** (when it needs labels), **Open in process**, retry a failed contribution when a retry can help, or **Delete**. Deleting permanently removes the transcript, summary and audio details, and the process overview is refreshed without it.

**Export CSV** downloads the contributions that match your current filters, including who submitted each one and when consent was confirmed for on-behalf recordings.

## Branding

Use Branding to give the workspace an accent color:

1. Select **Generate** to create a candidate from the workspace logo, or choose a color yourself and **Save candidate**.
2. Check the preview.
3. Select **Approve** to apply it to the whole workspace, or **Reject**.

**Reset neutral** removes the accent, and **Restore previous** brings back an earlier approved one. If there is no workspace logo, you can still choose a color manually.

Each person also picks their own Light, Dark or System appearance with the theme button in the header. That choice is personal to their device.

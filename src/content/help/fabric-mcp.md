---
id: fabric-mcp
title: Connect AI assistants to Fabric (MCP)
summary: Ask Claude or Microsoft Copilot about your organization using what you can see in Fabric; how admins switch it on, how members connect, and what the assistant can read.
audience: [viewer, contributor, admin]
tags: [mcp, claude, copilot, ai assistants, connector, add-on]
related: [askfabric, roles-and-permissions, admin-members-and-workspace]
verifiedAgainst:
  - src/app/[org]/admin/mcp/page.tsx
  - src/app/[org]/connect/page.tsx
  - src/features/mcp/connection-guide.tsx
  - src/features/shell/help-menu.tsx
  - convex/mcpSettings.ts
  - convex/mcp/policy.ts
  - convex/mcp/tools.ts
  - convex/mcp/limits.ts
  - convex/mcpUsage.ts
---

Fabric can connect to AI assistants such as Claude through the Model Context Protocol (MCP). The assistant can then answer questions about how your organization works, with links back to the Fabric pages its answer comes from.

## Before you start

MCP is an add-on to your Fabric plan. Once Fabric has added it, a workspace admin switches it on under **Admin**, then **MCP**, after reading and accepting the terms. Those terms explain that data an assistant reads leaves Fabric and is handled by the assistant's provider.

## Connecting an assistant

Open the **?** menu and choose **Connect AI assistants** to copy your workspace's connection URL. Each workspace has its own URL; if you belong to several, add one connector for each.

In Claude, go to **Settings**, then **Connectors**, then **Add custom connector**. Paste the URL, then sign in with your Fabric account when asked. On Claude Team and Enterprise, an owner may need to add the connector first. Microsoft Copilot support is coming soon.

## What the assistant can read

- Only what you can see in Fabric. Your role and membership are checked on every request.
- Overviews, process flows, signals, systems, coverage and Fabric help.
- Individual contributions and transcripts, only if an admin ticks **Also allow individual contributions**.

The assistant can't change anything in Fabric. Heavy use is slowed down: 60 requests a minute per person, and 600 per workspace.

## If it doesn't connect

If the assistant says you signed in but it was refused, MCP is switched off for that workspace, or you aren't a member of it. Ask a workspace admin.

## For admins

The **MCP** page shows who switched it on and when, which version of the terms was accepted, and the contributions setting. Its **Usage** card shows calls, active members and assistants over the last 30 days. Fabric records which tool was used and when, never what was asked. Switching MCP off cuts access straight away.

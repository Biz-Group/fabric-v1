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
  - src/features/mcp/setup-steps.tsx
  - src/features/shell/help-menu.tsx
  - convex/mcpSettings.ts
  - convex/mcp/policy.ts
  - convex/mcp/tools.ts
  - convex/mcp/limits.ts
  - convex/mcpUsage.ts
  - convex/mcpClients.ts
  - src/features/mcp/copilot-studio-card.tsx
---

Fabric can connect to AI assistants such as Claude through the Model Context Protocol (MCP). The assistant can then answer questions about how your organization works, with links back to the Fabric pages its answer comes from.

## Before you start

MCP is an add-on to your Fabric plan. Once Fabric has added it, a workspace admin switches it on under **Admin**, then **MCP**, after reading and accepting the terms. Those terms explain that data an assistant reads leaves Fabric and is handled by the assistant's provider.

## Connecting an assistant

Open the **?** menu and choose **Connect AI assistants**. It walks you through each assistant step by step, with every value ready to copy. Each workspace has its own connection URL; if you belong to several, add one connector for each.

In Claude, go to **Customize**, then **Connectors**, then **Add custom connector**. Name it Fabric, paste the URL, follow the prompts, and sign in with your Fabric account when asked. In a chat, select **+**, then **Connectors**, and switch Fabric on. On Claude Team and Enterprise, an owner may need to add the connector for the organization first.

Microsoft Copilot Studio is set up once per agent, by an agent maker working with a Fabric admin. On the **MCP** page, the **Microsoft Copilot Studio** tab under **Connect an assistant** takes five steps: create credentials, add Fabric as a **Model Context Protocol** tool, choose **OAuth 2.0**, then **Manual**, and paste in the values shown, paste Copilot Studio's callback URL back into Fabric, then connect. Sign-in fails until the callback URL is added. Microsoft 365 Copilot in Teams and Office is coming later.

## What the assistant can read

- Only what you can see in Fabric. Your role and membership are checked on every request.
- Overviews, process flows, signals, systems, coverage and Fabric help.
- Individual contributions and transcripts, only if an admin ticks **Also individual contributions**.

The assistant can't change anything in Fabric. Heavy use is slowed down: 60 requests a minute per person, and 600 per workspace.

## If it doesn't connect

If the assistant says you signed in but it was refused, MCP is switched off for that workspace, or you aren't a member of it. Ask a workspace admin.

## For admins

The **MCP** page shows who switched it on and when, and which version of the terms was accepted. The contributions setting opens from **What assistants can read**, at the top right of **Connect an assistant**. Its **Usage** card shows calls, active members and assistants over the last 30 days. Fabric records which tool was used and when, never what was asked. Switching MCP off cuts access straight away.

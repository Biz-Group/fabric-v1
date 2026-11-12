import { env } from "../_generated/server";

/**
 * The URLs MCP clients connect to. Built from FABRIC_MCP_PUBLIC_URL (M11),
 * falling back to the Convex site URL. Every connector is bound to the exact
 * URL (token audience and resource metadata), so these must not change once
 * real users have connected.
 */
export function mcpBaseUrl(): string {
  return (env.FABRIC_MCP_PUBLIC_URL?.trim() || env.CONVEX_SITE_URL || "").replace(/\/+$/, "");
}

/** One workspace's endpoint, e.g. https://mcp.bizfabric.ai/mcp/biz-group. */
export function workspaceMcpUrl(slug: string): string {
  return `${mcpBaseUrl()}/mcp/${slug}`;
}

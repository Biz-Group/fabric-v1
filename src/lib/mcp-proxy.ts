import { NextResponse, type NextRequest } from "next/server";

/**
 * The Fabric MCP server's public host (decision M11, Option B): requests to
 * `MCP_HOST` (e.g. `mcp.bizfabric.ai`) are proxied to the Convex site
 * deployment (`MCP_UPSTREAM_URL`, e.g. https://<prod>.eu-west-1.convex.site),
 * which serves the MCP endpoint. Moving to a Convex custom domain later
 * (Option A) is a DNS change: the URL clients use stays the same.
 *
 * Runs before Clerk's middleware so the MCP host is never treated as a
 * tenant subdomain or sent to sign-in. Only the MCP paths are forwarded;
 * anything else on the host is a 404.
 */
const MCP_PATHS = [/^\/mcp(\/|$)/, /^\/\.well-known\/oauth-protected-resource(\/|$)/, /^\/\.well-known\/oauth-authorization-server(\/|$)/];

function hostname(host: string | null): string {
  return (host ?? "").split(":")[0].toLowerCase();
}

/** A response for the MCP host, or null when the request is for the app. */
export function mcpProxy(req: NextRequest): NextResponse | null {
  const mcpHost = process.env.MCP_HOST?.trim().toLowerCase();
  if (!mcpHost || hostname(req.headers.get("host")) !== mcpHost) return null;
  const upstream = process.env.MCP_UPSTREAM_URL?.trim().replace(/\/+$/, "");
  const { pathname, search } = req.nextUrl;
  if (!upstream || !MCP_PATHS.some((pattern) => pattern.test(pathname))) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.rewrite(new URL(`${upstream}${pathname}${search}`));
}

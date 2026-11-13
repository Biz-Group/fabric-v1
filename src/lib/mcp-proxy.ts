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

/**
 * Clerk sends a signed-out user in an OAuth flow to the instance's sign-in URL
 * (the apex marketing site), carrying the account portal's consent URL as
 * `redirect_url`. Fabric signs people in on workspace subdomains only, so when
 * that consent is for an MCP workspace URL (`resource=https://<MCP_HOST>/mcp/<slug>`),
 * send them to that workspace's sign-in, which returns to the consent page.
 */
export function oauthSignInRedirect(req: NextRequest, rootDomain: string): NextResponse | null {
  const mcpHost = process.env.MCP_HOST?.trim().toLowerCase();
  const raw = req.nextUrl.searchParams.get("redirect_url");
  if (!mcpHost || !raw || !rootDomain) return null;
  let consent: URL;
  let resource: URL;
  try {
    consent = new URL(raw);
    resource = new URL(consent.searchParams.get("resource") ?? "");
  } catch {
    return null;
  }
  const root = rootDomain.split(":")[0].toLowerCase();
  if (consent.protocol !== "https:" || consent.host.toLowerCase() !== `accounts.${root}` || consent.pathname !== "/oauth-consent") return null;
  if (hostname(resource.host) !== mcpHost) return null;
  const slug = resource.pathname.match(/^\/mcp\/([a-z0-9][a-z0-9-]{0,62})\/?$/)?.[1];
  if (!slug) return null;
  const target = new URL(`${req.nextUrl.protocol}//${slug}.${rootDomain}/sign-in`);
  target.searchParams.set("redirect_url", consent.href);
  return NextResponse.redirect(target);
}

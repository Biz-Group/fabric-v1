import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Exercise the real route matcher and proxy callback without contacting Clerk.
vi.mock("@clerk/nextjs/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("@clerk/nextjs/server")>();
  return { ...original, clerkMiddleware: (handler: unknown) => handler };
});

type ProxyHandler = (
  auth: { protect: ReturnType<typeof vi.fn> },
  request: NextRequest,
) => Promise<Response | undefined>;

let handler: ProxyHandler;
const protect = vi.fn();

// Importing the proxy pulls in Next.js and Clerk; under a full parallel run
// that can exceed vitest's 10 s hook default.
beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "bizfabric.ai");
  handler = (await import("./proxy")).clerkProxy as unknown as ProxyHandler;
}, 30_000);

afterAll(() => vi.unstubAllEnvs());
beforeEach(() => protect.mockReset());

function request(host: string, path: string) {
  return new NextRequest(`https://${host}${path}`, { headers: { host } });
}

describe("public legal routes", () => {
  it.each([
    ["bizfabric.ai", "/privacy"],
    ["bizfabric.ai", "/terms"],
    ["www.bizfabric.ai", "/privacy"],
    ["acme.bizfabric.ai", "/privacy"],
    ["acme.bizfabric.ai", "/terms?source=signup"],
    ["tenants.bizfabric.ai", "/terms"],
  ])("serves %s%s without authentication or rewriting", async (host, path) => {
    expect(await handler({ protect }, request(host, path))).toBeUndefined();
    expect(protect).not.toHaveBeenCalled();
  });

  it.each(["/privacy-settings", "/terms-admin", "/privacy/private"])(
    "keeps adjacent apex route %s protected",
    async (path) => {
      await handler({ protect }, request("bizfabric.ai", path));
      expect(protect).toHaveBeenCalledOnce();
    },
  );

  it("still protects and rewrites a tenant workspace", async () => {
    const response = await handler({ protect }, request("acme.bizfabric.ai", "/"));
    expect(protect).toHaveBeenCalledOnce();
    expect(response?.headers.get("x-middleware-rewrite")).toBe("https://acme.bizfabric.ai/acme");
  });

  it("still protects and rewrites the tenant console", async () => {
    const response = await handler({ protect }, request("tenants.bizfabric.ai", "/"));
    expect(protect).toHaveBeenCalledOnce();
    expect(response?.headers.get("x-middleware-rewrite")).toBe("https://tenants.bizfabric.ai/tenants-console");
  });
});

describe("MCP host (M11 Option B)", () => {
  type Proxy = (req: NextRequest, event: unknown) => Promise<Response | undefined> | Response | undefined;
  const proxyFor = async () => (await import("./proxy")).default as unknown as Proxy;

  beforeEach(() => {
    vi.stubEnv("MCP_HOST", "mcp.bizfabric.ai");
    vi.stubEnv("MCP_UPSTREAM_URL", "https://prod-example.eu-west-1.convex.site/");
  });

  it.each([
    ["/mcp/acme", "https://prod-example.eu-west-1.convex.site/mcp/acme"],
    ["/.well-known/oauth-protected-resource/mcp/acme", "https://prod-example.eu-west-1.convex.site/.well-known/oauth-protected-resource/mcp/acme"],
    ["/.well-known/oauth-authorization-server", "https://prod-example.eu-west-1.convex.site/.well-known/oauth-authorization-server"],
  ])("proxies %s to Convex without Clerk", async (path, target) => {
    const proxy = await proxyFor();
    const response = await proxy(request("mcp.bizfabric.ai", path), {});
    expect(response?.headers.get("x-middleware-rewrite")).toBe(target);
    expect(protect).not.toHaveBeenCalled();
  });

  it("answers 404 for anything else on the MCP host", async () => {
    const proxy = await proxyFor();
    expect((await proxy(request("mcp.bizfabric.ai", "/"), {}))?.status).toBe(404);
    expect((await proxy(request("mcp.bizfabric.ai", "/admin"), {}))?.status).toBe(404);
  });

  it("leaves every other host, and an unconfigured deployment, to the app", async () => {
    const { mcpProxy } = await import("@/lib/mcp-proxy");
    expect(mcpProxy(request("acme.bizfabric.ai", "/mcp/acme"))).toBeNull();
    vi.stubEnv("MCP_HOST", "");
    expect(mcpProxy(request("mcp.bizfabric.ai", "/mcp/acme"))).toBeNull();
  });
});

describe("MCP OAuth sign-in on the apex", () => {
  const consent =
    "https://accounts.bizfabric.ai/oauth-consent?client_id=x&resource=https%3A%2F%2Fmcp.bizfabric.ai%2Fmcp%2Fbiz-group&state=s";
  beforeEach(() => vi.stubEnv("MCP_HOST", "mcp.bizfabric.ai"));

  it("sends an MCP consent sign-in to the workspace's own sign-in page", async () => {
    const response = await handler({ protect }, request("www.bizfabric.ai", `/?redirect_url=${encodeURIComponent(consent)}`));
    const location = new URL(response?.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe("https://biz-group.bizfabric.ai/sign-in");
    expect(location.searchParams.get("redirect_url")).toBe(consent);
    expect(protect).not.toHaveBeenCalled();
  });

  it("finds the workspace from a Copilot Studio client id when the consent has no resource", async () => {
    vi.stubEnv("MCP_UPSTREAM_URL", "https://prod-example.eu-west-1.convex.site");
    const lookups: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        lookups.push(url);
        return url.includes("client_id=bCLTLloAwViNWWwT") ? Response.json({ slug: "biz-group" }) : Response.json({}, { status: 404 });
      }),
    );
    try {
      const copilot = "https://accounts.bizfabric.ai/oauth-consent?client_id=bCLTLloAwViNWWwT&redirect_uri=https%3A%2F%2Fglobal.consent.azure-apim.net%2Fredirect%2Fx";
      const response = await handler({ protect }, request("www.bizfabric.ai", `/?redirect_url=${encodeURIComponent(copilot)}`));
      const location = new URL(response?.headers.get("location") ?? "");
      expect(location.origin + location.pathname).toBe("https://biz-group.bizfabric.ai/sign-in");
      expect(location.searchParams.get("redirect_url")).toBe(copilot);
      expect(lookups).toEqual(["https://prod-example.eu-west-1.convex.site/mcp-oauth/client-workspace?client_id=bCLTLloAwViNWWwT"]);

      const unknown = copilot.replace("bCLTLloAwViNWWwT", "someoneElse123");
      const other = await handler({ protect }, request("www.bizfabric.ai", `/?redirect_url=${encodeURIComponent(unknown)}`));
      expect(other?.headers.get("location") ?? "").not.toContain("/sign-in");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ["a consent for another resource", consent.replace("mcp.bizfabric.ai", "evil.example")],
    ["another host than the account portal", consent.replace("accounts.bizfabric.ai", "evil.example")],
    ["no redirect", ""],
  ])("leaves %s to the marketing site", async (_label, raw) => {
    const response = await handler({ protect }, request("www.bizfabric.ai", raw ? `/?redirect_url=${encodeURIComponent(raw)}` : "/"));
    expect(response?.headers.get("location") ?? "").not.toContain("/sign-in");
  });
});


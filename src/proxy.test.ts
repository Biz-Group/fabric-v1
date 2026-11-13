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

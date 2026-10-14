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

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "bizfabric.ai");
  handler = (await import("./proxy")).default as unknown as ProxyHandler;
});

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

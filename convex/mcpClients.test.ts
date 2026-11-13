/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { userErrorMessageOf } from "./lib/userError";
import { resetJwksCache } from "./mcp/auth";
import { MCP_POLICY } from "./mcp/policy";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://mcp-clients.test";
const ORG = "org_clients_a";
const OTHER = "org_clients_b";
const CALLBACK = "https://global.consent.azure-apim.net/redirect/cr01c-5ffabric-5f4b5c25c1819f8a70";
const ENV: Record<string, string> = {
  CLERK_JWT_ISSUER_DOMAIN: ISSUER,
  CLERK_SECRET_KEY: "sk_test_clients",
  FABRIC_MCP: "true",
  FABRIC_MCP_ENFORCE_AUDIENCE: "true",
  CONVEX_SITE_URL: "https://clients.convex.site",
};
const saved = Object.fromEntries(["FABRIC_MCP_CLIENT_IDS", ...Object.keys(ENV)].map((k) => [k, process.env[k]]));

type ClerkCall = { method: string; path: string; body: unknown };
let clerkCalls: ClerkCall[];
let jwk: Record<string, unknown> | null;

beforeEach(() => {
  Object.assign(process.env, ENV);
  delete process.env.FABRIC_MCP_CLIENT_IDS;
  clerkCalls = [];
  jwk = null;
  let apps = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname.endsWith("/.well-known/jwks.json")) return Response.json({ keys: jwk ? [jwk] : [] });
      const method = init?.method ?? "GET";
      const path = url.pathname.replace(/^\/v1/, "");
      clerkCalls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === "POST" && path === "/oauth_applications") {
        apps += 1;
        return Response.json({ id: `oa_${apps}`, client_id: `client_${apps}`, client_secret: `secret_${apps}` });
      }
      if (method === "POST" && path.endsWith("/rotate_secret")) return Response.json({ id: "oa_1", client_id: "client_1", client_secret: "secret_rotated" });
      if (method === "PATCH") return Response.json({ id: path.split("/").pop() });
      if (method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({ errors: [{ code: "not_found" }] }, { status: 404 });
    }),
  );
});
afterEach(() => {
  for (const [k, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[k];
    else process.env[k] = value;
  }
  vi.unstubAllGlobals();
});

async function setup({ enabled = true } = {}) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const ids = await t.run(async (ctx) => {
    const person = async (name: string, orgId: string, role: "admin" | "viewer") => {
      const tokenIdentifier = `${ISSUER}|${name}`;
      const userId = await ctx.db.insert("users", { tokenIdentifier, name, email: `${name}@example.test`, profileComplete: true });
      await ctx.db.insert("memberships", { tokenIdentifier, userId, clerkOrgId: orgId, role, status: "active", createdAt: 0 });
      return userId;
    };
    const tenant = (clerkOrgId: string, slug: string) =>
      ctx.db.insert("tenants", { clerkOrgId, name: slug, slug, allowedEmailDomains: [], status: "active", source: "console", createdAt: 0, updatedAt: 0 });
    for (const orgId of [ORG, OTHER]) {
      await ctx.db.insert("orgFeatures", {
        clerkOrgId: orgId,
        mcpGranted: true,
        mcpEnabled: enabled,
        mcpPolicyVersion: MCP_POLICY.version,
        mcpConversationTools: false,
        updatedAt: 0,
      });
    }
    return {
      tenantId: await tenant(ORG, "acme"),
      admin: await person("admin", ORG, "admin"),
      member: await person("member", ORG, "viewer"),
      // A member of both workspaces, to show the credentials still bind to one.
      both: await person("both", ORG, "viewer"),
      bothOther: await (async () => {
        await tenant(OTHER, "other");
        const row = await ctx.db.query("users").withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", `${ISSUER}|both`)).unique();
        await ctx.db.insert("memberships", { tokenIdentifier: `${ISSUER}|both`, userId: row!._id, clerkOrgId: OTHER, role: "viewer", status: "active", createdAt: 0 });
        return row!._id;
      })(),
      staff: await (async () => {
        const userId = await ctx.db.insert("users", { tokenIdentifier: `${ISSUER}|staff`, name: "staff", email: "staff@example.test", profileComplete: true, platformRole: "superAdmin" });
        await ctx.db.insert("memberships", { tokenIdentifier: `${ISSUER}|staff`, userId, clerkOrgId: OTHER, role: "admin", status: "active", createdAt: 0 });
        return userId;
      })(),
    };
  });
  const as = (who: "admin" | "member" | "staff") =>
    t.withIdentity({ tokenIdentifier: `${ISSUER}|${who}`, subject: who, issuer: ISSUER, orgId: who === "staff" ? OTHER : ORG });
  return { t, ids, as };
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return userErrorMessageOf(error) ?? (error as Error).message;
  }
  throw new Error("expected a refusal");
}

async function signToken(subject: string, clientId: string) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  resetJwksCache();
  // Copilot Studio's tokens carry no audience.
  return new SignJWT({ client_id: clientId, scope: "profile email" })
    .setProtectedHeader({ alg: "RS256", kid: "k1", typ: "at+jwt" })
    .setIssuer(ISSUER)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

describe("Copilot Studio credentials", () => {
  test("an admin creates them once MCP is on; the secret is returned, never stored", async () => {
    const { t, as } = await setup();
    await expect(as("member").action(api.mcpClients.createCopilotStudioClient, {})).rejects.toThrow();
    expect(await as("admin").action(api.mcpClients.createCopilotStudioClient, {})).toEqual({ clientId: "client_1", clientSecret: "secret_1" });
    expect(clerkCalls[0]).toMatchObject({ method: "POST", path: "/oauth_applications", body: { public: false, scopes: "profile email" } });
    const rows = await t.run(async (ctx) => await ctx.db.query("mcpOAuthClients").collect());
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("secret_1");
    expect(await refusal(as("admin").action(api.mcpClients.createCopilotStudioClient, {}))).toMatch(/already has Copilot Studio credentials/);
    const setup2 = await as("admin").query(api.mcpClients.copilotStudioSetup, {});
    expect(setup2).toMatchObject({
      available: true,
      serverUrl: "https://clients.convex.site/mcp/acme",
      authorizationUrl: `${ISSUER}/oauth/authorize`,
      tokenUrl: `${ISSUER}/oauth/token`,
      client: { clientId: "client_1", callbackUrls: [], createdByName: "admin" },
    });
  });

  test("needs MCP switched on", async () => {
    const { as } = await setup({ enabled: false });
    expect(await as("admin").query(api.mcpClients.copilotStudioSetup, {})).toEqual({ available: false });
    expect(await refusal(as("admin").action(api.mcpClients.createCopilotStudioClient, {}))).toMatch(/Switch on MCP/);
  });

  test("callback URLs are validated and registered at Clerk; secrets regenerate", async () => {
    const { as } = await setup();
    await as("admin").action(api.mcpClients.createCopilotStudioClient, {});
    expect(await refusal(as("admin").action(api.mcpClients.addCallbackUrl, { url: "https://evil.test/redirect/x" }))).toMatch(/isn't a Copilot Studio callback URL/);
    await as("admin").action(api.mcpClients.addCallbackUrl, { url: ` ${CALLBACK} ` });
    expect(clerkCalls.at(-1)).toEqual({ method: "PATCH", path: "/oauth_applications/oa_1", body: { redirect_uris: [CALLBACK] } });
    expect(await as("admin").query(api.mcpClients.copilotStudioSetup, {})).toMatchObject({ client: { callbackUrls: [CALLBACK] } });
    await as("admin").action(api.mcpClients.removeCallbackUrl, { url: CALLBACK });
    // Clerk always keeps at least the generic redirect.
    expect(clerkCalls.at(-1)?.body).toEqual({ redirect_uris: ["https://global.consent.azure-apim.net/redirect"] });
    expect(await as("admin").action(api.mcpClients.regenerateSecret, {})).toEqual({ clientId: "client_1", clientSecret: "secret_rotated" });
  });

  test("its tokens work without an audience, but only at its own workspace's URL", async () => {
    const { t, as } = await setup();
    await as("admin").action(api.mcpClients.createCopilotStudioClient, {});
    const call = async (path: string, subject: string, clientId: string) =>
      await t.fetch(path, {
        method: "POST",
        headers: { Authorization: `Bearer ${await signToken(subject, clientId)}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
    expect((await call("/mcp/acme", "member", "client_1")).status).toBe(200);
    // Same person, a workspace they also belong to: the credentials don't cross over.
    expect((await call("/mcp/other", "both", "client_1")).status).toBe(403);
    // An unknown client is refused outright.
    expect((await call("/mcp/acme", "member", "client_unknown")).status).toBe(401);
  });

  test("the sign-in redirect finds a workspace only for clients the MCP server accepts", async () => {
    const { t, as } = await setup();
    process.env.FABRIC_MCP_CLIENT_IDS = "https://claude.ai/oauth/mcp-oauth-client-metadata";
    await as("admin").action(api.mcpClients.createCopilotStudioClient, {});
    const lookup = async (clientId: string, resource = "") =>
      await t.fetch(`/mcp-oauth/client-workspace?${new URLSearchParams({ client_id: clientId, resource })}`, { method: "GET" });
    // A workspace's own Copilot Studio client, with no resource.
    expect(await (await lookup("client_1")).json()).toEqual({ slug: "acme" });
    // An allowlisted client naming an MCP workspace URL.
    expect(await (await lookup("https://claude.ai/oauth/mcp-oauth-client-metadata", "https://clients.convex.site/mcp/acme")).json()).toEqual({ slug: "acme" });
    // Refused: an unknown client even with our resource, an allowlisted client
    // with a foreign or missing resource, or a workspace that doesn't exist.
    expect((await lookup("https://evil.example/client.json", "https://clients.convex.site/mcp/acme")).status).toBe(404);
    expect((await lookup("https://claude.ai/oauth/mcp-oauth-client-metadata", "https://evil.example/mcp/acme")).status).toBe(404);
    expect((await lookup("https://claude.ai/oauth/mcp-oauth-client-metadata")).status).toBe(404);
    expect((await lookup("https://claude.ai/oauth/mcp-oauth-client-metadata", "https://clients.convex.site/mcp/nope")).status).toBe(404);
  });

  test("revoking the add-on deletes the credentials at Clerk", async () => {
    vi.useFakeTimers();
    try {
      const { t, ids, as } = await setup();
      await as("admin").action(api.mcpClients.createCopilotStudioClient, {});
      await t.withIdentity({ tokenIdentifier: `${ISSUER}|staff`, subject: "staff", issuer: ISSUER }).mutation(api.mcpSettings.setGranted, { tenantId: ids.tenantId, granted: false });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(clerkCalls.at(-1)).toMatchObject({ method: "DELETE", path: "/oauth_applications/oa_1" });
      expect(await t.run(async (ctx) => (await ctx.db.query("mcpOAuthClients").collect()).length)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

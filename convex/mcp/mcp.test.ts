/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { ASK_TOOLS } from "../askTools/catalog";
import { NOT_FOUND, searchResult, type AskToolResult } from "../askTools/results";
import { resetJwksCache, verifyAccessToken } from "./auth";
import { detectEra, finishResult, headerMismatch, parseMessage, type JsonRpcRequest } from "./protocol";
import { MCP_TOOL_NAMES, toMcpContent, toolListEntries } from "./tools";

const modules = import.meta.glob("/convex/**/*.ts");
const ISSUER = "https://mcp-spike.test";
const ORG_A = "org_mcp_a";
const ORG_B = "org_mcp_b";
const CLIENT = "client_spike";
const ENV: Record<string, string> = {
  CLERK_JWT_ISSUER_DOMAIN: ISSUER,
  FABRIC_MCP: ORG_A,
  FABRIC_MCP_CLIENT_IDS: CLIENT,
  CONVEX_SITE_URL: "https://spike.convex.site",
};
const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

beforeEach(() => Object.assign(process.env, ENV));
afterEach(() => {
  for (const [k, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[k];
    else process.env[k] = value;
  }
  vi.unstubAllGlobals();
});

const request = (method: string, params?: Record<string, unknown>, id: number | undefined = 1): JsonRpcRequest =>
  ({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, ...(params ? { params } : {}) }) as JsonRpcRequest;
const modernMeta = { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } };

describe("protocol", () => {
  test("parses one JSON-RPC request and refuses anything else", () => {
    expect(parseMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" })).not.toBeNull();
    expect(parseMessage([{ jsonrpc: "2.0", id: 1, method: "tools/list" }])).toBeNull();
    expect(parseMessage({ jsonrpc: "1.0", id: 1, method: "x" })).toBeNull();
    expect(parseMessage({ jsonrpc: "2.0", id: {}, method: "x" })).toBeNull();
  });

  test("detects modern, legacy and unsupported requests", () => {
    expect(detectEra(request("tools/list", modernMeta), "2026-07-28")).toEqual({ kind: "modern", version: "2026-07-28" });
    expect(detectEra(request("initialize", { protocolVersion: "2025-06-18" }), null)).toEqual({ kind: "legacy", version: "2025-06-18" });
    expect(detectEra(request("initialize", { protocolVersion: "2024-11-05" }), null)).toEqual({ kind: "legacy", version: "2025-11-25" });
    expect(detectEra(request("tools/list"), "2025-11-25")).toEqual({ kind: "legacy", version: "2025-11-25" });
    expect(detectEra(request("tools/list"), null)).toEqual({ kind: "legacy", version: "2025-03-26" });
    expect(detectEra(request("tools/list"), "1900-01-01")).toEqual({ kind: "unsupported", requested: "1900-01-01" });
  });

  test("modern requests must repeat method and tool name in headers", () => {
    const era = { kind: "modern", version: "2026-07-28" } as const;
    const call = request("tools/call", { ...modernMeta, name: "getOverview" });
    expect(headerMismatch(call, era, { version: "2026-07-28", method: "tools/call", name: "getOverview" })).toBeNull();
    expect(headerMismatch(call, era, { version: "2026-07-28", method: null, name: null })).toMatch(/Missing Mcp-Method/);
    expect(headerMismatch(call, era, { version: "2026-07-28", method: "tools/call", name: "getTranscript" })).toMatch(/Mcp-Name/);
    expect(headerMismatch(call, { kind: "legacy", version: "2025-11-25" }, { version: null, method: null, name: null })).toBeNull();
  });

  test("modern results carry resultType, serverInfo and cache hints", () => {
    const modern = finishResult({ kind: "modern", version: "2026-07-28" }, { tools: [] }, true);
    expect(modern).toMatchObject({ resultType: "complete", ttlMs: 300_000, cacheScope: "private" });
    expect(finishResult({ kind: "legacy", version: "2025-11-25" }, { tools: [] }, true)).toEqual({ tools: [] });
  });
});

describe("tools", () => {
  test("exposes only the synthesised member tools (M2), all read-only", () => {
    const entries = toolListEntries();
    expect(entries.map((e) => e.name)).toEqual([...MCP_TOOL_NAMES]);
    for (const excluded of ["getTranscript", "searchConversations", "listConversations", "getConversationEvidence", "getParticipation", "show"]) {
      expect(entries.map((e) => e.name)).not.toContain(excluded);
    }
    expect(entries.every((e) => e.annotations.readOnlyHint && !e.annotations.openWorldHint)).toBe(true);
    // No schema may let a client name the org, user or role.
    const schemas = JSON.stringify(entries.map((e) => e.inputSchema)).toLowerCase();
    for (const field of ["orgid", "userid", "tokenidentifier", "viewer"]) expect(schemas).not.toContain(`"${field}"`);
    expect(ASK_TOOLS.length).toBeGreaterThan(entries.length);
  });

  test("turns search results into linked text sections", () => {
    const result: AskToolResult = {
      found: true,
      content: [
        { type: "text", text: "Fabric data." },
        searchResult("fabric:overview/process/p1", "Invoice approval", "Approvals wait on the CFO."),
        searchResult("fabric:help/roles", "Roles", "Admins manage members."),
      ],
      resultCount: 2,
      resultTokens: 50,
      truncated: true,
      cursor: "next-1",
    };
    const [content] = toMcpContent(result, new Map([["fabric:overview/process/p1", "https://acme.bizfabric.ai/acme?fn=f&dept=d&proc=p1"]]));
    expect(content.text).toContain("### Invoice approval\nLink: https://acme.bizfabric.ai/acme?fn=f&dept=d&proc=p1\nApprovals wait on the CFO.");
    expect(content.text).toContain("### Roles\nAdmins manage members.");
    expect(content.text).toContain('cursor "next-1"');
    expect(content.text).not.toContain("fabric:");
    expect(toMcpContent(NOT_FOUND, new Map())[0].text).toMatch(/Nothing found/);
  });
});

async function seed(ctx: MutationCtx) {
  const tenant = (clerkOrgId: string, slug: string, status: "active" | "suspended" = "active") =>
    ctx.db.insert("tenants", {
      clerkOrgId,
      name: slug,
      slug,
      allowedEmailDomains: [],
      status,
      source: "console",
      createdAt: 0,
      updatedAt: 0,
    });
  await tenant(ORG_A, "alpha");
  await tenant(ORG_B, "beta");
  await tenant("org_mcp_closed", "closed", "suspended");
  const person = async (name: string, orgId: string, removed = false) => {
    const tokenIdentifier = `${ISSUER}|${name}`;
    const userId = await ctx.db.insert("users", { tokenIdentifier, name, email: `${name}@example.test`, profileComplete: true });
    await ctx.db.insert("memberships", {
      tokenIdentifier,
      userId,
      clerkOrgId: orgId,
      role: "viewer",
      createdAt: 0,
      ...(removed ? { status: "removed" as const, removedAt: 1 } : {}),
    });
    return tokenIdentifier;
  };
  return {
    ana: await person("ana", ORG_A),
    bob: await person("bob", ORG_B),
    gone: await person("gone", ORG_A, true),
    closedMember: await person("cleo", "org_mcp_closed"),
  };
}

describe("resolveViewer", () => {
  test("only an active member of an enabled workspace gets through", async () => {
    const t = convexTest(schema, modules);
    const people = await t.run(seed);
    const resolve = (slug: string, tokenIdentifier: string) =>
      t.query(internal.mcp.access.resolveViewer, { workspace: { slug }, tokenIdentifier });

    expect(await resolve("alpha", people.ana)).toEqual({ ok: true, viewer: { tokenIdentifier: people.ana, orgId: ORG_A }, slug: "alpha", role: "viewer", enabled: true });
    // The picker names the workspace by the org chosen at sign-in.
    expect(await t.query(internal.mcp.access.resolveViewer, { workspace: { clerkOrgId: ORG_A }, tokenIdentifier: people.ana })).toMatchObject({ ok: true, slug: "alpha" });
    expect(await t.query(internal.mcp.access.resolveViewer, { workspace: { clerkOrgId: ORG_A }, tokenIdentifier: people.bob })).toMatchObject({ ok: false, status: 404 });
    expect(await resolve("ALPHA", people.ana)).toMatchObject({ ok: true });
    // Another tenant's member, a removed member, an unknown slug and a closed
    // workspace all look the same.
    for (const [slug, who] of [["alpha", people.bob], ["alpha", people.gone], ["nope", people.ana], ["closed", people.closedMember]] as const) {
      expect(await resolve(slug, who)).toEqual({ ok: false, status: 404, reason: "UNKNOWN_WORKSPACE" });
    }
    // Beta's own member, but MCP is only switched on for alpha.
    expect(await resolve("beta", people.bob)).toMatchObject({ ok: true, slug: "beta", enabled: false });
  });
});

async function signerFor() {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Content-Type": "application/json" } })));
    resetJwksCache();
    return (claims: Record<string, unknown>, issuer = ISSUER, subject = "user_ana") =>
      new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1", typ: "at+jwt" }).setIssuer(issuer).setSubject(subject).setIssuedAt().setExpirationTime("1h").sign(privateKey);
}

describe("verifyAccessToken", () => {
  const signer = signerFor;

  test("accepts an OAuth token from an allowed client", async () => {
    const sign = await signer();
    const check = await verifyAccessToken(`Bearer ${await sign({ client_id: CLIENT, scope: "profile email" })}`);
    expect(check).toMatchObject({ ok: true, token: { clerkUserId: "user_ana", clientId: CLIENT, scopes: ["profile", "email"], format: "jwt" } });
  });

  test("refuses session tokens, other clients, other issuers and a missing allowlist", async () => {
    const sign = await signer();
    expect(await verifyAccessToken(`Bearer ${await sign({ sid: "sess_1", azp: CLIENT })}`)).toMatchObject({ ok: false, reason: expect.stringMatching(/session token/) });
    expect(await verifyAccessToken(`Bearer ${await sign({ aud: "convex", client_id: CLIENT })}`)).toMatchObject({ ok: false });
    expect(await verifyAccessToken(`Bearer ${await sign({ client_id: "someone_else" })}`)).toMatchObject({ ok: false, reason: "OAuth client is not allowed" });
    expect(await verifyAccessToken(`Bearer ${await sign({ client_id: CLIENT }, "https://evil.test")}`)).toMatchObject({ ok: false });
    expect(await verifyAccessToken(null)).toMatchObject({ ok: false, reason: "no bearer token" });
    delete process.env.FABRIC_MCP_CLIENT_IDS;
    expect(await verifyAccessToken(`Bearer ${await sign({ client_id: CLIENT })}`)).toMatchObject({ ok: false, reason: "OAuth client is not allowed" });
  });
});

describe("HTTP", () => {
  test("challenges an unauthenticated request with the resource metadata URL", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/mcp/alpha", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Bearer resource_metadata="https://spike.convex.site/.well-known/oauth-protected-resource/mcp/alpha", scope="profile email"',
    );
  });

  test("serves protected resource metadata for the workspace URL", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/.well-known/oauth-protected-resource/mcp/alpha", { method: "GET" });
    expect(await response.json()).toMatchObject({ resource: "https://spike.convex.site/mcp/alpha", authorization_servers: [ISSUER] });
  });

  test("the picker URL asks for the org scope", async () => {
    const t = convexTest(schema, modules);
    const challenge = await t.fetch("/mcp", { method: "POST", body: "{}" });
    expect(challenge.headers.get("WWW-Authenticate")).toContain('oauth-protected-resource/mcp", scope="profile email user:org:read"');
    const metadata = await (await t.fetch("/.well-known/oauth-protected-resource/mcp", { method: "GET" })).json();
    expect(metadata).toMatchObject({ resource: "https://spike.convex.site/mcp", scopes_supported: ["profile", "email", "user:org:read"] });
  });

  test("routes signed-in calls by the URL or the picked workspace, never across them", async () => {
    const t = convexTest(schema, modules);
    await t.run(seed);
    const sign = await signerFor();
    const listTools = async (path: string, claims: Record<string, unknown>) =>
      t.fetch(path, {
        method: "POST",
        headers: { Authorization: `Bearer ${await sign({ client_id: CLIENT, ...claims }, ISSUER, "ana")}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
    expect((await listTools("/mcp/alpha", {})).status).toBe(200);
    expect((await listTools("/mcp", { org_id: ORG_A })).status).toBe(200);
    // Picker without a picked workspace: sign in again.
    expect((await listTools("/mcp", {})).status).toBe(401);
    // A token picked for beta is refused at alpha's URL.
    expect((await listTools("/mcp/alpha", { org_id: ORG_B })).status).toBe(403);
    // Ana picking beta, where she isn't a member, gets the same 404 as an unknown workspace.
    expect((await listTools("/mcp", { org_id: ORG_B })).status).toBe(404);
  });

  test("a member of a workspace with MCP off is refused at connection", async () => {
    const t = convexTest(schema, modules);
    await t.run(seed);
    const sign = await signerFor();
    const token = await sign({ client_id: CLIENT, org_id: ORG_B }, ISSUER, "bob");
    const post = (body: unknown) =>
      t.fetch("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const listed = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(listed.status).toBe(403);
    expect((await listed.json()).error.message).toMatch(/isn't turned on for this Fabric workspace/);
    expect((await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "getCoverage", arguments: {} } })).status).toBe(403);
  });

  test("refuses browser origins and GET", async () => {
    const t = convexTest(schema, modules);
    expect((await t.fetch("/mcp/alpha", { method: "POST", headers: { Origin: "https://evil.test" }, body: "{}" })).status).toBe(403);
    expect((await t.fetch("/mcp/alpha", { method: "GET" })).status).toBe(405);
  });
});

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { ASK_TOOLS } from "../askTools/catalog";
import { NOT_FOUND, searchResult, type AskToolResult } from "../askTools/results";
import { resetJwksCache, verifyAccessToken } from "./auth";
import { detectEra, finishResult, headerMismatch, parseMessage, type JsonRpcRequest } from "./protocol";
import { MCP_CONVERSATION_TOOL_NAMES, MCP_TOOL_NAMES, mcpTools, toMcpContent, toolListEntries } from "./tools";

const modules = import.meta.glob("/convex/**/*.ts");
const RESOURCE = "https://spike.convex.site/mcp/alpha";

/** A test deployment with the rate-limiter component mounted. */
function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return t;
}
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
    const entries = toolListEntries({ conversationTools: false });
    expect(entries.map((e) => e.name)).toEqual([...MCP_TOOL_NAMES]);
    expect(entries[0].name).toBe("getWorkspaceContents");
    for (const excluded of ["getTranscript", "searchConversations", "listConversations", "getConversationEvidence", "getParticipation", "show"]) {
      expect(entries.map((e) => e.name)).not.toContain(excluded);
    }
    expect(entries.every((e) => e.annotations.readOnlyHint && !e.annotations.openWorldHint)).toBe(true);
    // No schema may let a client name the org, user or role.
    const schemas = JSON.stringify(entries.map((e) => e.inputSchema)).toLowerCase();
    for (const field of ["orgid", "userid", "tokenidentifier", "viewer"]) expect(schemas).not.toContain(`"${field}"`);
    expect(ASK_TOOLS.length).toBeGreaterThan(entries.length);
  });

  test("placeholder inputs are published as optional, so clients don't ask users for them", () => {
    const tools = Object.fromEntries(mcpTools({ conversationTools: true }).map((tool) => [tool.name, tool]));
    expect(tools.getCoverage.publishedSchema.required).toEqual([]);
    expect(tools.getCoverage.defaults).toEqual({ kind: "org", id: "" });
    expect(tools.rankSignals.publishedSchema.required).toEqual(["signals"]);
    expect(tools.rankSignals.defaults).toMatchObject({ kind: "org", id: "", limit: 0 });
    expect(tools.browseHierarchy.defaults).toMatchObject({ kind: "root", id: "" });
    expect(tools.searchHierarchy.publishedSchema.required).toEqual(["query"]);
    expect(tools.getTranscript.publishedSchema.required).toEqual(["conversationId"]);
    expect(tools.getTranscript.defaults).toMatchObject({ atSeconds: -1, full: false, query: "" });
    // Every field is either still required or has a default: the strict executor always gets a full call.
    for (const tool of Object.values(tools)) {
      const strict = (tool.inputSchema.required ?? []) as string[];
      const published = (tool.publishedSchema.required ?? []) as string[];
      expect(strict.every((key) => published.includes(key) || key in tool.defaults)).toBe(true);
      // The strict schema the executor validates is untouched.
      expect(strict).toEqual(Object.keys((tool.inputSchema.properties ?? {}) as object));
    }
  });

  test("conversation tools are appended only when the admin turns them on (M2)", () => {
    const withConversations = toolListEntries({ conversationTools: true }).map((e) => e.name);
    expect(withConversations).toEqual([...MCP_TOOL_NAMES, ...MCP_CONVERSATION_TOOL_NAMES]);
    expect(withConversations).not.toContain("getParticipation");
    expect(withConversations).not.toContain("show");
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
  // Alpha has the add-on and has switched MCP on; beta has the add-on only.
  const features = (clerkOrgId: string, mcpEnabled: boolean) =>
    ctx.db.insert("orgFeatures", { clerkOrgId, mcpGranted: true, mcpEnabled, mcpConversationTools: false, updatedAt: 0 });
  await features(ORG_A, true);
  await features(ORG_B, false);
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
    const t = setup();
    const people = await t.run(seed);
    const resolve = (slug: string, tokenIdentifier: string) =>
      t.query(internal.mcp.access.resolveViewer, { slug, tokenIdentifier });

    expect(await resolve("alpha", people.ana)).toMatchObject({ ok: true, viewer: { tokenIdentifier: people.ana, orgId: ORG_A }, slug: "alpha", role: "viewer", enabled: true, conversationTools: false });
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
  const verify = (authorization: string | null) => verifyAccessToken(authorization, RESOURCE);

  test("accepts an OAuth token from an allowed client", async () => {
    const sign = await signer();
    const check = await verify(`Bearer ${await sign({ client_id: CLIENT, scope: "profile email" })}`);
    expect(check).toMatchObject({ ok: true, token: { clerkUserId: "user_ana", clientId: CLIENT, scopes: ["profile", "email"], format: "jwt" } });
  });

  test("refuses session tokens, other clients, other issuers and a missing allowlist", async () => {
    const sign = await signer();
    expect(await verify(`Bearer ${await sign({ sid: "sess_1", azp: CLIENT })}`)).toMatchObject({ ok: false, reason: expect.stringMatching(/session token/) });
    expect(await verify(`Bearer ${await sign({ aud: "convex", client_id: CLIENT })}`)).toMatchObject({ ok: false });
    expect(await verify(`Bearer ${await sign({ client_id: "someone_else" })}`)).toMatchObject({ ok: false, reason: "OAuth client is not allowed" });
    expect(await verify(`Bearer ${await sign({ client_id: CLIENT }, "https://evil.test")}`)).toMatchObject({ ok: false });
    expect(await verify(null)).toMatchObject({ ok: false, reason: "no bearer token" });
    delete process.env.FABRIC_MCP_CLIENT_IDS;
    expect(await verify(`Bearer ${await sign({ client_id: CLIENT })}`)).toMatchObject({ ok: false, reason: "OAuth client is not allowed" });
  });

  test("checks the audience against the URL called, enforcing it only when switched on", async () => {
    const sign = await signer();
    const token = (aud?: string) => sign({ client_id: CLIENT, ...(aud ? { aud } : {}) });
    expect(await verify(`Bearer ${await token(RESOURCE)}`)).toMatchObject({ ok: true, token: { audience: "match" } });
    expect(await verify(`Bearer ${await token()}`)).toMatchObject({ ok: true, token: { audience: "absent" } });
    // Log-only by default: a token issued for another workspace's URL still passes, but is flagged.
    expect(await verify(`Bearer ${await token("https://spike.convex.site/mcp/beta")}`)).toMatchObject({
      ok: true,
      token: { audience: "mismatch", audienceSeen: ["https://spike.convex.site/mcp/beta"] },
    });
    process.env.FABRIC_MCP_ENFORCE_AUDIENCE = "true";
    try {
      expect(await verify(`Bearer ${await token(RESOURCE)}`)).toMatchObject({ ok: true });
      expect(await verify(`Bearer ${await token("https://spike.convex.site/mcp/beta")}`)).toMatchObject({ ok: false, reason: "audience mismatch" });
      expect(await verify(`Bearer ${await token()}`)).toMatchObject({ ok: false, reason: "audience absent" });
      // The server-wide audience (a confidential app's fixed audience_uri) is accepted when the server passes it.
      expect(await verifyAccessToken(`Bearer ${await token("https://spike.convex.site/mcp")}`, RESOURCE, "https://spike.convex.site/mcp")).toMatchObject({ ok: true, token: { audience: "match" } });
      expect(await verifyAccessToken(`Bearer ${await token("https://elsewhere.test/mcp")}`, RESOURCE, "https://spike.convex.site/mcp")).toMatchObject({ ok: false, reason: "audience mismatch" });
      // A listed confidential client may send no audience, but a wrong one is still refused.
      process.env.FABRIC_MCP_AUDIENCE_OPTIONAL_CLIENTS = CLIENT;
      expect(await verify(`Bearer ${await token()}`)).toMatchObject({ ok: true, token: { audience: "absent" } });
      expect(await verify(`Bearer ${await token("https://spike.convex.site/mcp/beta")}`)).toMatchObject({ ok: false, reason: "audience mismatch" });
    } finally {
      delete process.env.FABRIC_MCP_ENFORCE_AUDIENCE;
      delete process.env.FABRIC_MCP_AUDIENCE_OPTIONAL_CLIENTS;
    }
  });
});

describe("HTTP", () => {
  test("challenges an unauthenticated request with the resource metadata URL", async () => {
    const t = setup();
    const response = await t.fetch("/mcp/alpha", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Bearer resource_metadata="https://spike.convex.site/.well-known/oauth-protected-resource/mcp/alpha", scope="profile email"',
    );
  });

  test("serves protected resource metadata for the workspace URL", async () => {
    const t = setup();
    const response = await t.fetch("/.well-known/oauth-protected-resource/mcp/alpha", { method: "GET" });
    expect(await response.json()).toMatchObject({ resource: "https://spike.convex.site/mcp/alpha", authorization_servers: [ISSUER] });
  });

  test("there is no picker: bare /mcp is not an endpoint (M13)", async () => {
    const t = setup();
    expect((await t.fetch("/mcp", { method: "POST", body: "{}" })).status).toBe(404);
    expect((await t.fetch("/.well-known/oauth-protected-resource/mcp", { method: "GET" })).status).toBe(404);
    // OAuth paths a client guesses on our host are never workspaces.
    expect((await t.fetch("/mcp/register", { method: "POST", body: "{}" })).status).toBe(404);
  });

  test("routes signed-in calls by the workspace in the URL, and only for its members", async () => {
    const t = setup();
    await t.run(seed);
    const sign = await signerFor();
    const listTools = async (path: string) =>
      t.fetch(path, {
        method: "POST",
        headers: { Authorization: `Bearer ${await sign({ client_id: CLIENT }, ISSUER, "ana")}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
    expect((await listTools("/mcp/alpha")).status).toBe(200);
    // Beta exists, but Ana isn't a member: the same 404 as an unknown workspace.
    expect((await listTools("/mcp/beta")).status).toBe(404);
    expect((await listTools("/mcp/nope")).status).toBe(404);
  });

  test("a member of a workspace with MCP off is refused at connection", async () => {
    const t = setup();
    await t.run(seed);
    const sign = await signerFor();
    const token = await sign({ client_id: CLIENT }, ISSUER, "bob");
    const post = (body: unknown) =>
      t.fetch("/mcp/beta", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const listed = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(listed.status).toBe(403);
    expect((await listed.json()).error.message).toMatch(/isn't turned on for this Fabric workspace/);
    expect((await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "getCoverage", arguments: {} } })).status).toBe(403);
  });

  test("uses the public URL for metadata and challenges when set", async () => {
    process.env.FABRIC_MCP_PUBLIC_URL = "https://mcp.example.test/";
    try {
      const t = setup();
      const metadata = await (await t.fetch("/.well-known/oauth-protected-resource/mcp/alpha", { method: "GET" })).json();
      expect(metadata.resource).toBe("https://mcp.example.test/mcp/alpha");
      const challenge = await t.fetch("/mcp/alpha", { method: "POST", body: "{}" });
      expect(challenge.headers.get("WWW-Authenticate")).toContain('resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp/alpha"');
    } finally {
      delete process.env.FABRIC_MCP_PUBLIC_URL;
    }
  });

  test("getWorkspaceContents returns the whole tree with ids in one call", async () => {
    const t = setup();
    await t.run(async (ctx: MutationCtx) => {
      await seed(ctx);
      const functionId = await ctx.db.insert("functions", { name: "Finance", sortOrder: 0, clerkOrgId: ORG_A });
      const departmentId = await ctx.db.insert("departments", { name: "Payables", functionId, sortOrder: 0, clerkOrgId: ORG_A });
      await ctx.db.insert("processes", { name: "Invoice approval", departmentId, sortOrder: 0, clerkOrgId: ORG_A });
      // Another tenant's structure must never appear.
      const other = await ctx.db.insert("functions", { name: "Beta secret", sortOrder: 0, clerkOrgId: ORG_B });
      await ctx.db.insert("departments", { name: "Beta dept", functionId: other, sortOrder: 0, clerkOrgId: ORG_B });
    });
    const sign = await signerFor();
    const response = await t.fetch("/mcp/alpha", {
      method: "POST",
      headers: { Authorization: `Bearer ${await sign({ client_id: CLIENT }, ISSUER, "ana")}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "getWorkspaceContents", arguments: {} } }),
    });
    const text: string = (await response.json()).result.content[0].text;
    expect(text).toMatch(/Function: Finance \[/);
    expect(text).toMatch(/Department: Payables \[/);
    expect(text).toMatch(/Process: Invoice approval \[/);
    expect(text).not.toContain("Beta");
  });

  test("records every tool call for audit and metering, without its content", async () => {
    const t = setup();
    await t.run(seed);
    const sign = await signerFor();
    const token = await sign({ client_id: CLIENT }, ISSUER, "ana");
    const callTool = (name: string, args: Record<string, unknown>) =>
      t.fetch("/mcp/alpha", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      });
    await callTool("getWorkspaceContents", {});
    await callTool("getOverview", { nonsense: true });
    const rows = await t.run(async (ctx) => await ctx.db.query("mcpCalls").collect());
    expect(rows.map((row) => [row.tool, row.outcome, row.clientId, row.clerkOrgId])).toEqual([
      ["getWorkspaceContents", "ok", CLIENT, ORG_A],
      ["getOverview", "badArguments", CLIENT, ORG_A],
    ]);
    expect(rows.every((row) => row.userId !== undefined)).toBe(true);
    expect(Object.keys(rows[0]).sort()).toEqual(
      ["_creationTime", "_id", "clerkOrgId", "clientId", "createdAt", "latencyMs", "outcome", "resultCount", "tool", "truncated", "userId"],
    );
  });

  test("a call with only the required inputs runs, with placeholders filled in", async () => {
    const t = setup();
    await t.run(seed);
    const sign = await signerFor();
    const response = await t.fetch("/mcp/alpha", {
      method: "POST",
      headers: { Authorization: `Bearer ${await sign({ client_id: CLIENT }, ISSUER, "ana")}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "getCoverage", arguments: {} } }),
    });
    const result = (await response.json()).result;
    expect(result.isError).toBe(false);
  });

  test("rate-limits a user's tool calls and says when to retry", async () => {
    const t = setup();
    await t.run(seed);
    const sign = await signerFor();
    const token = await sign({ client_id: CLIENT }, ISSUER, "ana");
    const call = async () =>
      (
        await t.fetch("/mcp/alpha", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "getWorkspaceContents", arguments: {} } }),
        })
      ).json();
    for (let i = 0; i < 60; i++) expect((await call()).result.isError).toBe(false);
    const limited = await call();
    expect(limited.result.isError).toBe(true);
    expect(limited.result.content[0].text).toMatch(/rate limit reached for your requests\. Wait \d+ seconds/);
  });

  test("refuses browser origins and GET", async () => {
    const t = setup();
    expect((await t.fetch("/mcp/alpha", { method: "POST", headers: { Origin: "https://evil.test" }, body: "{}" })).status).toBe(403);
    expect((await t.fetch("/mcp/alpha", { method: "GET" })).status).toBe(405);
  });
});

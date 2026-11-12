import type { HttpRouter } from "convex/server";
import { env, httpAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { authErrorCode } from "../lib/authErrors";
import type { AskToolResult } from "../askTools/results";
import { checkRateLimit } from "./limits";
import { mcpIssuer, tokenIdentifierFor, verifyAccessToken, type VerifiedToken } from "./auth";
import {
  ERRORS,
  SUPPORTED_VERSIONS,
  detectEra,
  discoverResult,
  finishResult,
  headerMismatch,
  initializeResult,
  isNotification,
  parseMessage,
  rpcError,
  type Era,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol";
import { getMcpTool, sourcesIn, toMcpContent, toolListEntries } from "./tools";

/**
 * Fabric MCP server routes (docs/fabric-mcp-server-feasibility.md).
 *
 *   POST /mcp/<slug>                                      one workspace's endpoint
 *   POST /mcp                                             the picker: the workspace chosen at sign-in (M8)
 *   GET  /.well-known/oauth-protected-resource/mcp[/<slug>]   RFC 9728 metadata
 *   GET  /.well-known/oauth-authorization-server          Clerk's metadata, for 2025-03-26 clients
 *
 * The endpoint is stateless: every request is authorized and resolved on its
 * own, and JSON responses only (no SSE), which every revision allows. URLs are
 * built from FABRIC_MCP_PUBLIC_URL (M11), falling back to the Convex site URL.
 */

const MCP_PREFIX = "/mcp/";
const PRM_PREFIX = "/.well-known/oauth-protected-resource/mcp/";
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

function siteUrl(): string {
  return (env.FABRIC_MCP_PUBLIC_URL?.trim() || env.CONVEX_SITE_URL || "").replace(/\/+$/, "");
}

/**
 * Which workspace a URL names (M8): `/mcp/<slug>` names one; bare `/mcp` is
 * the picker, where the workspace comes from the org chosen at sign-in.
 */
type Target = { kind: "slug"; slug: string } | { kind: "picker" };

const PICKER_SCOPES = ["profile", "email", "user:org:read"];
const SLUG_SCOPES = ["profile", "email"];

function targetAfter(pathname: string, prefix: string): Target | null {
  const base = prefix.replace(/\/$/, "");
  const trimmed = pathname.replace(/\/+$/, "");
  if (trimmed === base) return { kind: "picker" };
  const rest = trimmed.slice(prefix.length).toLowerCase();
  return pathname.startsWith(prefix) && SLUG.test(rest) ? { kind: "slug", slug: rest } : null;
}

function suffix(target: Target): string {
  return target.kind === "slug" ? `/${target.slug}` : "";
}

function resourceUrl(target: Target): string {
  return `${siteUrl()}/mcp${suffix(target)}`;
}

function metadataUrl(target: Target): string {
  return `${siteUrl()}/.well-known/oauth-protected-resource/mcp${suffix(target)}`;
}

function scopesFor(target: Target): string[] {
  return target.kind === "picker" ? PICKER_SCOPES : SLUG_SCOPES;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function unauthorized(target: Target, invalid: boolean): Response {
  const challenge = [
    `Bearer resource_metadata="${metadataUrl(target)}"`,
    `scope="${scopesFor(target).join(" ")}"`,
    invalid ? `error="invalid_token"` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return json(rpcError(null, ERRORS.invalidRequest, "Sign in to Fabric to use this server"), 401, { "WWW-Authenticate": challenge });
}

const MCP_OFF_MESSAGE =
  "MCP access isn't turned on for this Fabric workspace, so no Fabric data is available here. Ask your Fabric admin to enable it, or reconnect and pick a different workspace.";

function log(event: string, fields: Record<string, unknown>): void {
  // Ids and outcomes only, never tool input or output. Phase 3 replaces the
  // call log with the mcpCalls audit table.
  console.log(JSON.stringify({ mcp: event, ...fields }));
}

/** Names the keys a tool call got wrong, without echoing values back. */
function argumentProblem(schema: Record<string, unknown>, args: Record<string, unknown>): string | null {
  const properties = Object.keys((schema.properties ?? {}) as Record<string, unknown>);
  const required = (schema.required ?? []) as string[];
  const missing = required.filter((key) => !(key in args));
  const unexpected = Object.keys(args).filter((key) => !properties.includes(key));
  if (missing.length === 0 && unexpected.length === 0) return null;
  return [
    missing.length ? `missing: ${missing.join(", ")}` : null,
    unexpected.length ? `not accepted: ${unexpected.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("; ");
}

type CallContext = {
  ctx: ActionCtx;
  slug: string;
  viewer: { tokenIdentifier: string; orgId: string };
  token: VerifiedToken;
};

async function callTool(call: CallContext, era: Era, message: JsonRpcRequest): Promise<JsonRpcResponse> {
  const id = message.id ?? null;
  const name = typeof message.params?.name === "string" ? message.params.name : "";
  const tool = getMcpTool(name);
  if (!tool) return rpcError(id, ERRORS.invalidParams, `Unknown tool: ${name}`);
  const rawArgs = message.params?.arguments ?? {};
  if (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs)) {
    return rpcError(id, ERRORS.invalidParams, "Tool arguments must be an object");
  }
  const args = rawArgs as Record<string, unknown>;
  const problem = argumentProblem(tool.inputSchema, args);
  if (problem) {
    log("tool_bad_arguments", { tool: name, problem, client: call.token.clientId, org: call.viewer.orgId });
    return { jsonrpc: "2.0", id, result: finishResult(era, { content: [{ type: "text", text: `Invalid arguments for ${name} (${problem}).` }], isError: true }) };
  }

  const limit = await checkRateLimit(call.ctx, { tokenIdentifier: call.viewer.tokenIdentifier, orgId: call.viewer.orgId });
  if (!limit.ok) {
    log("rate_limited", { tool: name, scope: limit.scope, org: call.viewer.orgId, client: call.token.clientId });
    const seconds = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
    const who = limit.scope === "user" ? "your" : "this workspace's";
    return {
      jsonrpc: "2.0",
      id,
      result: finishResult(era, { content: [{ type: "text", text: `Fabric rate limit reached for ${who} requests. Wait ${seconds} seconds, then try again with fewer calls.` }], isError: true }),
    };
  }

  const startedAt = Date.now();
  let result: AskToolResult;
  try {
    // The viewer comes last so a client can never supply its own.
    result = await call.ctx.runQuery(tool.executorRef, { ...args, viewer: call.viewer });
  } catch (error) {
    if (authErrorCode(error)) return rpcError(id, ERRORS.invalidRequest, "You no longer have access to this Fabric workspace");
    log("tool_error", { tool: name, client: call.token.clientId, org: call.viewer.orgId });
    return { jsonrpc: "2.0", id, result: finishResult(era, { content: [{ type: "text", text: `${name} failed. Check the argument values against the tool's schema.` }], isError: true }) };
  }
  const sources = sourcesIn(result);
  const links = sources.length
    ? await call.ctx.runQuery(internal.mcp.access.citationLinks, { viewer: call.viewer, slug: call.slug, sources })
    : [];
  const content = toMcpContent(result, new Map(links.map((link) => [link.source, link.href])));
  log("tools/call", {
    tool: name,
    org: call.viewer.orgId,
    user: call.token.clerkUserId,
    client: call.token.clientId,
    found: result.found,
    results: result.found ? result.resultCount : 0,
    truncated: result.found ? result.truncated : false,
    latencyMs: Date.now() - startedAt,
  });
  return { jsonrpc: "2.0", id, result: finishResult(era, { content, isError: false }) };
}

async function handlePost(ctx: ActionCtx, req: Request): Promise<Response> {
  const target = targetAfter(new URL(req.url).pathname, MCP_PREFIX);
  if (!target) return json(rpcError(null, ERRORS.invalidRequest, "Unknown workspace"), 404);

  // Browsers are not MCP clients here: any request carrying an Origin is refused,
  // which closes DNS-rebinding and cross-site form posts.
  if (req.headers.get("Origin")) return json(rpcError(null, ERRORS.invalidRequest, "Origin not allowed"), 403);

  const check = await verifyAccessToken(req.headers.get("Authorization"), resourceUrl(target));
  if (!check.ok) {
    log("auth_rejected", { reason: check.reason });
    return unauthorized(target, check.reason !== "no bearer token");
  }
  const tokenIdentifier = tokenIdentifierFor(check.token.clerkUserId);
  if (!tokenIdentifier) return json(rpcError(null, ERRORS.internal, "Server is not configured"), 500);

  const pickedOrg = check.token.orgId;
  if (target.kind === "picker" && !pickedOrg) {
    // A picker token must name the workspace chosen at sign-in.
    log("viewer_rejected", { reason: "NO_WORKSPACE_PICKED", client: check.token.clientId });
    return unauthorized(target, true);
  }
  const lookup = await ctx.runQuery(internal.mcp.access.resolveViewer, {
    workspace: target.kind === "slug" ? { slug: target.slug } : { clerkOrgId: pickedOrg! },
    tokenIdentifier,
  });
  if (lookup.ok && pickedOrg && lookup.viewer.orgId !== pickedOrg) {
    // A token issued for one workspace is never used against another (M8).
    log("viewer_rejected", { reason: "WORKSPACE_MISMATCH", client: check.token.clientId });
    return json(rpcError(null, ERRORS.invalidRequest, "This sign-in was for a different Fabric workspace"), 403);
  }
  if (!lookup.ok) {
    log("viewer_rejected", { reason: lookup.reason, client: check.token.clientId });
    return json(rpcError(null, ERRORS.invalidRequest, "Unknown workspace"), lookup.status);
  }
  if (!lookup.enabled) {
    // Refused at connection, so a workspace without MCP never looks connected.
    // Clients show their own wording for a 403; the help docs explain it.
    log("viewer_rejected", { reason: "MCP_OFF", org: lookup.viewer.orgId, client: check.token.clientId });
    return json(rpcError(null, ERRORS.invalidRequest, MCP_OFF_MESSAGE), 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(rpcError(null, ERRORS.parse, "Body is not JSON"), 400);
  }
  const message = parseMessage(body);
  if (!message) return json(rpcError(null, ERRORS.invalidRequest, "Not a JSON-RPC 2.0 request"), 400);

  const era = detectEra(message, req.headers.get("MCP-Protocol-Version"));
  if (era.kind === "unsupported") {
    return json(
      rpcError(message.id ?? null, ERRORS.unsupportedVersion, "Unsupported protocol version", { supported: SUPPORTED_VERSIONS, requested: era.requested }),
      400,
    );
  }
  const mismatch = headerMismatch(message, era, {
    version: req.headers.get("MCP-Protocol-Version"),
    method: req.headers.get("Mcp-Method"),
    name: req.headers.get("Mcp-Name"),
  });
  if (mismatch) return json(rpcError(message.id ?? null, ERRORS.headerMismatch, mismatch), 400);

  if (isNotification(message)) return new Response(null, { status: 202 });
  const id = message.id ?? null;
  log("request", {
    method: message.method,
    era: era.kind,
    version: era.version,
    client: check.token.clientId,
    audience: check.token.audience,
    ...(check.token.audienceSeen ? { audienceSeen: check.token.audienceSeen } : {}),
  });

  switch (message.method) {
    case "initialize":
      return json({ jsonrpc: "2.0", id, result: initializeResult(era.version) });
    case "ping":
      return json({ jsonrpc: "2.0", id, result: {} });
    case "server/discover":
      return json({ jsonrpc: "2.0", id, result: finishResult(era, discoverResult(), true) });
    case "tools/list":
      return json({ jsonrpc: "2.0", id, result: finishResult(era, { tools: toolListEntries() }, true) });
    case "tools/call":
      return json(await callTool({ ctx, slug: lookup.slug, viewer: lookup.viewer, token: check.token }, era, message));
    default:
      return json(rpcError(id, ERRORS.methodNotFound, `Method not supported: ${message.method}`));
  }
}

function protectedResourceMetadata(req: Request): Response {
  const target = targetAfter(new URL(req.url).pathname, PRM_PREFIX);
  const issuer = mcpIssuer();
  if (!target || !issuer) return json({ error: "not_found" }, 404);
  return json({
    resource: resourceUrl(target),
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: scopesFor(target),
    resource_name: "Fabric",
  }, 200, { "Cache-Control": "public, max-age=300" });
}

/** For clients that look for authorization server metadata on the resource's own host. */
async function authorizationServerMetadata(): Promise<Response> {
  const issuer = mcpIssuer();
  if (!issuer) return json({ error: "not_found" }, 404);
  const upstream = await fetch(`${issuer}/.well-known/oauth-authorization-server`);
  if (!upstream.ok) return json({ error: "unavailable" }, 502);
  return json(await upstream.json(), 200, { "Cache-Control": "public, max-age=300" });
}

export function registerMcpRoutes(http: HttpRouter): void {
  const notAllowed = httpAction(async () => new Response(null, { status: 405, headers: { Allow: "POST" } }));
  const metadata = httpAction(async (_ctx, req) => protectedResourceMetadata(req));
  // `/mcp` (the picker) and `/mcp/<slug>` (one workspace) share one handler.
  for (const route of [{ path: "/mcp" }, { pathPrefix: MCP_PREFIX }]) {
    http.route({ ...route, method: "POST", handler: httpAction(handlePost) });
    http.route({ ...route, method: "GET", handler: notAllowed });
    http.route({ ...route, method: "DELETE", handler: notAllowed });
  }
  http.route({ path: "/.well-known/oauth-protected-resource/mcp", method: "GET", handler: metadata });
  http.route({ pathPrefix: PRM_PREFIX, method: "GET", handler: metadata });
  http.route({ path: "/.well-known/oauth-authorization-server", method: "GET", handler: httpAction(authorizationServerMetadata) });
  http.route({ pathPrefix: "/.well-known/oauth-authorization-server/", method: "GET", handler: httpAction(authorizationServerMetadata) });
}

import type { HttpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { authErrorCode } from "../lib/authErrors";
import type { AskToolResult } from "../askTools/results";
import type { Id } from "../_generated/dataModel";
import { checkRateLimit } from "./limits";
import { mcpBaseUrl } from "./urls";
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
 *   POST /mcp/<slug>                                      one workspace's endpoint (M13: one URL per workspace)
 *   GET  /.well-known/oauth-protected-resource/mcp/<slug>  RFC 9728 metadata
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
  return mcpBaseUrl();
}

/** The workspace a URL names: `/mcp/<slug>`. There is no picker URL (M13). */
type Target = { slug: string };

const SCOPES = ["profile", "email"];

/**
 * OAuth endpoint names a 2025-03-26 client guesses on the MCP host when the
 * authorization server advertises none (e.g. `/register` without dynamic
 * client registration). They are never workspaces, so they get a 404, not a
 * misleading sign-in challenge.
 */
const RESERVED = new Set(["register", "authorize", "token", "oauth", "callback"]);

function targetAfter(pathname: string, prefix: string): Target | null {
  const rest = pathname.replace(/\/+$/, "").slice(prefix.length).toLowerCase();
  return pathname.startsWith(prefix) && SLUG.test(rest) && !RESERVED.has(rest) ? { slug: rest } : null;
}

function resourceUrl(target: Target): string {
  return `${siteUrl()}/mcp/${target.slug}`;
}

function metadataUrl(target: Target): string {
  return `${siteUrl()}/.well-known/oauth-protected-resource/mcp/${target.slug}`;
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
    `scope="${SCOPES.join(" ")}"`,
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
  userId: Id<"users">;
  token: VerifiedToken;
  conversationTools: boolean;
};

type CallOutcome = "ok" | "notFound" | "error" | "badArguments" | "rateLimited";

/** The audit and metering row for one tool call (Phase 3). Never the input or output. */
async function recordCall(
  call: CallContext,
  tool: string,
  outcome: CallOutcome,
  detail: { resultCount?: number; truncated?: boolean; latencyMs?: number } = {},
): Promise<void> {
  try {
    await call.ctx.runMutation(internal.mcpUsage.record, {
      clerkOrgId: call.viewer.orgId,
      userId: call.userId,
      clientId: call.token.clientId.slice(0, 200),
      tool: tool.slice(0, 64) || "(none)",
      outcome,
      resultCount: detail.resultCount ?? 0,
      truncated: detail.truncated ?? false,
      latencyMs: detail.latencyMs ?? 0,
    });
  } catch (error) {
    // Metering must never fail the call it records.
    console.error("MCP call record failed", { tool, outcome, error: (error as Error).message });
  }
}

async function callTool(call: CallContext, era: Era, message: JsonRpcRequest): Promise<JsonRpcResponse> {
  const id = message.id ?? null;
  const name = typeof message.params?.name === "string" ? message.params.name : "";
  const tool = getMcpTool(name, { conversationTools: call.conversationTools });
  if (!tool) {
    await recordCall(call, name, "badArguments");
    return rpcError(id, ERRORS.invalidParams, `Unknown tool: ${name}`);
  }
  const rawArgs = message.params?.arguments ?? {};
  if (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs)) {
    await recordCall(call, name, "badArguments");
    return rpcError(id, ERRORS.invalidParams, "Tool arguments must be an object");
  }
  // Optional fields the client left out take their documented placeholders.
  const args = { ...tool.defaults, ...(rawArgs as Record<string, unknown>) };
  const problem = argumentProblem(tool.inputSchema, args);
  if (problem) {
    await recordCall(call, name, "badArguments");
    return { jsonrpc: "2.0", id, result: finishResult(era, { content: [{ type: "text", text: `Invalid arguments for ${name} (${problem}).` }], isError: true }) };
  }

  const limit = await checkRateLimit(call.ctx, { tokenIdentifier: call.viewer.tokenIdentifier, orgId: call.viewer.orgId });
  if (!limit.ok) {
    log("rate_limited", { tool: name, scope: limit.scope, org: call.viewer.orgId, client: call.token.clientId });
    await recordCall(call, name, "rateLimited");
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
    await recordCall(call, name, "error", { latencyMs: Date.now() - startedAt });
    return { jsonrpc: "2.0", id, result: finishResult(era, { content: [{ type: "text", text: `${name} failed. Check the argument values against the tool's schema.` }], isError: true }) };
  }
  const sources = sourcesIn(result);
  const links = sources.length
    ? await call.ctx.runQuery(internal.mcp.access.citationLinks, { viewer: call.viewer, slug: call.slug, sources })
    : [];
  const content = toMcpContent(result, new Map(links.map((link) => [link.source, link.href])));
  await recordCall(call, name, result.found ? "ok" : "notFound", {
    resultCount: result.found ? result.resultCount : 0,
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

  const check = await verifyAccessToken(
    req.headers.get("Authorization"),
    resourceUrl(target),
    `${siteUrl()}/mcp`,
    (clientId) => ctx.runQuery(internal.mcpClients.workspaceClientFor, { clientId }),
  );
  if (!check.ok) {
    log("auth_rejected", { reason: check.reason, ...(check.detail ? { detail: check.detail } : {}) });
    return unauthorized(target, check.reason !== "no bearer token");
  }
  const tokenIdentifier = tokenIdentifierFor(check.token.clerkUserId);
  if (!tokenIdentifier) return json(rpcError(null, ERRORS.internal, "Server is not configured"), 500);

  const lookup = await ctx.runQuery(internal.mcp.access.resolveViewer, { slug: target.slug, tokenIdentifier });
  if (!lookup.ok) {
    log("viewer_rejected", { reason: lookup.reason, client: check.token.clientId });
    return json(rpcError(null, ERRORS.invalidRequest, "Unknown workspace"), lookup.status);
  }
  if (check.token.workspaceClientOrgId && check.token.workspaceClientOrgId !== lookup.viewer.orgId) {
    // A workspace's Copilot Studio credentials work only for that workspace (B7).
    log("viewer_rejected", { reason: "WORKSPACE_CLIENT_MISMATCH", client: check.token.clientId });
    return json(rpcError(null, ERRORS.invalidRequest, "These credentials belong to a different Fabric workspace"), 403);
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
      return json({ jsonrpc: "2.0", id, result: finishResult(era, { tools: toolListEntries({ conversationTools: lookup.conversationTools }) }, true) });
    case "tools/call":
      return json(await callTool({ ctx, slug: lookup.slug, viewer: lookup.viewer, userId: lookup.userId, token: check.token, conversationTools: lookup.conversationTools }, era, message));
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
    scopes_supported: SCOPES,
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
  http.route({ pathPrefix: MCP_PREFIX, method: "POST", handler: httpAction(handlePost) });
  http.route({ pathPrefix: MCP_PREFIX, method: "GET", handler: notAllowed });
  http.route({ pathPrefix: MCP_PREFIX, method: "DELETE", handler: notAllowed });
  http.route({ pathPrefix: PRM_PREFIX, method: "GET", handler: metadata });
  http.route({ path: "/.well-known/oauth-authorization-server", method: "GET", handler: httpAction(authorizationServerMetadata) });
  http.route({ pathPrefix: "/.well-known/oauth-authorization-server/", method: "GET", handler: httpAction(authorizationServerMetadata) });
}

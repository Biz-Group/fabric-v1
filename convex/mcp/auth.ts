import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "../_generated/server";
import { clerkFetch } from "../lib/clerkApi";

/**
 * Bearer-token verification for the Fabric MCP server.
 *
 * MCP clients present a Clerk OAuth access token. We verify it here rather
 * than adding Clerk's OAuth issuer to `auth.config.ts`: that would make an
 * MCP token a valid Convex identity for every `requireAuth` function, not
 * just these read-only tools.
 *
 * Clerk issues JWT or opaque access tokens depending on the instance setting
 * (`oauth_jwt_access_tokens`), so both are accepted. JWTs are checked locally
 * and stay valid until they expire (24 hours, not configurable); membership,
 * the tenant switch and the kill switch are checked on every call instead.
 * Clerk session tokens share the issuer and are always refused.
 *
 * Binding: tokens must come from an allowlisted OAuth client
 * (`FABRIC_MCP_CLIENT_IDS`, fails closed). With Clerk's `aud_claim_enabled`,
 * a token also names the resource it was issued for; that must be the URL the
 * client called. `FABRIC_MCP_ENFORCE_AUDIENCE=true` makes that mandatory;
 * otherwise a missing or different audience is only reported for logging.
 */

export type AudienceCheck = "match" | "absent" | "mismatch";

export type VerifiedToken = {
  clerkUserId: string;
  clientId: string;
  scopes: string[];
  format: "jwt" | "opaque";
  audience: AudienceCheck;
  /** The token's audience values, kept only when they don't match (they are URLs, not personal data). */
  audienceSeen?: string[];
  /**
   * Set when the client is a workspace's own Copilot Studio client (B7): its
   * tokens are valid only for that workspace's URL.
   */
  workspaceClientOrgId?: string;
  /** When the token was issued (epoch seconds) and its claim names: diagnostics for refusals. */
  issuedAt?: number;
  claimNames?: string[];
};

export type TokenCheck =
  | { ok: true; token: VerifiedToken }
  | { ok: false; reason: string; detail?: { clientId: string; issuedAt: string | null; claimNames: string[] } };

let jwks: { issuer: string; set: ReturnType<typeof createRemoteJWKSet> } | null = null;

/** Tests sign with a fresh key each time; this drops the cached key set. */
export function resetJwksCache(): void {
  jwks = null;
}

export function mcpIssuer(): string | null {
  const domain = process.env.CLERK_JWT_ISSUER_DOMAIN?.trim().replace(/\/+$/, "");
  return domain ? domain : null;
}

function allowedClientIds(): Set<string> | null {
  const raw = env.FABRIC_MCP_CLIENT_IDS?.trim();
  if (!raw) return null;
  return new Set(raw.split(",").map((id: string) => id.trim()).filter(Boolean));
}

function audienceOptionalClients(): Set<string> {
  const raw = env.FABRIC_MCP_AUDIENCE_OPTIONAL_CLIENTS?.trim() ?? "";
  return new Set(raw.split(",").map((id: string) => id.trim()).filter(Boolean));
}

function enforceAudience(): boolean {
  return env.FABRIC_MCP_ENFORCE_AUDIENCE?.trim().toLowerCase() === "true";
}

function scopesOf(payload: JWTPayload): string[] {
  if (typeof payload.scope === "string") return payload.scope.split(" ").filter(Boolean);
  if (Array.isArray(payload.scp)) return payload.scp.filter((s): s is string => typeof s === "string");
  return [];
}

/**
 * A token's audience must name this server: either the exact workspace URL
 * the client called (what Clerk sets from the client's RFC 8707 `resource`,
 * as Claude sends), or the server-wide audience `<base>/mcp` (a confidential
 * Clerk app's fixed `audience_uri`, for clients that send no `resource`, such
 * as Copilot Studio's manual OAuth). Either way the workspace is still
 * checked by membership on every call.
 */
function checkAudience(audiences: string[], accepted: readonly string[]): AudienceCheck {
  if (audiences.length === 0) return "absent";
  return audiences.some((aud) => accepted.includes(aud)) ? "match" : "mismatch";
}

async function verifyJwt(token: string, iss: string, accepted: readonly string[]): Promise<TokenCheck> {
  if (!jwks || jwks.issuer !== iss) {
    jwks = { issuer: iss, set: createRemoteJWKSet(new URL(`${iss}/.well-known/jwks.json`)) };
  }
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, jwks.set, { issuer: iss, algorithms: ["RS256"] }));
  } catch (error) {
    return { ok: false, reason: `jwt rejected: ${(error as Error).name}` };
  }
  const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  // A Clerk session token (or a `convex` template token) is not an OAuth grant.
  if ("sid" in payload || audiences.includes("convex")) return { ok: false, reason: "session token, not an OAuth access token" };
  const clientId = typeof payload.client_id === "string" ? payload.client_id : null;
  if (!clientId) return { ok: false, reason: "no client_id claim" };
  if (!payload.sub) return { ok: false, reason: "no subject" };
  const audience = checkAudience(audiences, accepted);
  return {
    ok: true,
    token: {
      clerkUserId: payload.sub,
      clientId,
      scopes: scopesOf(payload),
      format: "jwt",
      audience,
      ...(audience === "mismatch" ? { audienceSeen: audiences } : {}),
      issuedAt: typeof payload.iat === "number" ? payload.iat : undefined,
      claimNames: Object.keys(payload).sort(),
    },
  };
}

type OpaqueVerifyResponse = {
  subject?: string;
  client_id?: string;
  scopes?: string[];
  revoked?: boolean;
  expired?: boolean;
};

async function verifyOpaque(token: string): Promise<TokenCheck> {
  let response: OpaqueVerifyResponse;
  try {
    response = (await clerkFetch("/oauth_applications/access_tokens/verify", {
      method: "POST",
      body: { access_token: token },
    })) as OpaqueVerifyResponse;
  } catch {
    return { ok: false, reason: "opaque token rejected by Clerk" };
  }
  if (!response || response.revoked || response.expired) return { ok: false, reason: "token revoked or expired" };
  if (!response.subject || !response.client_id) return { ok: false, reason: "verify response missing subject or client" };
  return {
    ok: true,
    token: {
      clerkUserId: response.subject,
      clientId: response.client_id,
      scopes: response.scopes ?? [],
      format: "opaque",
      audience: "absent",
    },
  };
}

/**
 * Verifies the bearer token for a request to `resource` (the URL the client
 * called). `serverAudience` is the server-wide audience, `<base>/mcp`.
 */
export async function verifyAccessToken(
  authorization: string | null,
  resource: string,
  serverAudience?: string,
  /** Finds a workspace's own OAuth client (mcpClients.workspaceClientFor). */
  lookupWorkspaceClient?: (clientId: string) => Promise<{ clerkOrgId: string } | null>,
): Promise<TokenCheck> {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) return { ok: false, reason: "no bearer token" };
  const iss = mcpIssuer();
  if (!iss) return { ok: false, reason: "CLERK_JWT_ISSUER_DOMAIN is not set" };
  const token = match[1];
  const accepted = serverAudience ? [resource, serverAudience] : [resource];
  const result = token.split(".").length === 3 ? await verifyJwt(token, iss, accepted) : await verifyOpaque(token);
  if (!result.ok) return result;
  // Admission fails closed: a client is either on the deployment's allowlist
  // (any workspace) or a workspace's own client (that workspace only).
  const allowed = allowedClientIds();
  if (!allowed?.has(result.token.clientId)) {
    const owned = lookupWorkspaceClient ? await lookupWorkspaceClient(result.token.clientId) : null;
    if (!owned) {
      // The client id is logged so a new client (e.g. an assistant's CIMD URL) can be allowlisted.
      return { ok: false, reason: "OAuth client is not allowed", detail: { clientId: result.token.clientId, issuedAt: null, claimNames: [] } };
    }
    result.token.workspaceClientOrgId = owned.clerkOrgId;
  }
  // A dedicated confidential client that sends no `resource` gets no `aud`
  // from Clerk; its secret, and for a workspace client its one workspace,
  // bind it to this server instead.
  const audienceOptional =
    result.token.audience === "absent" &&
    (result.token.workspaceClientOrgId !== undefined || audienceOptionalClients().has(result.token.clientId));
  if (enforceAudience() && result.token.audience !== "match" && !audienceOptional) {
    const { clientId, issuedAt, claimNames } = result.token;
    return {
      ok: false,
      reason: `audience ${result.token.audience}`,
      detail: { clientId, issuedAt: issuedAt ? new Date(issuedAt * 1000).toISOString() : null, claimNames: claimNames ?? [] },
    };
  }
  return result;
}

/** Convex's identity key for a Clerk user: the same one the web app stores. */
export function tokenIdentifierFor(clerkUserId: string): string | null {
  const iss = mcpIssuer();
  return iss ? `${iss}|${clerkUserId}` : null;
}

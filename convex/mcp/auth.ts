import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "../_generated/server";

/**
 * Bearer-token verification for the Fabric MCP server.
 *
 * MCP clients present a Clerk OAuth access token. We verify it here rather
 * than adding Clerk's OAuth issuer to `auth.config.ts`: that would make an
 * MCP token a valid Convex identity for every `requireAuth` function, not
 * just these read-only tools.
 *
 * Clerk issues JWT access tokens (`at+jwt`, RS256), checked locally against
 * its JWKS. They stay valid until they expire (24 hours, not configurable);
 * membership, the tenant switch and the kill switch are checked on every call
 * instead. Clerk session tokens share the issuer and are always refused.
 *
 * Binding: a token must come from an allowlisted OAuth client
 * (`FABRIC_MCP_CLIENT_IDS`, fails closed) or from a workspace's own Copilot
 * Studio client. With Clerk's `aud_claim_enabled`, a token also names the
 * resource it was issued for, which must be the URL the client called.
 * `FABRIC_MCP_ENFORCE_AUDIENCE=true` makes that mandatory; otherwise a missing
 * or different audience is only reported for logging.
 */

export type AudienceCheck = "match" | "absent" | "mismatch";

export type VerifiedToken = {
  clerkUserId: string;
  clientId: string;
  scopes: string[];
  audience: AudienceCheck;
  /** The token's audience values, kept only when they don't match (they are URLs, not personal data). */
  audienceSeen?: string[];
  /**
   * Set when the client is a workspace's own Copilot Studio client (B7): its
   * tokens are valid only for that workspace's URL.
   */
  workspaceClientOrgId?: string;
  /** When the token was issued (epoch seconds): a diagnostic for refusals. */
  issuedAt?: number;
};

export type TokenCheck =
  | { ok: true; token: VerifiedToken }
  | { ok: false; reason: string; detail?: { clientId: string; issuedAt: string | null } };

let jwks: { issuer: string; set: ReturnType<typeof createRemoteJWKSet> } | null = null;

/** Tests sign with a fresh key each time; this drops the cached key set. */
export function resetJwksCache(): void {
  jwks = null;
}

export function mcpIssuer(): string | null {
  const domain = process.env.CLERK_JWT_ISSUER_DOMAIN?.trim().replace(/\/+$/, "");
  return domain ? domain : null;
}

/** True when the deployment allowlist (FABRIC_MCP_CLIENT_IDS) names this client. */
export function isAllowlistedClient(clientId: string): boolean {
  return allowedClientIds()?.has(clientId) ?? false;
}

function allowedClientIds(): Set<string> | null {
  const raw = env.FABRIC_MCP_CLIENT_IDS?.trim();
  if (!raw) return null;
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

function isoTime(epochSeconds: number | undefined): string | null {
  return epochSeconds ? new Date(epochSeconds * 1000).toISOString() : null;
}

async function verifyJwt(token: string, iss: string, resource: string): Promise<TokenCheck> {
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
  // The audience must be the exact workspace URL called: Clerk sets it from the
  // client's RFC 8707 `resource`, as Claude sends.
  const audience: AudienceCheck = audiences.length === 0 ? "absent" : audiences.includes(resource) ? "match" : "mismatch";
  return {
    ok: true,
    token: {
      clerkUserId: payload.sub,
      clientId,
      scopes: scopesOf(payload),
      audience,
      ...(audience === "mismatch" ? { audienceSeen: audiences } : {}),
      issuedAt: typeof payload.iat === "number" ? payload.iat : undefined,
    },
  };
}

/** Verifies the bearer token for a request to `resource` (the URL the client called). */
export async function verifyAccessToken(
  authorization: string | null,
  resource: string,
  /** Finds a workspace's own OAuth client (mcpClients.workspaceClientFor). */
  lookupWorkspaceClient?: (clientId: string) => Promise<{ clerkOrgId: string } | null>,
): Promise<TokenCheck> {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) return { ok: false, reason: "no bearer token" };
  const iss = mcpIssuer();
  if (!iss) return { ok: false, reason: "CLERK_JWT_ISSUER_DOMAIN is not set" };
  const result = await verifyJwt(match[1], iss, resource);
  if (!result.ok) return result;
  const { clientId, issuedAt } = result.token;
  // Admission fails closed: a client is either on the deployment's allowlist
  // (any workspace) or a workspace's own client (that workspace only).
  if (!allowedClientIds()?.has(clientId)) {
    const owned = lookupWorkspaceClient ? await lookupWorkspaceClient(clientId) : null;
    if (!owned) {
      // The client id is logged so a new client (e.g. an assistant's CIMD URL) can be allowlisted.
      return { ok: false, reason: "OAuth client is not allowed", detail: { clientId, issuedAt: isoTime(issuedAt) } };
    }
    result.token.workspaceClientOrgId = owned.clerkOrgId;
  }
  // Copilot Studio's manual OAuth sends no `resource`, so Clerk adds no `aud`.
  // A workspace client's secret and its one workspace bind it instead.
  const audienceOptional = result.token.audience === "absent" && result.token.workspaceClientOrgId !== undefined;
  if (enforceAudience() && result.token.audience !== "match" && !audienceOptional) {
    return { ok: false, reason: `audience ${result.token.audience}`, detail: { clientId, issuedAt: isoTime(issuedAt) } };
  }
  return result;
}

/** Convex's identity key for a Clerk user: the same one the web app stores. */
export function tokenIdentifierFor(clerkUserId: string): string | null {
  const iss = mcpIssuer();
  return iss ? `${iss}|${clerkUserId}` : null;
}

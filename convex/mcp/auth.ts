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
  /** The workspace picked on the consent screen (`user:org:read`), if any. */
  orgId: string | null;
  format: "jwt" | "opaque";
  audience: AudienceCheck;
  /** The token's audience values, kept only when they don't match (they are URLs, not personal data). */
  audienceSeen?: string[];
};

export type TokenCheck = { ok: true; token: VerifiedToken } | { ok: false; reason: string };

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

function enforceAudience(): boolean {
  return env.FABRIC_MCP_ENFORCE_AUDIENCE?.trim().toLowerCase() === "true";
}

function scopesOf(payload: JWTPayload): string[] {
  if (typeof payload.scope === "string") return payload.scope.split(" ").filter(Boolean);
  if (Array.isArray(payload.scp)) return payload.scp.filter((s): s is string => typeof s === "string");
  return [];
}

function checkAudience(audiences: string[], resource: string): AudienceCheck {
  if (audiences.length === 0) return "absent";
  return audiences.includes(resource) ? "match" : "mismatch";
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
  const audience = checkAudience(audiences, resource);
  return {
    ok: true,
    token: {
      clerkUserId: payload.sub,
      clientId,
      scopes: scopesOf(payload),
      orgId: typeof payload.org_id === "string" && payload.org_id ? payload.org_id : null,
      format: "jwt",
      audience,
      ...(audience === "mismatch" ? { audienceSeen: audiences } : {}),
    },
  };
}

type OpaqueVerifyResponse = {
  subject?: string;
  client_id?: string;
  scopes?: string[];
  revoked?: boolean;
  expired?: boolean;
  org_id?: string;
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
      orgId: typeof response.org_id === "string" && response.org_id ? response.org_id : null,
      format: "opaque",
      audience: "absent",
    },
  };
}

/** Verifies the bearer token for a request to `resource` (the URL the client called). */
export async function verifyAccessToken(authorization: string | null, resource: string): Promise<TokenCheck> {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) return { ok: false, reason: "no bearer token" };
  const iss = mcpIssuer();
  if (!iss) return { ok: false, reason: "CLERK_JWT_ISSUER_DOMAIN is not set" };
  const token = match[1];
  const result = token.split(".").length === 3 ? await verifyJwt(token, iss, resource) : await verifyOpaque(token);
  if (!result.ok) return result;
  // Fails closed: with no allowlist, no OAuth client is accepted.
  const allowed = allowedClientIds();
  if (!allowed || !allowed.has(result.token.clientId)) return { ok: false, reason: "OAuth client is not allowed" };
  if (enforceAudience() && result.token.audience !== "match") {
    return { ok: false, reason: `audience ${result.token.audience}` };
  }
  return result;
}

/** Convex's identity key for a Clerk user: the same one the web app stores. */
export function tokenIdentifierFor(clerkUserId: string): string | null {
  const iss = mcpIssuer();
  return iss ? `${iss}|${clerkUserId}` : null;
}

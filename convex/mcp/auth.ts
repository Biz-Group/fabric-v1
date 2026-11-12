import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import { env } from "../_generated/server";
import { clerkFetch } from "../lib/clerkApi";

/**
 * Bearer-token verification for the Fabric MCP server (SPIKE).
 *
 * MCP clients present a Clerk OAuth access token. We verify it here rather
 * than adding Clerk's OAuth issuer to `auth.config.ts`: that would make an
 * MCP token a valid Convex identity for every `requireAuth` function, not
 * just these read-only tools.
 *
 * Clerk issues JWT or opaque access tokens depending on instance settings, so
 * the spike accepts both. Clerk session tokens share the issuer and must be
 * refused: one is never an OAuth grant.
 *
 * Audience: Clerk lets only confidential OAuth apps set an audience URI, and
 * Claude Code and CIMD clients are public. So the spike binds tokens to an
 * allowlist of OAuth client ids (`FABRIC_MCP_CLIENT_IDS`), plus the audience
 * when `FABRIC_MCP_AUDIENCE` is set.
 */

export type VerifiedToken = {
  clerkUserId: string;
  clientId: string;
  scopes: string[];
  /** The workspace picked on the consent screen (`user:org:read`), if any. */
  orgId: string | null;
  format: "jwt" | "opaque";
  /** Claim names and token shape only, never values that identify a person. */
  shape: Record<string, unknown>;
};

export type TokenCheck = { ok: true; token: VerifiedToken } | { ok: false; reason: string; shape?: Record<string, unknown> };

let jwks: { issuer: string; set: ReturnType<typeof createRemoteJWKSet> } | null = null;

function issuer(): string | null {
  const domain = process.env.CLERK_JWT_ISSUER_DOMAIN?.trim().replace(/\/+$/, "");
  return domain ? domain : null;
}

/** Tests sign with a fresh key each time; this drops the cached key set. */
export function resetJwksCache(): void {
  jwks = null;
}

export function mcpIssuer(): string | null {
  return issuer();
}

function allowedClientIds(): Set<string> | null {
  const raw = env.FABRIC_MCP_CLIENT_IDS?.trim();
  if (!raw) return null;
  return new Set(raw.split(",").map((id) => id.trim()).filter(Boolean));
}

function jwtShape(header: Record<string, unknown>, payload: JWTPayload): Record<string, unknown> {
  return {
    typ: header.typ ?? null,
    alg: header.alg ?? null,
    claims: Object.keys(payload).sort(),
    aud: payload.aud ?? null,
    scope: typeof payload.scope === "string" ? payload.scope : null,
    hasOrgId: "org_id" in payload,
    lifetimeSecs: payload.exp && payload.iat ? payload.exp - payload.iat : null,
  };
}

function scopesOf(payload: JWTPayload): string[] {
  if (typeof payload.scope === "string") return payload.scope.split(" ").filter(Boolean);
  if (Array.isArray(payload.scp)) return payload.scp.filter((s): s is string => typeof s === "string");
  return [];
}

async function verifyJwt(token: string, iss: string): Promise<TokenCheck> {
  let header: Record<string, unknown>;
  try {
    header = decodeProtectedHeader(token) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "malformed token" };
  }
  if (!jwks || jwks.issuer !== iss) {
    jwks = { issuer: iss, set: createRemoteJWKSet(new URL(`${iss}/.well-known/jwks.json`)) };
  }
  const audience = env.FABRIC_MCP_AUDIENCE?.trim() || undefined;
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, jwks.set, { issuer: iss, audience, algorithms: ["RS256"] }));
  } catch (error) {
    return { ok: false, reason: `jwt rejected: ${(error as Error).name}` };
  }
  const shape = jwtShape(header, payload);
  const auds = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  // A Clerk session token (or a `convex` template token) is not an OAuth grant.
  if ("sid" in payload || auds.includes("convex")) return { ok: false, reason: "session token, not an OAuth access token", shape };
  const clientId = typeof payload.client_id === "string" ? payload.client_id : typeof payload.azp === "string" ? payload.azp : null;
  if (!clientId) return { ok: false, reason: "no client_id claim", shape };
  if (!payload.sub) return { ok: false, reason: "no subject", shape };
  const orgId = typeof payload.org_id === "string" && payload.org_id ? payload.org_id : null;
  return { ok: true, token: { clerkUserId: payload.sub, clientId, scopes: scopesOf(payload), orgId, format: "jwt", shape } };
}

type OpaqueVerifyResponse = {
  subject?: string;
  client_id?: string;
  scopes?: string[];
  revoked?: boolean;
  expired?: boolean;
  [key: string]: unknown;
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
  const shape = { fields: Object.keys(response ?? {}).sort() };
  if (!response || response.revoked || response.expired) return { ok: false, reason: "token revoked or expired", shape };
  if (!response.subject || !response.client_id) return { ok: false, reason: "verify response missing subject or client", shape };
  return {
    ok: true,
    token: {
      clerkUserId: response.subject,
      clientId: response.client_id,
      scopes: response.scopes ?? [],
      orgId: typeof response.org_id === "string" && response.org_id ? response.org_id : null,
      format: "opaque",
      shape,
    },
  };
}

export async function verifyAccessToken(authorization: string | null): Promise<TokenCheck> {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) return { ok: false, reason: "no bearer token" };
  const iss = issuer();
  if (!iss) return { ok: false, reason: "CLERK_JWT_ISSUER_DOMAIN is not set" };
  const token = match[1];
  const result = token.split(".").length === 3 ? await verifyJwt(token, iss) : await verifyOpaque(token);
  if (!result.ok) return result;
  // Fails closed: with no allowlist, no OAuth client is accepted.
  const allowed = allowedClientIds();
  if (!allowed || !allowed.has(result.token.clientId)) {
    return { ok: false, reason: "OAuth client is not allowed", shape: result.token.shape };
  }
  return result;
}

/** Convex's identity key for a Clerk user: the same one the web app stores. */
export function tokenIdentifierFor(clerkUserId: string): string | null {
  const iss = issuer();
  return iss ? `${iss}|${clerkUserId}` : null;
}

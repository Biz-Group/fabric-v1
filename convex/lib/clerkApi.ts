/**
 * Thin wrapper around Clerk's Backend REST API for use inside Convex actions.
 *
 * Safety contract (see the plan's multi-tenancy invariants):
 *   - The `organizationId` in every URL must come from the Convex JWT (via
 *     `resolveOrgForAction` + `requireOrgAdmin`-style admin check). Never pass
 *     a client-supplied org id to these helpers.
 *   - `CLERK_SECRET_KEY` is read from Convex env, not Next.js env. Set via
 *     `npx convex env set CLERK_SECRET_KEY ...`.
 */

const CLERK_API_BASE = "https://api.clerk.com/v1";

// Every Clerk Backend API path is `/`-separated segments of [A-Za-z0-9_-]
// (`/organizations/org_x/invitations/orginv_y/revoke`). Anything else — `.`,
// `..`, `%2e`, `?`, `#` — can only come from an interpolated value and would
// let `new URL()` re-target the secret-keyed request at a different endpoint
// (e.g. `../../../users/user_x/ban?`). Refuse before any request is sent.
const SAFE_CLERK_PATH = /^(?:\/[A-Za-z0-9_-]+)+$/;

const CLERK_ID_BODY = /^[A-Za-z0-9_]+$/;

export type ClerkIdPrefix = "org" | "orginv" | "user";

/** True when `value` is a well-formed Clerk id with the given prefix. */
export function isClerkId(value: string, prefix: ClerkIdPrefix): boolean {
  const head = `${prefix}_`;
  return value.startsWith(head) && CLERK_ID_BODY.test(value.slice(head.length));
}

/** Validate a client-supplied Clerk id before it reaches a Clerk API path. */
export function assertClerkId(value: string, prefix: ClerkIdPrefix): string {
  if (!isClerkId(value, prefix)) {
    throw new Error(`Invalid Clerk ${prefix} id`);
  }
  return value;
}

function getSecretKey(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) {
    throw new Error(
      "CLERK_SECRET_KEY is not set in the Convex environment. " +
        "Run `npx convex env set CLERK_SECRET_KEY <your-key>` before using Clerk-backed admin actions.",
    );
  }
  return key;
}

export async function clerkFetch(
  path: string,
  options: {
    method?: "GET" | "POST" | "DELETE" | "PATCH";
    body?: unknown;
    query?: Record<string, string | string[] | undefined>;
  } = {},
): Promise<unknown> {
  const { method = "GET", body, query } = options;

  if (!SAFE_CLERK_PATH.test(path)) {
    throw new Error("Refusing to call Clerk API with an unsafe path");
  }

  const url = new URL(`${CLERK_API_BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
      else url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Clerk API ${method} ${path} failed with ${res.status}: ${text}`,
    );
  }

  // Some Clerk DELETE endpoints return empty bodies.
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  return await res.json();
}

/**
 * Clerk's user identifier embedded in the Convex token is
 * `${issuer}|${clerkUserId}`. Extract the clerk user id.
 */
export function clerkUserIdFromTokenIdentifier(
  tokenIdentifier: string,
): string {
  const parts = tokenIdentifier.split("|");
  const last = parts[parts.length - 1];
  if (!last) {
    throw new Error(`Malformed tokenIdentifier: ${tokenIdentifier}`);
  }
  return last;
}

/** Lower-cased, trimmed email used for `emailLower` lookups. */
export function normalizeEmail(email?: string | null): string {
  return (email ?? "").trim().toLowerCase();
}

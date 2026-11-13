/**
 * Where to send someone once sign-in finishes.
 *
 * The proxy and Clerk hand the page a signed-out visitor asked for to
 * `/sign-in` as `redirect_url` (an absolute URL). Tenant sign-in always passes
 * through `/join-organization` to activate the workspace, and Clerk reaches
 * that page by two routes — the sign-in redirect, or the pending-session task
 * URL, which carries no query string — so the destination rides in
 * sessionStorage (per tab, per subdomain) rather than in the URL.
 *
 * Everything read from the URL or storage goes through `toSafeReturnPath`, so
 * the result can only ever be a path on the current host, with one exception:
 * the OAuth consent page of our own Clerk account portal
 * (`https://accounts.<root>/oauth-consent`), where an MCP client's sign-in
 * (Claude, Copilot) continues after a workspace sign-in (`toSafeOAuthConsentUrl`).
 */

const STORAGE_KEY = "fabric:return-path";

// Steps of the sign-in flow itself; returning to one of them would loop.
const AUTH_FLOW_PATH = /^\/(?:sign-in|sign-up|join-organization|api)(?:\/|$)/;

/**
 * Reduces `raw` to a path + query + hash on `currentHost`, or null when it
 * points anywhere else (another host, a protocol-relative `//host`, a
 * non-http scheme) or back into the sign-in flow.
 */
export function toSafeReturnPath(
  raw: string | null | undefined,
  currentHost: string,
): string | null {
  if (!raw || !currentHost) return null;

  let url: URL;
  try {
    url = new URL(raw, `https://${currentHost}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.host.toLowerCase() !== currentHost.toLowerCase()) return null;
  // A browser reads `//evil.example` as another host.
  if (url.pathname.startsWith("//")) return null;
  if (AUTH_FLOW_PATH.test(url.pathname)) return null;

  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The Clerk account portal's OAuth consent URL, kept whole, when `raw` is
 * exactly that page on this deployment's root domain
 * (`https://accounts.<root>/oauth-consent?...`); otherwise null. Clerk then
 * validates the OAuth request itself.
 */
export function toSafeOAuthConsentUrl(
  raw: string | null | undefined,
  currentHost: string,
): string | null {
  if (!raw || !currentHost) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const root = currentHost.toLowerCase().split(".").slice(1).join(".");
  if (!root.includes(".")) return null;
  if (url.protocol !== "https:") return null;
  if (url.host.toLowerCase() !== `accounts.${root}`) return null;
  if (url.pathname !== "/oauth-consent") return null;
  return url.href;
}

/** A remembered destination: a path on this host, or the OAuth consent URL. */
function toSafeDestination(raw: string | null | undefined, currentHost: string): string | null {
  return toSafeOAuthConsentUrl(raw, currentHost) ?? toSafeReturnPath(raw, currentHost);
}

/** Stores the validated `redirect_url` from the current page, or clears a
 * stale one when this sign-in has none. */
export function rememberReturnPathFromUrl(): void {
  const raw = new URLSearchParams(window.location.search).get("redirect_url");
  const path = toSafeDestination(raw, window.location.host);
  try {
    if (path) window.sessionStorage.setItem(STORAGE_KEY, path);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: sign-in still works, it just lands on the home page.
  }
}

/** The remembered destination, re-validated, or `/`. */
export function readReturnPath(): string {
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage blocked.
  }
  return toSafeDestination(stored, window.location.host) ?? "/";
}

/** True when the destination is another host (the OAuth consent page), so it needs a full navigation. */
export function isExternalDestination(destination: string): boolean {
  return /^https:\/\//.test(destination);
}

export function clearReturnPath(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked.
  }
}

/** `/sign-in`, carrying `returnPath` so the next sign-in remembers it. */
export function signInUrlFor(returnPath: string): string {
  return returnPath === "/"
    ? "/sign-in"
    : `/sign-in?redirect_url=${encodeURIComponent(returnPath)}`;
}

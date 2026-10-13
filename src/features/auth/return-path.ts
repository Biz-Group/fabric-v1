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
 * the result can only ever be a path on the current host.
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

/** Stores the validated `redirect_url` from the current page, or clears a
 * stale one when this sign-in has none. */
export function rememberReturnPathFromUrl(): void {
  const raw = new URLSearchParams(window.location.search).get("redirect_url");
  const path = toSafeReturnPath(raw, window.location.host);
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
  return toSafeReturnPath(stored, window.location.host) ?? "/";
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

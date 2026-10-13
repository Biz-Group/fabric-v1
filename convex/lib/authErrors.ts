import { ConvexError } from "convex/values";

/**
 * Typed auth failures. Plain `Error` messages are redacted to "Server Error"
 * in production, so the client couldn't tell "your session ended" from "you
 * were removed" from a bug. `ConvexError` data reaches the client intact.
 *
 * Shared with the Next.js app, which maps each code to a recovery screen.
 */
export const AUTH_ERROR_CODES = [
  "NOT_AUTHENTICATED",
  "NO_ACTIVE_ORG",
  "NOT_MEMBER",
  "REMOVED",
  "INSUFFICIENT_ROLE",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export function authError(
  code: AuthErrorCode,
  message: string,
): ConvexError<{ code: AuthErrorCode; message: string }> {
  return new ConvexError({ code, message });
}

/** The auth code carried by an error thrown from a Convex function, if any. */
export function authErrorCode(error: unknown): AuthErrorCode | null {
  if (typeof error !== "object" || error === null) return null;
  let { data } = error as { data?: unknown };
  // The Convex client parses error data back into an object; convex-test
  // leaves it as the JSON string.
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof data !== "object" || data === null) return null;
  const { code } = data as { code?: unknown };
  return AUTH_ERROR_CODES.find((known) => known === code) ?? null;
}

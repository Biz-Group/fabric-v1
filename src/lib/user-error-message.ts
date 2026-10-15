// Convex redacts plain `Error` messages to "Server Error" in production, so
// failures meant for the user travel as `ConvexError` data instead:
// `{ userMessage }` for ordinary refusals, `{ message }` for auth errors
// (convex/lib/authErrors.ts). This reads either back out.

function errorData(error: unknown): Record<string, unknown> | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;
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
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

/** The message a Convex function meant the user to read, if it sent one. */
export function userErrorMessage(error: unknown): string | null {
  const data = errorData(error);
  if (!data) return null;
  for (const key of ["userMessage", "message"] as const) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/**
 * The text to show for a failed call: the message the function sent, else
 * the thrown message without Convex's request framing, else `fallback`. A
 * plain `Error` from a function reads "Server Error" in production, which
 * falls through to `fallback`.
 */
export function describeError(error: unknown, fallback: string): string {
  const sent = userErrorMessage(error);
  if (sent) return sent;

  const message = error instanceof Error ? error.message : "";
  const uncaught = message.match(/Uncaught (?:Error|ConvexError): ([^\n]+)/);
  if (uncaught?.[1]) return uncaught[1].trim();
  if (!message.trim() || message.startsWith("[CONVEX") || message.includes("Server Error")) {
    return fallback;
  }
  return message;
}

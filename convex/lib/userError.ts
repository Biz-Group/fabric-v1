import { ConvexError } from "convex/values";

/**
 * An expected refusal the person acting should read, such as "You can't
 * demote the last admin". Plain `Error` messages are redacted to "Server
 * Error" in production; `ConvexError` data is not. The app reads it back with
 * `userErrorMessage` (src/lib/user-error-message.ts).
 */
export function userError(
  code: string,
  userMessage: string,
): ConvexError<{ code: string; userMessage: string }> {
  return new ConvexError({ code, userMessage });
}

/** The `userMessage` an error thrown by `userError` carries, if any. Reads
 * the data as an object (the Convex runtime) or a JSON string (convex-test). */
export function userErrorMessageOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  let { data } = error as { data?: unknown };
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof data !== "object" || data === null) return null;
  const { userMessage } = data as { userMessage?: unknown };
  return typeof userMessage === "string" ? userMessage : null;
}

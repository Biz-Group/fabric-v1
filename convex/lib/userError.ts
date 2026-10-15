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

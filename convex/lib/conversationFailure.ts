import { Infer, v } from "convex/values";

/**
 * Why a contribution ended up `failed`, stored on the row so the process log
 * can say what went wrong and whether a retry can help. A code rather than the
 * raw error: errors carry provider and storage details nobody should see, and
 * the client owns the wording (`src/features/status/conversation-failure.ts`).
 */
export const conversationFailureReasonValidator = v.union(
  // The stored audio failed its container check: damaged or unsupported.
  v.literal("audio_unreadable"),
  // The audio object is gone from storage.
  v.literal("audio_missing"),
  v.literal("too_long"),
  // Transcription succeeded but found nothing to transcribe.
  v.literal("no_speech"),
  // The transcription service failed.
  v.literal("transcription"),
  // The transcript is saved but the summary could not be generated.
  v.literal("analysis"),
  // An AI interview could not be fetched from the voice service.
  v.literal("interview_fetch"),
  // The voice service reported the AI interview itself as failed.
  v.literal("interview_failed"),
);

export type ConversationFailureReason = Infer<
  typeof conversationFailureReasonValidator
>;

/** Thrown inside a processing action to mark the row failed for a known
 * reason; anything else falls back to the action's default reason. */
export class ConversationFailure extends Error {
  constructor(
    readonly reason: ConversationFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "ConversationFailure";
  }
}

export function failureReasonFrom(
  error: unknown,
  fallback: ConversationFailureReason,
): ConversationFailureReason {
  return error instanceof ConversationFailure ? error.reason : fallback;
}

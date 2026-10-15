import type { Doc } from "../../../convex/_generated/dataModel";

export type ConversationFailureReason = NonNullable<
  Doc<"conversations">["failureReason"]
>;

export type ConversationFailureMeta = {
  /** What went wrong, in a sentence the contributor can act on. */
  message: string;
  /** Whether running it again can help. Bad or missing audio fails the same
   * way every time, so only a new recording fixes it. */
  retryable: boolean;
};

export const conversationFailureMeta: Record<
  ConversationFailureReason,
  ConversationFailureMeta
> = {
  audio_unreadable: {
    message:
      "The audio file couldn't be read. It may be damaged or in a format Fabric doesn't support.",
    retryable: false,
  },
  audio_missing: {
    message: "The audio file is no longer available.",
    retryable: false,
  },
  too_long: {
    message: "The recording is longer than the four-hour limit.",
    retryable: false,
  },
  no_speech: {
    message: "No speech was found in the recording.",
    retryable: false,
  },
  transcription: {
    message: "Transcription didn't finish. This is usually temporary.",
    retryable: true,
  },
  analysis: {
    message:
      "The transcript was saved, but the summary couldn't be written. This is usually temporary.",
    retryable: true,
  },
  interview_fetch: {
    message:
      "Fabric couldn't fetch the interview from the voice service. This is usually temporary.",
    retryable: true,
  },
  interview_failed: {
    message: "The voice service reported that the interview didn't complete.",
    retryable: false,
  },
};

/** Rows that failed before reasons were recorded get a generic message and
 * stay retryable, as they were. */
const UNKNOWN_FAILURE: ConversationFailureMeta = {
  message: "Processing didn't finish.",
  retryable: true,
};

export function describeConversationFailure(
  reason: ConversationFailureReason | null | undefined,
): ConversationFailureMeta {
  return reason ? conversationFailureMeta[reason] : UNKNOWN_FAILURE;
}

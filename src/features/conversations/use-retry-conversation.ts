"use client";

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { describeError } from "@/lib/user-error-message";

type RetryTarget = Pick<Doc<"conversations">, "_id" | "inputMode"> & {
  hasTranscript: boolean;
};

export function isStoredAudioConversation(
  inputMode: Doc<"conversations">["inputMode"],
) {
  return inputMode === "voiceRecord" || inputMode === "audioUpload";
}

/** What a retry will redo: AI interviews are fetched again; recordings
 * re-run whichever stage failed. */
export function retryLabel(target: RetryTarget) {
  if (!isStoredAudioConversation(target.inputMode)) return "Retry fetch";
  return target.hasTranscript
    ? "Retry summary generation"
    : "Retry transcription";
}

/** Admin-only retry for a failed contribution, shared by Admin →
 * Contributions and the process log. The server refuses everyone else. */
export function useRetryConversation() {
  const retryAgentConversation = useAction(api.conversations.retryFetch);
  const retryAudioConversation = useMutation(
    api.voiceRecordings.retryAudioProcessing,
  );
  const [retryingId, setRetryingId] = useState<Id<"conversations"> | null>(
    null,
  );

  const retry = async (target: RetryTarget) => {
    setRetryingId(target._id);
    try {
      if (isStoredAudioConversation(target.inputMode)) {
        const result = await retryAudioConversation({
          conversationId: target._id,
        });
        toast.success(
          result.retryStage === "analysis"
            ? "Summary retry queued."
            : "Transcription retry queued.",
        );
        return;
      }

      const result = await retryAgentConversation({
        conversationId: target._id,
      });
      if (result.status === "done") toast.success("Retry succeeded.");
      else if (result.status === "failed") toast.error("Retry failed again.");
      else toast.info(`Retry queued (status: ${result.status}).`);
    } catch (err) {
      toast.error(describeError(err, "Failed to retry this contribution."));
    } finally {
      setRetryingId(null);
    }
  };

  return { retry, retryingId };
}

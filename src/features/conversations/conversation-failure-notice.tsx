"use client";

import { AlertCircle, RotateCcw } from "lucide-react";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { describeConversationFailure } from "@/features/status/conversation-failure";
import {
  retryLabel,
  useRetryConversation,
} from "@/features/conversations/use-retry-conversation";

/** Why a contribution failed and what happens next: admins retry it here,
 * everyone else is told who can. */
export function ConversationFailureNotice({
  conversation,
  canRetry,
}: {
  conversation: Doc<"conversations">;
  canRetry: boolean;
}) {
  const failure = describeConversationFailure(conversation.failureReason);
  const { retry, retryingId } = useRetryConversation();
  const target = {
    _id: conversation._id,
    inputMode: conversation.inputMode,
    hasTranscript: Boolean(conversation.transcript?.length),
  };
  const retrying = retryingId === conversation._id;
  const nextStep = !failure.retryable
    ? "Retrying won't help, so capture it again."
    : canRetry
      ? null
      : "Ask an admin to retry it.";

  return (
    <div
      role="status"
      className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-destructive-border bg-destructive-subtle px-3 py-2.5"
    >
      <div className="flex min-w-0 items-start gap-2">
        <AlertCircle
          className="mt-0.5 size-4 shrink-0 text-destructive"
          aria-hidden="true"
        />
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">{failure.message}</p>
          {nextStep && (
            <p className="text-xs text-muted-foreground">{nextStep}</p>
          )}
        </div>
      </div>
      {failure.retryable && canRetry && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void retry(target)}
          disabled={retrying}
        >
          <RotateCcw />
          {retrying ? "Retrying…" : retryLabel(target)}
        </Button>
      )}
    </div>
  );
}

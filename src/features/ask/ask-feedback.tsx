"use client";

import { useMutation } from "convex/react";
import { useId, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { describeError } from "@/lib/user-error-message";
import { cn } from "@/lib/utils";

/**
 * Thumbs up or down on an answer (FR-7.1). Thumbs-down offers an unticked
 * "share with the Fabric team" box and an optional note (FR-7.2); nothing is
 * shared unless the user ticks it and presses Share.
 */
export function AskFeedback({
  messageId,
  feedback,
  actions,
}: {
  messageId: Id<"askMessages">;
  feedback: { rating: "up" | "down"; shared: boolean } | null;
  /** Shown before the thumbs: copy and read aloud. */
  actions?: ReactNode;
}) {
  const setFeedback = useMutation(api.askFeedback.setFeedback);
  const shareExchange = useMutation(api.askFeedback.shareExchange);
  const unshareExchange = useMutation(api.askFeedback.unshareExchange);
  const [panelOpen, setPanelOpen] = useState(false);
  const [share, setShare] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const checkboxId = useId();
  const rating = feedback?.rating ?? null;

  const run = async (action: Promise<unknown>, failure: string) => {
    setPending(true);
    try {
      await action;
      return true;
    } catch (error) {
      toast.error(describeError(error, failure));
      return false;
    } finally {
      setPending(false);
    }
  };

  const rate = async (next: "up" | "down") => {
    const value = rating === next ? null : next;
    if (await run(setFeedback({ messageId, rating: value }), "Couldn't save your feedback.")) {
      setPanelOpen(value === "down" && !feedback?.shared);
      setShare(false);
      setNote("");
    }
  };

  return (
    <div className="mt-2">
      <div className="flex items-center gap-0.5">
        {actions}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Helpful"
          aria-pressed={rating === "up"}
          disabled={pending}
          className={cn(rating === "up" && "text-foreground", rating !== "up" && "text-muted-foreground")}
          onClick={() => void rate("up")}
        >
          <ThumbsUp className={cn("size-3.5", rating === "up" && "fill-current")} aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Not helpful"
          aria-pressed={rating === "down"}
          disabled={pending}
          className={cn(rating === "down" && "text-foreground", rating !== "down" && "text-muted-foreground")}
          onClick={() => void rate("down")}
        >
          <ThumbsDown className={cn("size-3.5", rating === "down" && "fill-current")} aria-hidden />
        </Button>
        {feedback?.shared && (
          <span className="ml-2 text-xs text-muted-foreground">
            Shared with the Fabric team ·{" "}
            <button
              type="button"
              className="underline-offset-2 hover:underline"
              disabled={pending}
              onClick={() => void run(unshareExchange({ messageId }), "Couldn't unshare.")}
            >
              Unshare
            </button>
          </span>
        )}
      </div>
      {panelOpen && rating === "down" && !feedback?.shared && (
        <div className="mt-2 max-w-lg space-y-2 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-start gap-2">
            <Checkbox id={checkboxId} checked={share} onCheckedChange={(checked) => setShare(checked === true)} />
            <label htmlFor={checkboxId} className="text-sm leading-snug text-foreground">
              Share this exchange with the Fabric team
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Sharing includes your question, the answer, and the quoted Fabric content behind it. It&apos;s kept
                for 90 days, and you can unshare at any time.
              </span>
            </label>
          </div>
          {share && (
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={1_000}
              rows={2}
              placeholder="What was wrong? (optional)"
              aria-label="Note for the Fabric team"
              className="w-full resize-none rounded-md border bg-background px-2.5 py-1.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
            />
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPanelOpen(false)}>
              {share ? "Cancel" : "Close"}
            </Button>
            {share && (
              <Button
                size="sm"
                disabled={pending}
                onClick={async () => {
                  if (await run(shareExchange({ messageId, ...(note.trim() ? { note } : {}) }), "Couldn't share the exchange.")) {
                    setPanelOpen(false);
                    toast.success("Shared with the Fabric team.");
                  }
                }}
              >
                Share
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

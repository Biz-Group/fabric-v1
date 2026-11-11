"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { describeError } from "@/lib/user-error-message";

const MAX_REASON_LENGTH = 500;

export type DeletableContribution = {
  _id: Id<"conversations">;
  contributorName: string;
};

/**
 * Admin-only. Permanently deletes a contribution once the admin says why
 * (D6 in docs/move-contribution-task-list.md). The reason is kept in the
 * deletion log on the admin Contributions page; the server refuses a blank one.
 */
export function DeleteContributionDialog({
  contribution,
  open,
  onOpenChange,
  onDeleted,
}: {
  contribution: DeletableContribution | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs after a successful delete, before the dialog closes. */
  onDeleted?: (conversationId: Id<"conversations">) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {contribution && (
          // Keyed so a different row starts with an empty reason.
          <DeleteContributionForm
            key={contribution._id}
            contribution={contribution}
            onDone={() => {
              onDeleted?.(contribution._id);
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteContributionForm({
  contribution,
  onDone,
  onCancel,
}: {
  contribution: DeletableContribution;
  /** Called only after a successful delete. */
  onDone: () => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const deleteConversation = useMutation(api.conversations.deleteForAdmin);

  const trimmed = reason.trim();
  const tooLong = trimmed.length > MAX_REASON_LENGTH;
  const canDelete = trimmed.length > 0 && !tooLong && !pending;

  const handleDelete = async () => {
    if (!canDelete) return;
    setPending(true);
    try {
      await deleteConversation({
        conversationId: contribution._id,
        reason: trimmed,
      });
      toast.success("Contribution deleted.");
      onDone();
    } catch (err) {
      toast.error(describeError(err, "Couldn't delete this contribution."));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete this contribution?</DialogTitle>
        <DialogDescription>
          {contribution.contributorName}&apos;s transcript, summary and audio
          will be permanently removed, and the process overview will be
          refreshed without it. This can&apos;t be undone.
        </DialogDescription>
      </DialogHeader>

      <section className="space-y-1.5">
        <label htmlFor="delete-reason" className="text-sm font-medium">
          Reason
        </label>
        <Textarea
          id="delete-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Recorded twice, or a test recording"
          rows={2}
          required
          aria-invalid={tooLong}
          aria-describedby="delete-reason-hint"
        />
        <p
          id="delete-reason-hint"
          className={tooLong ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
        >
          {tooLong
            ? `Keep the reason under ${MAX_REASON_LENGTH} characters.`
            : "Required. Admins can read it later under Deleted on the Contributions page."}
        </p>
      </section>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={handleDelete}
          disabled={!canDelete}
        >
          {pending ? "Deleting…" : "Delete"}
        </Button>
      </DialogFooter>
    </>
  );
}

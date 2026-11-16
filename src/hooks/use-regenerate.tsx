"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { describeError, upToDateRefusal } from "@/lib/user-error-message";

type Press = (force: boolean) => Promise<unknown>;

/**
 * Regenerate and Retry buttons (docs/security-hardening-task-list.md, D4).
 *
 * The buttons only appear when there is something to redo (a failed, stale
 * or incomplete result), and the server checks again. If the result caught up
 * in the meantime and the server refuses, a contributor is told it's up to
 * date, and an admin is asked "Regenerate anyway?", since a forced rerun
 * spends AI credits and is capped per process per day. Any other error is
 * rethrown for the caller to show as it already does.
 *
 *   const regenerate = useRegenerate();
 *   await regenerate.run((force) => generateFlow({ processId, force }));
 *   ...
 *   {regenerate.dialog}
 */
export function useRegenerate() {
  const [offer, setOffer] = useState<{ message: string; press: Press } | null>(null);

  const run = async (press: Press) => {
    try {
      await press(false);
    } catch (error) {
      const refusal = upToDateRefusal(error);
      if (!refusal) throw error;
      if (refusal.canForce) setOffer({ message: refusal.message, press });
      else toast.info(refusal.message);
    }
  };

  const dialog = (
    <ConfirmDialog
      open={offer !== null}
      onOpenChange={(open) => {
        if (!open) setOffer(null);
      }}
      title="Regenerate anyway?"
      description={`${offer?.message ?? ""} Regenerating it again uses AI credits. Admins can do this 3 times a day for each process.`}
      confirmLabel="Regenerate anyway"
      onConfirm={async () => {
        if (!offer) return;
        try {
          await offer.press(true);
        } catch (error) {
          toast.error(describeError(error, "Couldn't start regenerating. Please try again."));
        }
      }}
    />
  );

  return { run, dialog };
}

"use client";

import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { describeError } from "@/lib/user-error-message";

/**
 * Erasing one person from a workspace, from the tenants console
 * (docs/client-offboarding-plan.md, Phase 4). Clients ask by email; only Biz
 * Group staff can do it.
 */

export function EraseMemberButton({
  tenantId,
  membershipId,
}: {
  tenantId: Id<"tenants">;
  membershipId: Id<"memberships">;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setOpen(true)}>
        Erase…
      </Button>
      {open && (
        <EraseMemberDialog
          tenantId={tenantId}
          membershipId={membershipId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function EraseMemberDialog({
  tenantId,
  membershipId,
  onClose,
}: {
  tenantId: Id<"tenants">;
  membershipId: Id<"memberships">;
  onClose: () => void;
}) {
  const preview = useQuery(api.personErasure.preview, { tenantId, membershipId });
  const erase = useMutation(api.personErasure.eraseMember);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [pending, setPending] = useState(false);
  const fieldId = useId();
  const ready =
    preview !== undefined &&
    !preview.isStaff &&
    confirmEmail.trim().toLowerCase() === preview.email.trim().toLowerCase();

  const handleErase = async () => {
    setPending(true);
    try {
      await erase({ tenantId, membershipId, confirmEmail });
      toast.success("Erasing. Progress shows under Erasures.");
      onClose();
    } catch (err) {
      toast.error(describeError(err, "The erasure couldn't be started."));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Erase {preview?.name ?? "this person"}?</DialogTitle>
          <DialogDescription>
            For when the client asks for someone&apos;s data to be deleted.
            This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        {preview === undefined ? (
          <p className="text-sm text-muted-foreground">Checking what this would delete…</p>
        ) : preview.isStaff ? (
          <p className="text-sm">Biz Group staff can&apos;t be erased from a client workspace.</p>
        ) : (
          <div className="space-y-4 text-sm">
            <ul className="list-inside list-disc space-y-1">
              <li>They lose access to the workspace at once.</li>
              <li>
                {preview.contributionsDeleted} interview(s) they gave are deleted with their
                recordings, including the copies at ElevenLabs.
              </li>
              {preview.contributionsDenamed > 0 && (
                <li>
                  {preview.contributionsDenamed} interview(s) they recorded for someone else stay,
                  without their name.
                </li>
              )}
              <li>
                Their name is removed from activity logs and their AskFabric chats are deleted.
              </li>
              <li>
                Process overviews and maps built from their interviews are cleared and rebuilt
                from the remaining interviews.
              </li>
              <li>
                {preview.otherWorkspaces > 0
                  ? `Their account stays: they're in ${preview.otherWorkspaces} other workspace(s).`
                  : "Their account is deleted too, unless Clerk shows them in another organization."}
              </li>
            </ul>
            <div className="space-y-1.5">
              <label htmlFor={fieldId} className="font-medium">
                Type <span className="font-mono">{preview.email}</span> to confirm
              </label>
              <Input
                id={fieldId}
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={pending}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void handleErase()} disabled={!ready || pending}>
            {pending ? "Starting…" : "Erase"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PHASE_LABEL: Record<string, string> = {
  membership: "Removing access",
  contributions: "Deleting interviews",
  records: "Removing their name from records",
  reprocess: "Clearing affected overviews",
  vendors: "Deleting copies at ElevenLabs and Clerk",
  done: "Done",
};

const ACCOUNT_LABEL: Record<string, string> = {
  pending: "not yet",
  erased: "deleted",
  keptOtherWorkspace: "kept (in another workspace)",
  keptStaff: "kept (Biz Group staff)",
  alreadyErased: "already deleted",
  failed: "failed",
};

function formatDateTime(ts: number) {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Recent erasures. The person isn't named: the record no longer knows who. */
export function ErasureList({ tenantId }: { tenantId: Id<"tenants"> }) {
  const erasures = useQuery(api.personErasure.listErasures, { tenantId });
  const retry = useMutation(api.personErasure.retryErasure);
  if (!erasures || erasures.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Erasures</h3>
      <ul className="divide-y rounded-md border text-sm">
        {erasures.map((row) => (
          <li key={row.erasureId} className="space-y-1 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{formatDateTime(row.startedAt)}</span>
              <span className="text-muted-foreground">by {row.requestedByName}</span>
              {row.status === "running" && !row.stale && <Badge tone="info">{PHASE_LABEL[row.phase]}</Badge>}
              {row.stale && <Badge tone="warning">Stalled; resumes within the hour</Badge>}
              {row.status === "needsRetry" && <Badge tone="warning">Needs a retry</Badge>}
              {row.status === "complete" && <Badge tone="success">Complete</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {row.counts.contributionsDeleted} interview(s) deleted
              {row.counts.contributionsDenamed > 0 && `, ${row.counts.contributionsDenamed} kept without their name`}
              ; {row.counts.recordsUpdated + row.counts.recordsDeleted} other record(s) changed;{" "}
              {row.counts.processesRebuilt + row.counts.processesCleared} process(es) cleared
              {row.counts.processesRebuilt > 0 && ` (${row.counts.processesRebuilt} rebuilding)`}; ElevenLabs{" "}
              {row.counts.elevenlabsDeleted} deleted
              {row.counts.elevenlabsSkipped > 0 && `, ${row.counts.elevenlabsSkipped} skipped (not production)`}
              {row.counts.elevenlabsFailed > 0 && `, ${row.counts.elevenlabsFailed} failed`}; account{" "}
              {ACCOUNT_LABEL[row.account]}.
            </p>
            {row.lastError && <p className="text-xs text-destructive">{row.lastError}</p>}
            {row.status === "needsRetry" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void retry({ erasureId: row.erasureId }).then(
                    () => toast.success("Retrying."),
                    (err: unknown) => toast.error(describeError(err, "Retry failed.")),
                  )
                }
              >
                Retry
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

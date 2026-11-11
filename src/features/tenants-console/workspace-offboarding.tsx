"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { describeError } from "@/lib/user-error-message";

/**
 * Workspace offboarding in the tenants console: close (suspend) a workspace,
 * see its scheduled purge, and reinstate it. See
 * docs/client-offboarding-plan.md.
 */

type TenantStatus = Doc<"tenants">["status"];

const CLOSED: ReadonlySet<TenantStatus> = new Set<TenantStatus>([
  "suspended",
  "purging",
  "purged",
  "deleted",
]);

export function isClosedTenantStatus(status: TenantStatus): boolean {
  return CLOSED.has(status);
}

export function WorkspaceStatusBadge({ status }: { status: TenantStatus }) {
  switch (status) {
    case "active":
      return <Badge tone="success">Active</Badge>;
    case "needsAttention":
      // Provisioning failed partway; "Retry provisioning" fixes it, so it
      // waits on a person rather than having failed for good.
      return <Badge tone="warning">Needs attention</Badge>;
    case "suspended":
      return <Badge tone="destructive">Closed</Badge>;
    case "purging":
      return <Badge tone="destructive">Deleting data</Badge>;
    case "purged":
      return <Badge tone="neutral">Data deleted</Badge>;
    case "deleted":
      return <Badge tone="neutral">Deleted</Badge>;
  }
}

function formatDateTime(ts: number) {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function daysUntil(ts: number) {
  return Math.max(0, Math.ceil((ts - Date.now()) / (24 * 60 * 60 * 1000)));
}

type Offboarding = {
  suspendedAt: number;
  origin: "console" | "clerkDeleted";
  suspendedByName: string;
  reason: string;
  purgeAfter: number;
  invitationsRevoked: number;
  invitationRevokeErrors: string[];
};

type TenantSummary = {
  tenantId: Id<"tenants">;
  name: string;
  slug: string;
  status: TenantStatus;
  offboarding: Offboarding | null;
};

/** The danger zone on an open workspace. */
export function CloseWorkspaceCard({ tenant }: { tenant: TenantSummary }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="border-destructive-border">
      <CardHeader>
        <CardTitle className="text-destructive">Close workspace</CardTitle>
        <CardDescription>
          Closes the workspace when a client leaves. Everyone loses access at
          once, Biz Group staff included, and pending invitations are
          revoked. The data is kept for 30 days so it can be exported or the
          workspace reopened, then deleted for good.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Close workspace…
        </Button>
        <CloseWorkspaceDialog tenant={tenant} open={open} onOpenChange={setOpen} />
      </CardContent>
    </Card>
  );
}

function CloseWorkspaceDialog({
  tenant,
  open,
  onOpenChange,
}: {
  tenant: TenantSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const suspend = useAction(api.workspaceLifecycle.suspendWorkspace);
  const [reason, setReason] = useState("");
  const [confirmSlug, setConfirmSlug] = useState("");
  const [pending, setPending] = useState(false);
  const reasonId = useId();
  const slugId = useId();
  const ready =
    reason.trim().length > 0 &&
    confirmSlug.trim().toLowerCase() === tenant.slug.toLowerCase();

  const handleClose = async () => {
    setPending(true);
    try {
      const result = await suspend({
        tenantId: tenant.tenantId,
        reason,
        confirmSlug,
      });
      if (result.errors.length > 0) {
        toast.warning(
          `${tenant.name} is closed, but ${result.errors.length} invitation(s) couldn't be revoked. Retry from this page.`,
        );
      } else {
        toast.success(`${tenant.name} is closed.`);
      }
      setReason("");
      setConfirmSlug("");
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, "The workspace couldn't be closed."));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={pending ? undefined : onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close {tenant.name}?</DialogTitle>
          <DialogDescription>
            Nobody can open this workspace from now on. Its data is deleted
            automatically in 30 days unless you reopen it before then.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={reasonId} className="text-sm font-medium">
              Reason
            </label>
            <Textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Contract ended 31 Oct; client asked for deletion"
              maxLength={500}
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={slugId} className="text-sm font-medium">
              Type <span className="font-mono">{tenant.slug}</span> to confirm
            </label>
            <Input
              id={slugId}
              value={confirmSlug}
              onChange={(e) => setConfirmSlug(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleClose()}
            disabled={!ready || pending}
          >
            {pending ? "Closing…" : "Close workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What replaces the settings cards once a workspace is closed. */
export function ClosedWorkspaceCard({ tenant }: { tenant: TenantSummary }) {
  const reinstate = useMutation(api.workspaceLifecycle.reinstateWorkspace);
  const retryRevocation = useAction(
    api.workspaceLifecycle.retryInvitationRevocation,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const offboarding = tenant.offboarding;

  const handleReinstate = async () => {
    try {
      await reinstate({ tenantId: tenant.tenantId });
      toast.success(`${tenant.name} is open again.`);
    } catch (err) {
      toast.error(describeError(err, "The workspace couldn't be reopened."));
      throw err;
    }
  };

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const result = await retryRevocation({ tenantId: tenant.tenantId });
      if (result.errors.length > 0) {
        toast.warning(`${result.errors.length} invitation(s) still failing.`);
      } else {
        toast.success("Pending invitations revoked.");
      }
    } catch (err) {
      toast.error(describeError(err, "Retry failed."));
    } finally {
      setRetrying(false);
    }
  };

  const title =
    tenant.status === "suspended"
      ? "This workspace is closed"
      : tenant.status === "purging"
        ? "This workspace's data is being deleted"
        : tenant.status === "purged"
          ? "This workspace's data has been deleted"
          : "This workspace was deleted in Clerk";

  return (
    <Card className="border-destructive-border">
      <CardHeader>
        <CardTitle className="text-destructive">{title}</CardTitle>
        <CardDescription>
          {tenant.status === "suspended" && offboarding?.origin === "clerkDeleted"
            ? "Its organization was deleted in the Clerk dashboard, so nobody can open it and it can't be reopened. Export the data if it's needed; it's deleted for good on the date below."
            : tenant.status === "suspended"
            ? "Nobody can open it, Biz Group staff included. Reopening restores access as it was, except for revoked invitations."
            : tenant.status === "deleted"
              ? "The organization no longer exists in Clerk, so nobody can open it. Its data in Fabric is still here."
              : "It can't be reopened."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {offboarding && (
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
            <dt className="text-muted-foreground">Closed</dt>
            <dd>
              {formatDateTime(offboarding.suspendedAt)} by{" "}
              {offboarding.suspendedByName}
            </dd>
            <dt className="text-muted-foreground">Reason</dt>
            <dd className="whitespace-pre-wrap">{offboarding.reason}</dd>
            {tenant.status === "suspended" && (
              <>
                <dt className="text-muted-foreground">Data deletion</dt>
                <dd>
                  Scheduled for {formatDateTime(offboarding.purgeAfter)} (
                  {daysUntil(offboarding.purgeAfter)} days)
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Invitations revoked</dt>
            <dd>{offboarding.invitationsRevoked}</dd>
          </dl>
        )}

        {offboarding && offboarding.invitationRevokeErrors.length > 0 && (
          <div className="space-y-2 rounded-md border border-warning-border bg-warning-subtle p-3">
            <p className="font-medium text-warning">
              Some pending invitations couldn&apos;t be revoked, so those
              people could still accept them in Clerk (Fabric won&apos;t let
              them in).
            </p>
            <ul className="list-inside list-disc text-xs">
              {offboarding.invitationRevokeErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
            {tenant.status === "suspended" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleRetry()}
                disabled={retrying}
              >
                {retrying ? "Retrying…" : "Retry revoking invitations"}
              </Button>
            )}
          </div>
        )}

        {tenant.status === "suspended" && (
          <div className="flex flex-wrap gap-2">
            {offboarding?.origin !== "clerkDeleted" && (
              <Button variant="outline" onClick={() => setConfirmOpen(true)}>
                Reopen workspace…
              </Button>
            )}
            <Button variant="destructive" onClick={() => setPurgeOpen(true)}>
              Delete data now…
            </Button>
            <PurgeNowDialog tenant={tenant} open={purgeOpen} onOpenChange={setPurgeOpen} />
            <ConfirmDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              title={`Reopen ${tenant.name}?`}
              description="Members get their access back and the scheduled deletion is cancelled. Invitations revoked when it closed stay revoked; send new ones if needed."
              confirmLabel="Reopen workspace"
              onConfirm={handleReinstate}
            />
          </div>
        )}

        {(tenant.status === "purging" || tenant.status === "purged") && (
          <PurgeStatus tenantId={tenant.tenantId} />
        )}
      </CardContent>
    </Card>
  );
}

function PurgeNowDialog({
  tenant,
  open,
  onOpenChange,
}: {
  tenant: TenantSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const purgeNow = useMutation(api.workspacePurge.purgeNow);
  const [confirmSlug, setConfirmSlug] = useState("");
  const [pending, setPending] = useState(false);
  const slugId = useId();
  const ready = confirmSlug.trim().toLowerCase() === tenant.slug.toLowerCase();

  const handlePurge = async () => {
    setPending(true);
    try {
      await purgeNow({ tenantId: tenant.tenantId, confirmSlug });
      toast.success(`Deleting ${tenant.name}'s data.`);
      setConfirmSlug("");
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, "The deletion couldn't be started."));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={pending ? undefined : onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {tenant.name}&apos;s data now?</DialogTitle>
          <DialogDescription>
            For when the client has asked for deletion before the 30 days are
            up. Every interview, recording, process map, summary and member
            record is deleted, along with the copies at ElevenLabs and the
            Clerk organization. This can&apos;t be undone, so export first if
            anyone needs the data.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label htmlFor={slugId} className="text-sm font-medium">
            Type <span className="font-mono">{tenant.slug}</span> to confirm
          </label>
          <Input
            id={slugId}
            value={confirmSlug}
            onChange={(e) => setConfirmSlug(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handlePurge()}
            disabled={!ready || pending}
          >
            {pending ? "Starting…" : "Delete data"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PHASE_LABEL: Record<string, string> = {
  collect: "Listing what to delete",
  tables: "Deleting Fabric data",
  vendors: "Deleting copies at ElevenLabs and Clerk",
  verify: "Checking nothing is left",
  done: "Done",
};

const CLERK_ORG_LABEL: Record<string, string> = {
  pending: "not yet",
  deleted: "deleted",
  alreadyGone: "already gone",
  failed: "failed",
};

/** Progress while the purge runs; afterwards, its completion certificate. */
function PurgeStatus({ tenantId }: { tenantId: Id<"tenants"> }) {
  const purge = useQuery(api.workspacePurge.getPurge, { tenantId });
  const retry = useMutation(api.workspacePurge.retryPurge);
  const [retrying, setRetrying] = useState(false);
  if (!purge) return null;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await retry({ tenantId });
      toast.success("Retrying.");
    } catch (err) {
      toast.error(describeError(err, "Retry failed."));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {purge.status === "complete" ? "Deletion certificate" : "Deletion in progress"}
        </span>
        {purge.status === "running" && !purge.stale && (
          <Badge tone="info">{PHASE_LABEL[purge.phase]}</Badge>
        )}
        {purge.stale && <Badge tone="warning">Stalled; resumes within the hour</Badge>}
        {purge.status === "needsRetry" && <Badge tone="warning">Needs a retry</Badge>}
        {purge.status === "complete" && <Badge tone="success">Complete</Badge>}
      </div>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted-foreground">Started</dt>
        <dd>
          {formatDateTime(purge.startedAt)}{" "}
          {purge.trigger === "manual"
            ? `by ${purge.requestedByName ?? "a platform admin"} (client request)`
            : "(30 days after closing)"}
        </dd>
        {purge.completedAt && (
          <>
            <dt className="text-muted-foreground">Completed</dt>
            <dd>{formatDateTime(purge.completedAt)}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Fabric records deleted</dt>
        <dd>
          {purge.rowsDeleted.toLocaleString()} records, {purge.filesDeleted} stored files
        </dd>
        <dt className="text-muted-foreground">ElevenLabs recordings</dt>
        <dd>
          {purge.elevenlabs.deleted} deleted, {purge.elevenlabs.alreadyGone} already gone
          {purge.elevenlabs.skipped > 0 && `, ${purge.elevenlabs.skipped} skipped (not production)`}
          {purge.elevenlabs.failed > 0 && `, ${purge.elevenlabs.failed} failed`}
        </dd>
        <dt className="text-muted-foreground">Clerk organization</dt>
        <dd>{CLERK_ORG_LABEL[purge.clerkOrg]}</dd>
        <dt className="text-muted-foreground">People</dt>
        <dd>
          {purge.people.erased} accounts deleted, {purge.people.keptOtherWorkspace} kept (in
          another workspace), {purge.people.keptStaff} Biz Group staff kept
          {purge.people.failed > 0 && `, ${purge.people.failed} failed`}
        </dd>
        <dt className="text-muted-foreground">Kept</dt>
        <dd>
          This record, the workspace&apos;s name and address, and the AI usage
          ledger for invoicing ({purge.usageRowsScrubbed} entries had names
          removed).
        </dd>
      </dl>
      {purge.lastError && <p className="text-xs text-destructive">{purge.lastError}</p>}
      {purge.status === "needsRetry" && (
        <Button size="sm" variant="outline" onClick={() => void handleRetry()} disabled={retrying}>
          {retrying ? "Retrying…" : "Retry"}
        </Button>
      )}
    </div>
  );
}

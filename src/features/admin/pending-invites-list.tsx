"use client";

import { useCallback, useEffect, useState } from "react";
import { useAction } from "convex/react";
import { AlertTriangle, Mail } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { InvitationExpiry } from "@/features/admin/invitation-expiry";
import { describeError } from "@/lib/user-error-message";
import { cn } from "@/lib/utils";

type PendingInvite = {
  id: string;
  email: string;
  role: "admin" | "contributor" | "viewer";
  status: string;
  createdAt: number;
  expiresAt: number | null;
};

// Secondary columns drop out on narrower screens so the email and actions
// always fit. Header and cells share these, so a hidden column never leaves
// its header behind.
const COLUMN_CLASS = {
  role: "hidden sm:table-cell",
  invited: "hidden md:table-cell",
  expires: "hidden sm:table-cell",
};

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export type PendingInvitesHandle = {
  refresh: () => Promise<void>;
};

export function PendingInvitesList({
  refreshKey = 0,
}: {
  refreshKey?: number;
}) {
  const listInvites = useAction(api.invitations.list);
  const reInvite = useAction(api.invitations.invite);
  const revokeInvite = useAction(api.invitations.revoke);

  const [invites, setInvites] = useState<PendingInvite[] | undefined>(undefined);
  // Set when the list has never loaded. A failed load isn't an empty list.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const [pendingRevoke, setPendingRevoke] = useState<PendingInvite | null>(
    null,
  );
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await listInvites({});
      setInvites(rows);
      setLoadError(null);
    } catch (err) {
      const msg = describeError(err, "Failed to load invitations.");
      toast.error(msg);
      setLoadError(msg);
    }
  }, [listInvites]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listInvites({});
        if (!cancelled) {
          setInvites(rows);
          setLoadError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(describeError(err, "Failed to load invitations."));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listInvites, refreshKey]);

  const handleResend = async (invite: PendingInvite) => {
    setMutatingId(invite.id);
    try {
      // Clerk doesn't expose a first-class "resend" — revoke + re-invite is
      // the canonical path. Both calls re-verify admin on the server.
      await revokeInvite({ invitationId: invite.id });
      const result = await reInvite({ email: invite.email, role: invite.role });
      if (result.outcome === "alreadyMember") {
        toast.info(`${result.email} is already a member of this workspace.`);
        await refresh();
        return;
      }
      if (result.outcome === "alreadyInvited") {
        toast.error(`An invitation is already pending for ${result.email}.`);
        await refresh();
        return;
      }
      if (result.outcome === "failed") {
        toast.error(result.userMessage);
        await refresh();
        return;
      }
      toast.success(`Re-sent invitation to ${invite.email}.`);
      await refresh();
    } catch (err) {
      const msg = describeError(err, "Failed to resend invitation.");
      toast.error(`${msg} If the old invitation was revoked, invite them again.`);
    } finally {
      setMutatingId(null);
    }
  };

  const handleRevoke = async () => {
    if (!pendingRevoke) return;
    setMutatingId(pendingRevoke.id);
    try {
      await revokeInvite({ invitationId: pendingRevoke.id });
      toast.success(`Revoked invitation for ${pendingRevoke.email}.`);
      await refresh();
    } catch (err) {
      const msg = describeError(err, "Failed to revoke invitation.");
      toast.error(msg);
      throw err;
    } finally {
      setMutatingId(null);
    }
  };

  if (invites === undefined) {
    if (loadError) {
      return (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load invitations"
          description={loadError}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setLoadError(null);
                void refresh();
              }}
            >
              Try again
            </Button>
          }
        />
      );
    }
    return (
      <Card padding="none" className="overflow-hidden">
        <Table>
          <TableBody>
            <TableSkeletonRows columns={5} rows={3} label="Loading invitations" />
          </TableBody>
        </Table>
      </Card>
    );
  }

  if (invites.length === 0) {
    return (
      <EmptyState
        icon={Mail}
        title="No pending invitations"
        description="Outstanding workspace invitations will appear here until they are accepted or expire."
      />
    );
  }

  return (
    <>
      <Card padding="none" className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead className={COLUMN_CLASS.role}>Role</TableHead>
              <TableHead className={COLUMN_CLASS.invited}>Invited</TableHead>
              <TableHead className={COLUMN_CLASS.expires}>Expires</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invites.map((invite) => (
              <TableRow key={invite.id}>
                <TableCell className="whitespace-normal">
                  <span className="font-medium wrap-anywhere">
                    {invite.email}
                  </span>
                  {/* Stands in for the Role and Expires columns, which are
                      hidden below sm. */}
                  <span className="block text-xs text-muted-foreground sm:hidden">
                    <span className="capitalize">{invite.role}</span> · Expires{" "}
                    <InvitationExpiry
                      expiresAt={invite.expiresAt}
                      status={invite.status}
                      now={now}
                    />
                  </span>
                </TableCell>
                <TableCell
                  className={cn(COLUMN_CLASS.role, "capitalize text-muted-foreground")}
                >
                  {invite.role}
                </TableCell>
                <TableCell
                  className={cn(COLUMN_CLASS.invited, "text-muted-foreground")}
                >
                  {formatDate(invite.createdAt)}
                </TableCell>
                <TableCell
                  className={cn(COLUMN_CLASS.expires, "text-muted-foreground")}
                >
                  <InvitationExpiry
                    expiresAt={invite.expiresAt}
                    status={invite.status}
                    now={now}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {/* sm, not xs: 28px with a mouse and 40px on touch. */}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={mutatingId === invite.id}
                      onClick={() => handleResend(invite)}
                      aria-label={`Resend invitation to ${invite.email}`}
                    >
                      Resend
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={mutatingId === invite.id}
                      onClick={() => setPendingRevoke(invite)}
                      aria-label={`Revoke invitation for ${invite.email}`}
                    >
                      Revoke
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null);
        }}
        title={
          pendingRevoke
            ? `Revoke invitation for ${pendingRevoke.email}?`
            : "Revoke invitation?"
        }
        description="The invitation link will stop working. You can invite them again later."
        confirmLabel="Revoke"
        destructive
        onConfirm={handleRevoke}
      />
    </>
  );
}

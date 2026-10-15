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
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { InvitationExpiry } from "@/features/admin/invitation-expiry";
import { describeError } from "@/lib/user-error-message";

type PendingInvite = {
  id: string;
  email: string;
  role: "admin" | "contributor" | "viewer";
  status: string;
  createdAt: number;
  expiresAt: number | null;
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
      <LoadingScreen fullScreen={false} message="Loading invitations..." />
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
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Invited</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invites.map((invite) => (
              <TableRow key={invite.id}>
                <TableCell className="font-medium">{invite.email}</TableCell>
                <TableCell className="capitalize text-muted-foreground">
                  {invite.role}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(invite.createdAt)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <InvitationExpiry
                    expiresAt={invite.expiresAt}
                    status={invite.status}
                    now={now}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={mutatingId === invite.id}
                      onClick={() => handleResend(invite)}
                    >
                      Resend
                    </Button>
                    <Button
                      size="xs"
                      variant="destructive"
                      disabled={mutatingId === invite.id}
                      onClick={() => setPendingRevoke(invite)}
                    >
                      Revoke
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
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

"use client";

import { useAction } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLE_OPTIONS = ["admin", "contributor", "viewer"] as const;
type Role = (typeof ROLE_OPTIONS)[number];

type PendingInvite = {
  id: string;
  email: string;
  role: Role;
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

/** Pending Clerk invitations for one tenant, managed from the platform
 * console (super-admin scope; independent of the caller's active org). */
export function TenantInvitations({ tenantId }: { tenantId: Id<"tenants"> }) {
  const listInvitations = useAction(api.tenants.listTenantInvitations);
  const inviteUser = useAction(api.tenants.inviteTenantUser);
  const revokeInvitation = useAction(api.tenants.revokeTenantInvitation);

  const [invites, setInvites] = useState<PendingInvite[] | undefined>(
    undefined,
  );
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("contributor");
  const [submitting, setSubmitting] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<PendingInvite | null>(
    null,
  );

  const refresh = useCallback(async () => {
    try {
      const rows = await listInvitations({ tenantId });
      setInvites(rows);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load invitations.",
      );
      setInvites([]);
    }
  }, [listInvitations, tenantId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listInvitations({ tenantId });
        if (!cancelled) setInvites(rows);
      } catch (err) {
        if (!cancelled) {
          toast.error(
            err instanceof Error ? err.message : "Failed to load invitations.",
          );
          setInvites([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listInvitations, tenantId]);

  const handleInvite = async () => {
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      toast.error("Enter a valid email address.");
      return;
    }
    setSubmitting(true);
    try {
      await inviteUser({ tenantId, email: trimmed, role });
      toast.success(`Invitation sent to ${trimmed}.`);
      setEmail("");
      setRole("contributor");
      await refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to send invitation.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-[1fr_150px_auto]">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleInvite();
          }}
          placeholder="name@client.com"
          disabled={submitting}
        />
        <Select
          value={role}
          onValueChange={(value) => setRole(value as Role)}
          disabled={submitting}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_OPTIONS.map((option) => (
              <SelectItem key={option} value={option} className="capitalize">
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={handleInvite} disabled={submitting || !email.trim()}>
          {submitting ? "Sending..." : "Send invite"}
        </Button>
      </div>

      {invites === undefined ? (
        <p className="text-sm text-muted-foreground">Loading invitations...</p>
      ) : invites.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No pending invitations.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invites.map((invite) => (
              <TableRow key={invite.id}>
                <TableCell className="font-medium">{invite.email}</TableCell>
                <TableCell className="capitalize">{invite.role}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(invite.createdAt)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {invite.expiresAt ? formatDate(invite.expiresAt) : "—"}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingRevoke(invite)}
                  >
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null);
        }}
        title="Revoke invitation?"
        description={
          pendingRevoke
            ? `${pendingRevoke.email} will no longer be able to join with this invitation.`
            : undefined
        }
        confirmLabel="Revoke"
        destructive
        onConfirm={async () => {
          if (!pendingRevoke) return;
          try {
            await revokeInvitation({
              tenantId,
              invitationId: pendingRevoke.id,
            });
            toast.success(`Revoked invitation for ${pendingRevoke.email}.`);
            setPendingRevoke(null);
            await refresh();
          } catch (err) {
            toast.error(
              err instanceof Error
                ? err.message
                : "Failed to revoke invitation.",
            );
            throw err;
          }
        }}
      />
    </div>
  );
}

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
import { InvitationExpiry } from "@/features/admin/invitation-expiry";
import { describeError } from "@/lib/user-error-message";

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
  // Set when the list has never loaded. A failed load isn't an empty list.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
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
      setLoadError(null);
    } catch (err) {
      const msg = describeError(err, "Failed to load invitations.");
      toast.error(msg);
      setLoadError(msg);
    }
  }, [listInvitations, tenantId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listInvitations({ tenantId });
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
      toast.error(describeError(err, "Failed to send invitation."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* A compact inline row with no visible labels: the card title names
          the section and the placeholder shows the format, so each control
          carries its own accessible name. */}
      <div className="grid gap-2 sm:grid-cols-[1fr_150px_auto]">
        <Input
          type="email"
          aria-label="Email address to invite"
          autoComplete="off"
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
          <SelectTrigger aria-label="Role for the invitation" className="w-full">
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

      {invites === undefined && loadError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLoadError(null);
              void refresh();
            }}
          >
            Try again
          </Button>
        </div>
      ) : invites === undefined ? (
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
              <TableHead className="w-20">
                <span className="sr-only">Actions</span>
              </TableHead>
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
                  <InvitationExpiry
                    expiresAt={invite.expiresAt}
                    status={invite.status}
                    now={now}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingRevoke(invite)}
                    aria-label={`Revoke invitation for ${invite.email}`}
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
            toast.error(describeError(err, "Failed to revoke invitation."));
            throw err;
          }
        }}
      />
    </div>
  );
}

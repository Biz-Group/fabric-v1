"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MAX_INVITES_PER_BATCH,
  parseInviteEmails,
} from "@/features/admin/parse-invite-emails";
import { describeError } from "@/lib/user-error-message";

const ROLE_OPTIONS = ["admin", "contributor", "viewer"] as const;
type Role = (typeof ROLE_OPTIONS)[number];

/** Addresses that weren't invited, and why, kept on screen after a batch. */
type Skipped = { email: string; reason: string };

export function InviteMemberDialog({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited?: () => void;
}) {
  const invite = useAction(api.invitations.invite);
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<Role>("contributor");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const submitting = progress !== null;
  const parsed = parseInviteEmails(emails);

  const handleSubmit = async () => {
    if (submitting) return;
    const { valid, invalid } = parsed;
    if (invalid.length > 0) {
      toast.error(
        invalid.length === 1
          ? `"${invalid[0]}" isn't a valid email address.`
          : `${invalid.length} entries aren't valid email addresses: ${invalid.join(", ")}`,
      );
      return;
    }
    if (valid.length === 0) {
      toast.error("Enter a valid email address.");
      return;
    }
    if (valid.length > MAX_INVITES_PER_BATCH) {
      toast.error(`Invite up to ${MAX_INVITES_PER_BATCH} people at a time.`);
      return;
    }

    // One at a time: each invite runs the server's own checks (domain rules,
    // existing members, pending invites), and Clerk rate-limits bursts.
    const sent: string[] = [];
    const notSent: Skipped[] = [];
    const failed: string[] = [];
    setSkipped([]);
    setProgress({ done: 0, total: valid.length });
    for (const [index, email] of valid.entries()) {
      try {
        const result = await invite({ email, role });
        if (result.outcome === "invited") sent.push(email);
        else if (result.outcome === "alreadyMember") {
          notSent.push({ email, reason: "Already a member." });
        } else if (result.outcome === "alreadyInvited") {
          notSent.push({ email, reason: "An invitation is already pending." });
        } else {
          notSent.push({ email, reason: result.userMessage });
          failed.push(email);
        }
      } catch (err) {
        notSent.push({
          email,
          reason: describeError(err, "The invitation couldn't be sent."),
        });
        failed.push(email);
      }
      setProgress({ done: index + 1, total: valid.length });
    }
    setProgress(null);

    if (sent.length > 0) {
      onInvited?.();
      toast.success(
        sent.length === 1
          ? `Invitation sent to ${sent[0]}.`
          : `${sent.length} invitations sent.`,
      );
    }
    if (notSent.length === 0) {
      setEmails("");
      setRole("contributor");
      onOpenChange(false);
      return;
    }
    // Keep only the failures in the box, ready to fix and resend; addresses
    // that are already members or invited need nothing more.
    setEmails(failed.join("\n"));
    setSkipped(notSent);
  };

  const count = parsed.valid.length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return;
        if (!next) setSkipped([]);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite members</DialogTitle>
          <DialogDescription>
            We&apos;ll email each person a link to join this workspace. Fabric
            will apply the selected role when they accept.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <label
              htmlFor="invite-member-emails"
              className="text-xs font-medium text-muted-foreground"
            >
              Email addresses
            </label>
            <Textarea
              id="invite-member-emails"
              placeholder="name@company.com, another@company.com"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              rows={3}
              autoFocus
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              Paste one address or a list, separated by commas or new lines.
            </p>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="invite-member-role"
              className="text-xs font-medium text-muted-foreground"
            >
              Role
            </label>
            <Select
              value={role}
              onValueChange={(value) => setRole(value as Role)}
              disabled={submitting}
            >
              <SelectTrigger id="invite-member-role" className="w-full">
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
          </div>
          {skipped.length > 0 && (
            <div role="status" className="space-y-1 rounded-md border px-3 py-2">
              <p className="text-xs font-medium">Not invited</p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {skipped.map((entry) => (
                  <li key={entry.email}>
                    <span className="text-foreground">{entry.email}</span>:{" "}
                    {entry.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !emails.trim()}>
            {progress
              ? `Sending ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
              : count > 1
                ? `Send ${count} invites`
                : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

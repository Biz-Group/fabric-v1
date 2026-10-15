import { Badge } from "@/components/ui/badge";

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * An invitation's expiry date, flagged once it has passed. Clerk can keep
 * listing an invitation as pending after its link stops working, so the date
 * alone reads as still valid.
 */
export function InvitationExpiry({
  expiresAt,
  status,
  now,
}: {
  expiresAt: number | null;
  status: string;
  /** Read once by the caller; rendering must not call Date.now(). */
  now: number;
}) {
  const expired =
    status === "expired" || (expiresAt !== null && expiresAt <= now);
  return (
    <span className="inline-flex items-center gap-2">
      {expiresAt ? formatDate(expiresAt) : "—"}
      {expired && <Badge variant="destructive">Expired</Badge>}
    </span>
  );
}

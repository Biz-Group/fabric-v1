"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
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
import { Input } from "@/components/ui/input";
import { LoadingScreen } from "@/components/ui/loading-screen";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function PlatformTeamPage() {
  const superAdmins = useQuery(api.platform.listSuperAdmins);
  const me = useQuery(api.users.getMe);

  if (superAdmins === undefined || me === undefined) {
    return <LoadingScreen message="Loading platform team..." />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Platform team</h1>
        <p className="text-sm text-muted-foreground">
          Super-admins can manage every tenant and this console.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Super-admins</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {superAdmins.map((admin) => (
                <SuperAdminRow
                  key={admin._id}
                  userId={admin._id}
                  name={admin.name}
                  email={admin.email}
                  isSelf={me?._id === admin._id}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PromoteCard />
      <StaffSyncCard />
    </div>
  );
}

function SuperAdminRow({
  userId,
  name,
  email,
  isSelf,
}: {
  userId: Id<"users">;
  name: string;
  email: string;
  isSelf: boolean;
}) {
  const setPlatformRole = useMutation(api.platform.setPlatformRole);
  const [confirming, setConfirming] = useState(false);

  return (
    <TableRow>
      <TableCell className="font-medium">
        {name}
        {isSelf && (
          <Badge variant="secondary" className="ml-2">
            You
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">{email}</TableCell>
      <TableCell>
        {!isSelf && (
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
            Demote
          </Button>
        )}
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={`Demote ${name}?`}
          description="They keep their existing workspace memberships but lose platform-level access, including this console."
          confirmLabel="Demote"
          destructive
          onConfirm={async () => {
            try {
              await setPlatformRole({
                targetUserId: userId,
                platformRole: null,
              });
              toast.success(`${name} is no longer a super-admin.`);
            } catch (err) {
              toast.error(
                err instanceof Error ? err.message : "Failed to demote.",
              );
              throw err;
            }
          }}
        />
      </TableCell>
    </TableRow>
  );
}

function PromoteCard() {
  const [email, setEmail] = useState("");
  const [lookupEmail, setLookupEmail] = useState<string | null>(null);
  const candidate = useQuery(
    api.platform.findUserByEmail,
    lookupEmail ? { email: lookupEmail } : "skip",
  );
  const setPlatformRole = useMutation(api.platform.setPlatformRole);
  const fanOutToAllTenants = useAction(api.tenants.fanOutToAllTenants);
  const [promoting, setPromoting] = useState(false);

  const handlePromote = async () => {
    if (!candidate) return;
    setPromoting(true);
    try {
      await setPlatformRole({
        targetUserId: candidate.userId,
        platformRole: "superAdmin",
      });
      toast.success(`${candidate.name} promoted to super-admin.`);
      // New super-admins need Clerk memberships in every tenant to actually
      // enter the workspaces — fan out right away.
      const result = await fanOutToAllTenants();
      if (result.errors.length > 0) {
        toast.warning(
          `Access sync finished with ${result.errors.length} error(s) across ${result.tenantsProcessed} tenants.`,
        );
      } else {
        toast.success(
          `Access granted across ${result.tenantsProcessed} tenant(s).`,
        );
      }
      setEmail("");
      setLookupEmail(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to promote.");
    } finally {
      setPromoting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Promote a super-admin</CardTitle>
        <CardDescription>
          The person must already have a Fabric account (signed in at least
          once). Promotion also grants them admin access to every tenant.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && EMAIL_RE.test(email.trim())) {
                setLookupEmail(email.trim());
              }
            }}
            placeholder="colleague@bizgroup.ae"
            disabled={promoting}
          />
          <Button
            variant="outline"
            onClick={() => setLookupEmail(email.trim())}
            disabled={promoting || !EMAIL_RE.test(email.trim())}
          >
            Look up
          </Button>
        </div>
        {lookupEmail && candidate === null && (
          <p className="text-sm text-muted-foreground">
            No Fabric account found for {lookupEmail}.
          </p>
        )}
        {candidate && (
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">{candidate.name}</p>
              <p className="text-xs text-muted-foreground">{candidate.email}</p>
            </div>
            {candidate.platformRole === "superAdmin" ? (
              <Badge variant="secondary">Already a super-admin</Badge>
            ) : (
              <Button onClick={handlePromote} disabled={promoting}>
                {promoting ? "Promoting..." : "Promote"}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StaffSyncCard() {
  const fanOutToAllTenants = useAction(api.tenants.fanOutToAllTenants);
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await fanOutToAllTenants();
      if (result.errors.length > 0) {
        toast.warning(
          `Sync finished with ${result.errors.length} error(s) across ${result.tenantsProcessed} tenant(s).`,
        );
      } else {
        toast.success(`All super-admins synced across ${result.tenantsProcessed} tenant(s).`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Staff access sync</CardTitle>
        <CardDescription>
          Re-runs the super-admin fan-out for every tenant. Safe to run any
          time — it&apos;s idempotent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={handleSync} disabled={syncing}>
          {syncing ? "Syncing..." : "Sync access to all tenants"}
        </Button>
      </CardContent>
    </Card>
  );
}

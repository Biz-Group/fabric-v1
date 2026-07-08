"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
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
import { EmptyState } from "@/components/ui/empty-state";
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
import { TenantInvitations } from "@/features/tenants-console/tenant-invitations";
import {
  tenantHostname,
  tenantWorkspaceUrl,
} from "@/features/tenants-console/tenant-url";

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function parseDomains(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,;]+/)
        .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean),
    ),
  ];
}

export default function TenantDetailPage() {
  const params = useParams<{ tenantId: string }>();
  const tenant = useQuery(api.tenants.get, { tenantId: params.tenantId });

  if (tenant === undefined) {
    return <LoadingScreen message="Loading tenant..." />;
  }

  if (tenant === null) {
    return (
      <EmptyState
        title="Tenant not found"
        description="This tenant doesn't exist, or its record hasn't been synced yet."
        action={<Button render={<Link href="/" />}>Back to tenants</Button>}
      />
    );
  }

  return <TenantDetail tenant={tenant} />;
}

type TenantView = NonNullable<FunctionReturnType<typeof api.tenants.get>>;

function TenantDetail({ tenant }: { tenant: TenantView }) {
  return (
    <div className="space-y-6">
      <TenantHeader tenant={tenant} />

      {tenant.provisioningErrors.length > 0 && (
        <ProvisioningErrors tenant={tenant} />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <DomainsCard tenant={tenant} />
        <LogoCard tenant={tenant} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending invitations</CardTitle>
          <CardDescription>
            Invitation emails link straight to {tenantHostname(tenant.slug)}
            /sign-up, and Fabric applies the selected role when the person
            joins.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TenantInvitations tenantId={tenant.tenantId} />
        </CardContent>
      </Card>

      <MembersCard clerkOrgId={tenant.clerkOrgId} />
    </div>
  );
}

function TenantHeader({ tenant }: { tenant: TenantView }) {
  const renameTenant = useAction(api.tenants.renameTenant);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tenant.name);
  const [saving, setSaving] = useState(false);

  const handleRename = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === tenant.name) {
      setEditing(false);
      setName(tenant.name);
      return;
    }
    setSaving(true);
    try {
      await renameTenant({ tenantId: tenant.tenantId, name: trimmed });
      toast.success("Tenant renamed.");
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        {tenant.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={tenant.logoUrl}
            alt=""
            className="h-12 w-12 rounded-lg object-cover ring-1 ring-border"
          />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-sm font-semibold uppercase">
            {tenant.name.slice(0, 2)}
          </span>
        )}
        <div>
          {editing ? (
            <div className="flex items-center gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleRename();
                  if (e.key === "Escape") {
                    setEditing(false);
                    setName(tenant.name);
                  }
                }}
                autoFocus
                disabled={saving}
                className="h-8 w-64"
              />
              <Button size="sm" onClick={handleRename} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{tenant.name}</h1>
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                Rename
              </Button>
            </div>
          )}
          <div className="mt-0.5 flex items-center gap-3 text-sm text-muted-foreground">
            <a
              href={tenantWorkspaceUrl(tenant.slug)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
            >
              {tenantHostname(tenant.slug)}
              <ExternalLink className="h-3 w-3" />
            </a>
            <span>Created {formatDate(tenant.createdAt)}</span>
            {tenant.status === "needsAttention" && (
              <Badge variant="destructive">Needs attention</Badge>
            )}
            {tenant.status === "deleted" && (
              <Badge variant="outline">Deleted</Badge>
            )}
          </div>
        </div>
      </div>
      <div className="flex gap-6 text-sm">
        <Stat label="Members" value={tenant.memberCount} />
        <Stat label="Admins" value={tenant.adminCount} />
        <Stat label="Pending invites" value={tenant.pendingInviteCount} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="text-right">
      <div className="text-lg font-semibold tabular-nums">{value ?? "—"}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function ProvisioningErrors({ tenant }: { tenant: TenantView }) {
  const retryProvisioning = useAction(api.tenants.retryProvisioning);
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const result = await retryProvisioning({ tenantId: tenant.tenantId });
      if (result.errors.length === 0) {
        toast.success("Provisioning completed.");
      } else {
        toast.warning(
          `${result.errors.length} step(s) still failing — details updated below.`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Card className="ring-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">
          Provisioning incomplete
        </CardTitle>
        <CardDescription>
          The workspace exists, but these setup steps failed. Retry re-runs
          them safely.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="list-inside list-disc space-y-1 text-sm">
          {tenant.provisioningErrors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
        <Button onClick={handleRetry} disabled={retrying}>
          {retrying ? "Retrying..." : "Retry provisioning"}
        </Button>
      </CardContent>
    </Card>
  );
}

function DomainsCard({ tenant }: { tenant: TenantView }) {
  const updateDomains = useAction(api.tenants.updateAllowedEmailDomains);
  const [input, setInput] = useState(tenant.allowedEmailDomains.join(", "));
  const [saving, setSaving] = useState(false);
  const parsed = useMemo(() => parseDomains(input), [input]);
  const dirty =
    parsed.join(",") !== tenant.allowedEmailDomains.join(",");

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await updateDomains({
        tenantId: tenant.tenantId,
        domains: parsed,
      });
      setInput(result.allowedEmailDomains.join(", "));
      toast.success("Allowed domains updated.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update domains.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Allowed email domains</CardTitle>
        <CardDescription>
          Verified emails on these domains can self-join at the workspace
          subdomain. Biz Group staff always have access.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="client.com, client.ae"
          disabled={saving}
        />
        {parsed.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {parsed.map((domain) => (
              <Badge key={domain} variant="outline">
                @{domain}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Empty list = invite-only (plus Biz Group staff).
          </p>
        )}
        <Button onClick={handleSave} disabled={saving || !dirty}>
          {saving ? "Saving..." : "Save domains"}
        </Button>
      </CardContent>
    </Card>
  );
}

function LogoCard({ tenant }: { tenant: TenantView }) {
  const generateLogoUploadUrl = useMutation(api.tenants.generateLogoUploadUrl);
  const updateLogo = useAction(api.tenants.updateLogo);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const uploadUrl = await generateLogoUploadUrl();
      const upload = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!upload.ok) throw new Error("Upload failed. Try again.");
      const uploaded = (await upload.json()) as { storageId: Id<"_storage"> };
      await updateLogo({
        tenantId: tenant.tenantId,
        logoStorageId: uploaded.storageId,
      });
      toast.success("Logo updated.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update the logo.",
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo</CardTitle>
        <CardDescription>
          Shown across the workspace and used for the tenant&apos;s theme
          generation.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        {tenant.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={tenant.logoUrl}
            alt=""
            className="h-14 w-14 rounded-lg object-cover ring-1 ring-border"
          />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted text-sm font-semibold uppercase">
            {tenant.name.slice(0, 2)}
          </span>
        )}
        <Input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </CardContent>
    </Card>
  );
}

function MembersCard({ clerkOrgId }: { clerkOrgId: string }) {
  const members = useQuery(api.tenants.listTenantMembers, { clerkOrgId });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          Read-only. Role changes and removals happen in the workspace&apos;s
          own admin console.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {members === undefined ? (
          <p className="text-sm text-muted-foreground">Loading members...</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.membershipId}>
                  <TableCell className="font-medium">
                    {member.name}
                    {member.platformRole === "superAdmin" && (
                      <Badge variant="secondary" className="ml-2">
                        Biz Group
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {member.email}
                  </TableCell>
                  <TableCell className="capitalize">{member.role}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(member.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

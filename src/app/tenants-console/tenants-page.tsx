"use client";

import { useQuery } from "convex/react";
import { Building2, ExternalLink } from "lucide-react";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingScreen } from "@/components/ui/loading-screen";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

function StatusBadge({ status }: { status: string }) {
  if (status === "active") return <Badge variant="secondary">Active</Badge>;
  if (status === "needsAttention")
    return <Badge variant="destructive">Needs attention</Badge>;
  return <Badge variant="outline">Deleted</Badge>;
}

export default function TenantsListPage() {
  const tenants = useQuery(api.tenants.list);

  if (tenants === undefined) {
    return <LoadingScreen message="Loading tenants..." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Tenants</h1>
          <p className="text-sm text-muted-foreground">
            Every client workspace on the platform.
          </p>
        </div>
        <Button render={<Link href="/new" />}>New tenant</Button>
      </div>

      {tenants.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No tenants yet"
          description="Create your first tenant, or run the Clerk backfill if existing organizations aren't showing here."
          action={<Button render={<Link href="/new" />}>New tenant</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Workspace</TableHead>
                <TableHead>Allowed domains</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead className="text-right">Pending invites</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow key={tenant.tenantId}>
                  <TableCell>
                    <Link
                      href={`/${tenant.tenantId}`}
                      className="flex items-center gap-3 font-medium hover:underline"
                    >
                      {tenant.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={tenant.logoUrl}
                          alt=""
                          className="h-7 w-7 rounded-md object-cover"
                        />
                      ) : (
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-xs font-semibold uppercase">
                          {tenant.name.slice(0, 2)}
                        </span>
                      )}
                      {tenant.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <a
                      href={tenantWorkspaceUrl(tenant.slug)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {tenantHostname(tenant.slug)}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </TableCell>
                  <TableCell>
                    {tenant.allowedEmailDomains.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        Invite &amp; staff only
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {tenant.allowedEmailDomains.slice(0, 3).map((domain) => (
                          <Badge key={domain} variant="outline">
                            @{domain}
                          </Badge>
                        ))}
                        {tenant.allowedEmailDomains.length > 3 && (
                          <Badge variant="ghost">
                            +{tenant.allowedEmailDomains.length - 3}
                          </Badge>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {tenant.memberCount ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {tenant.pendingInviteCount ?? "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={tenant.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(tenant.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

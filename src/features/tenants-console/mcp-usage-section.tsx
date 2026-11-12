"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { McpBreakdownTables, McpDailyBars, McpUsageStats } from "@/features/mcp/mcp-usage";

const DEPLOYMENT_NOTE = "This deployment only: MCP usage isn't merged across deployments.";

/** Tenants console → one workspace's usage → MCP (Phase 3, B2). */
export function McpTenantUsageSection({ clerkOrgId, from, to }: { clerkOrgId: string; from: string; to: string }) {
  const usage = useQuery(api.mcpUsage.tenantUsage, { clerkOrgId, from, to });
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">MCP (AI assistants)</h2>
        <p className="text-xs text-muted-foreground">
          Tool calls from Claude, Copilot and other assistants. {DEPLOYMENT_NOTE}
        </p>
      </div>
      {usage === undefined ? (
        <Skeleton className="h-32 w-full" />
      ) : usage.totals.calls === 0 ? (
        <p className="text-sm text-muted-foreground">No MCP calls in this range.</p>
      ) : (
        <>
          <McpUsageStats totals={usage.totals} />
          <McpDailyBars days={usage.byDay} />
          <McpBreakdownTables totals={usage.totals} />
          {usage.capped && <p className="text-xs text-muted-foreground">Today&rsquo;s figures cover the most recent calls only.</p>}
        </>
      )}
    </section>
  );
}

/** Tenants console → usage overview → MCP calls per workspace. */
export function McpUsageOverview({ from, to }: { from: string; to: string }) {
  const usage = useQuery(api.mcpUsage.usageOverview, { from, to });
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">MCP (AI assistants)</h2>
        <p className="text-xs text-muted-foreground">Tool calls per workspace. {DEPLOYMENT_NOTE}</p>
      </div>
      {usage === undefined ? (
        <Skeleton className="h-24 w-full" />
      ) : usage.tenants.length === 0 ? (
        <p className="text-sm text-muted-foreground">No MCP calls in this range.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Peak daily users</TableHead>
              <TableHead className="text-right">Active days</TableHead>
              <TableHead className="text-right">Failed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usage.tenants.map((row) => (
              <TableRow key={row.clerkOrgId}>
                <TableCell className="max-w-0 truncate">
                  <Link href={`/usage/${row.clerkOrgId}`} className="hover:underline">
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.calls}</TableCell>
                <TableCell className="text-right tabular-nums">{row.peakDailyUsers}</TableCell>
                <TableCell className="text-right tabular-nums">{row.activeDays}</TableCell>
                <TableCell className="text-right tabular-nums">{row.failures}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {usage?.capped && <p className="text-xs text-muted-foreground">Today&rsquo;s figures cover the most recent calls only.</p>}
    </section>
  );
}

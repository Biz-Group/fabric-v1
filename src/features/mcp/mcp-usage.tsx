"use client";

import { Activity, AlertTriangle, CalendarDays, Users } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/features/admin/stat-card";

/**
 * Shared views of Fabric MCP usage (Phase 3, B2: calls and users, no price),
 * used by the tenants console and by Admin → MCP.
 */

export type McpDay = { period: string; calls: number; failures: number; users: number };

export type McpTotals = {
  calls: number;
  failures: number;
  peakDailyUsers: number;
  activeDays: number;
  tools: Array<{ tool: string; calls: number; failures: number }>;
  clients: Array<{ clientId: string; calls: number; label: string }>;
};

export function McpUsageStats({ totals, users }: { totals: McpTotals; users?: { label: string; value: number } }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Tool calls" value={totals.calls} icon={Activity} />
      <StatCard
        label={users?.label ?? "Peak daily users"}
        value={users?.value ?? totals.peakDailyUsers}
        icon={Users}
      />
      <StatCard label="Active days" value={totals.activeDays} icon={CalendarDays} />
      <StatCard
        label="Failed or refused"
        value={totals.failures}
        hint="Errors, bad arguments and rate limits"
        icon={AlertTriangle}
        tone={totals.calls > 0 && totals.failures / totals.calls > 0.1 ? "destructive" : "default"}
      />
    </div>
  );
}

/** Calls per day as a simple bar strip; each bar's tooltip gives the figures. */
export function McpDailyBars({ days }: { days: McpDay[] }) {
  const max = Math.max(1, ...days.map((day) => day.calls));
  return (
    <div className="space-y-2">
      <div className="flex h-24 items-end gap-0.5" role="img" aria-label="Tool calls per day">
        {days.map((day) => (
          <div
            key={day.period}
            title={`${day.period}: ${day.calls} calls, ${day.users} users${day.failures ? `, ${day.failures} failed` : ""}`}
            className="min-w-0 flex-1 rounded-t-sm bg-org-accent/70"
            style={{ height: `${Math.max(day.calls ? 4 : 1, (day.calls / max) * 100)}%`, opacity: day.calls ? 1 : 0.25 }}
          />
        ))}
      </div>
      {days.length > 0 && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{days[0].period}</span>
          <span>{days[days.length - 1].period}</span>
        </div>
      )}
    </div>
  );
}

export function McpBreakdownTables({ totals }: { totals: McpTotals }) {
  if (totals.calls === 0) return null;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">By tool</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Failed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {totals.tools.map((row) => (
              <TableRow key={row.tool}>
                <TableCell className="font-mono text-xs">{row.tool}</TableCell>
                <TableCell className="text-right tabular-nums">{row.calls}</TableCell>
                <TableCell className="text-right tabular-nums">{row.failures}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">By AI client</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead className="text-right">Calls</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {totals.clients.map((row) => (
              <TableRow key={row.clientId}>
                <TableCell className="max-w-0 truncate" title={row.clientId}>
                  {row.label}
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.calls}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

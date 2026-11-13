"use client";

import { useMutation, useQuery } from "convex/react";
import { Activity, AlertTriangle, Bot, Plug, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle } from "@/components/ui/page-title";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/features/admin/stat-card";
import { formatRelativeTime } from "@/features/home/home-view-model";
import { CopyField } from "@/features/mcp/connection-guide";
import { CopilotStudioCard } from "@/features/mcp/copilot-studio-card";
import { McpDailyBars } from "@/features/mcp/mcp-usage";
import { useWorkspaceRoutes } from "@/features/shell/use-workspace-routes";
import { utcRangeEndingToday } from "@/features/tenants-console/usage-format";
import { describeError } from "@/lib/user-error-message";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/**
 * Admin → MCP (docs/fabric-mcp-build-task-list.md): the workspace admin's
 * switch for the Fabric MCP server with the terms they accept (M1), the
 * contributions setting (M2), the connection URL, Copilot Studio credentials
 * (B7) and usage. Shown only when Fabric staff have granted the add-on (M6).
 */
export default function AdminMcpPage() {
  const settings = useQuery(api.mcpSettings.adminSettings);
  const setEnabled = useMutation(api.mcpSettings.setEnabled);
  const setConversationTools = useMutation(api.mcpSettings.setConversationTools);
  const routes = useWorkspaceRoutes();
  const [termsOpen, setTermsOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      return true;
    } catch (error) {
      toast.error(describeError(error, "That didn't work. Try again."));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (settings === undefined) return <Skeleton className="h-64 w-full" />;
  if (!settings.granted) {
    return (
      <EmptyState
        icon={Bot}
        title="MCP isn't part of this workspace's plan"
        description="Contact Fabric to connect AI assistants such as Claude or Microsoft Copilot Studio to this workspace."
      />
    );
  }

  const outdatedTerms = settings.enabled && settings.acceptedPolicyVersion !== settings.policy.version;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <PageTitle render={<h2 />}>Model Context Protocol (MCP)</PageTitle>
            <Badge variant={settings.enabled ? "default" : "outline"}>{settings.enabled ? "On" : "Off"}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {settings.enabled ? (
              <>
                {settings.enabledByStaff ? "Enabled by Fabric staff" : "Switched on"}
                {settings.enabledByName ? ` by ${settings.enabledByName}` : ""}
                {settings.enabledAt ? ` on ${dateFormat.format(settings.enabledAt)}` : ""} · Terms{" "}
                {settings.acceptedPolicyVersion ?? "not recorded"}
              </>
            ) : (
              "Let members ask AI assistants about this workspace, seeing only what they can see in Fabric."
            )}
          </p>
        </div>
        {settings.enabled ? (
          <Button variant="outline" disabled={busy} onClick={() => setConfirmOff(true)}>
            Switch off
          </Button>
        ) : (
          <Button disabled={busy} onClick={() => setTermsOpen(true)}>
            Switch on…
          </Button>
        )}
      </div>

      {outdatedTerms && (
        <p className="rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-sm">
          The terms have changed since they were accepted. Switch off and on again to accept the current version.
        </p>
      )}

      {settings.enabled && (
        <>
          <WorkspaceUsage />

          <div className="grid gap-6 xl:grid-cols-2">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Connection</CardTitle>
                  <CardDescription>
                    Members add this URL to Claude or another MCP client and sign in with Fabric. Setup steps are on{" "}
                    <Link href={routes.connectHref} className="underline underline-offset-2">
                      Connect AI assistants
                    </Link>
                    .
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {settings.workspaceUrl && <CopyField label="Connection URL" value={settings.workspaceUrl} />}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>What assistants can read</CardTitle>
                  <CardDescription>Overviews, process flows, signals, systems, coverage and Fabric help.</CardDescription>
                </CardHeader>
                <CardContent>
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={settings.conversationTools}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        run(
                          () => setConversationTools({ enabled: checked === true }),
                          checked === true ? "Contributions are now available to assistants." : "Contributions are no longer available to assistants.",
                        )
                      }
                      className="mt-0.5"
                    />
                    <span>
                      Also individual contributions
                      <span className="block text-xs text-muted-foreground">
                        Transcripts and what each contributor said, including their names.
                      </span>
                    </span>
                  </label>
                </CardContent>
              </Card>
            </div>

            <CopilotStudioCard />
          </div>
        </>
      )}

      <Dialog
        open={termsOpen}
        onOpenChange={(open) => {
          setTermsOpen(open);
          if (!open) setAccepted(false);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{settings.policy.title}</DialogTitle>
            <DialogDescription>Read and accept these terms to switch MCP on for this workspace.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-[50vh] list-disc space-y-2 overflow-y-auto pl-4 text-sm text-muted-foreground">
            {settings.policy.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={accepted} onCheckedChange={(checked) => setAccepted(checked === true)} className="mt-0.5" />
            <span>{settings.policy.acceptance}</span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTermsOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!accepted || busy}
              onClick={async () => {
                const ok = await run(
                  () => setEnabled({ enabled: true, acceptedPolicyVersion: settings.policy.version }),
                  "MCP is on.",
                );
                if (ok) {
                  setTermsOpen(false);
                  setAccepted(false);
                }
              }}
            >
              Switch on
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title="Switch off MCP?"
        description="Connected assistants lose access immediately. Switching it on again needs the terms accepted again."
        confirmLabel="Switch off"
        destructive
        onConfirm={async () => {
          await run(() => setEnabled({ enabled: false, acceptedPolicyVersion: null }), "MCP is off.");
        }}
      />
    </div>
  );
}

/** Usage over the last 30 days (Phase 3): tiles, daily calls, members, assistants and tools. */
function WorkspaceUsage() {
  const [range] = useState(() => utcRangeEndingToday(30));
  const usage = useQuery(api.mcpUsage.workspaceUsage, range);
  const totals = usage?.totals;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Tool calls, 30 days" value={totals?.calls} icon={Activity} />
        <StatCard label="Active members" value={usage?.activeMembers} icon={Users} />
        <StatCard label="Assistants used" value={totals?.clients.length} icon={Plug} />
        <StatCard
          label="Failed or refused"
          value={totals?.failures}
          hint="Errors, bad arguments and rate limits"
          icon={AlertTriangle}
          tone={totals && totals.calls > 0 && totals.failures / totals.calls > 0.1 ? "destructive" : "default"}
        />
      </div>

      {usage && totals && totals.calls > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <CardDescription>The last 30 days. Fabric records which tool was used and when, never what was asked.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <McpDailyBars days={usage.byDay} />
            <div className="grid gap-6 lg:grid-cols-3">
              <UsageTable
                title="By member"
                headers={["Member", "Calls", "Last used"]}
                rows={usage.members.map((m) => ({ key: m.userId, cells: [m.name, m.calls, formatRelativeTime(m.lastAt)] }))}
              />
              <UsageTable
                title="By assistant"
                headers={["Assistant", "Calls"]}
                rows={totals.clients.map((c) => ({ key: c.clientId, cells: [c.label, c.calls] }))}
              />
              <UsageTable
                title="By tool"
                headers={["Tool", "Calls", "Failed"]}
                rows={totals.tools.map((t) => ({ key: t.tool, cells: [t.tool, t.calls, t.failures] }))}
              />
            </div>
            {usage.capped && <p className="text-xs text-muted-foreground">Figures cover the most recent calls only.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function UsageTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: Array<{ key: string; cells: Array<string | number> }>;
}) {
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((header, i) => (
              <TableHead key={header} className={i > 0 ? "text-right" : undefined}>
                {header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              {row.cells.map((cell, i) => (
                <TableCell
                  key={i}
                  className={i === 0 ? "max-w-0 truncate" : `text-right tabular-nums${typeof cell === "string" ? " text-muted-foreground" : ""}`}
                  title={i === 0 ? String(cell) : undefined}
                >
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

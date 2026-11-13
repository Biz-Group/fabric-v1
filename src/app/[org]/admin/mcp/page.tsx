"use client";

import { useMutation, useQuery } from "convex/react";
import { Bot } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle } from "@/components/ui/page-title";
import { Skeleton } from "@/components/ui/skeleton";
import { ConnectionGuide } from "@/features/mcp/connection-guide";
import { CopilotStudioCard } from "@/features/mcp/copilot-studio-card";
import { McpBreakdownTables, McpDailyBars, McpUsageStats } from "@/features/mcp/mcp-usage";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRelativeTime } from "@/features/home/home-view-model";
import { utcRangeEndingToday } from "@/features/tenants-console/usage-format";
import { describeError } from "@/lib/user-error-message";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/**
 * Admin → MCP (docs/fabric-mcp-build-task-list.md, Phase 2): the
 * workspace admin's switch for the Fabric MCP server, with the terms they
 * accept (M1), the conversation-tools toggle (M2) and the connection URLs.
 * Shown only when Fabric staff have granted the add-on (M6).
 */
export default function AdminMcpPage() {
  const settings = useQuery(api.mcpSettings.adminSettings);
  const setEnabled = useMutation(api.mcpSettings.setEnabled);
  const setConversationTools = useMutation(api.mcpSettings.setConversationTools);
  const [accepted, setAccepted] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(done);
    } catch (error) {
      toast.error(describeError(error, "That didn't work. Try again."));
    } finally {
      setBusy(false);
    }
  };

  if (settings === undefined) return <Skeleton className="h-64 w-full" />;
  if (!settings.granted) {
    return (
      <EmptyState
        icon={Bot}
        title="AI assistant access isn't part of this workspace's plan"
        description="Contact Fabric to connect assistants like Claude or Microsoft Copilot to this workspace."
      />
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <PageTitle render={<h2 />}>Model Context Protocol (MCP)</PageTitle>
        <p className="text-sm text-muted-foreground">
          Let members ask Claude or Microsoft Copilot about this workspace. Each member sees only what they can already see
          in Fabric.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Access</CardTitle>
            <Badge variant={settings.enabled ? "default" : "outline"}>{settings.enabled ? "On" : "Off"}</Badge>
          </div>
          {settings.enabled && (
            <CardDescription>
              {settings.enabledByStaff ? "Enabled by Fabric staff" : "Switched on"}
              {settings.enabledByName ? ` (${settings.enabledByName})` : ""}
              {settings.enabledAt ? ` on ${dateFormat.format(settings.enabledAt)}` : ""}.
              {settings.acceptedPolicyVersion && settings.acceptedPolicyVersion !== settings.policy.version
                ? " The terms have changed since; switch off and on again to accept the current version."
                : ""}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {settings.enabled ? (
            <Button variant="outline" disabled={busy} onClick={() => setConfirmOff(true)}>
              Switch off
            </Button>
          ) : (
            <>
              <section className="space-y-2 rounded-md border bg-muted/30 p-4">
                <h3 className="text-sm font-semibold">{settings.policy.title}</h3>
                <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                  {settings.policy.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </section>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={accepted} onCheckedChange={(checked) => setAccepted(checked === true)} className="mt-0.5" />
                <span>{settings.policy.acceptance}</span>
              </label>
              <Button
                disabled={!accepted || busy}
                onClick={() =>
                  run(
                    () => setEnabled({ enabled: true, acceptedPolicyVersion: settings.policy.version }),
                    "AI assistant access is on.",
                  )
                }
              >
                Switch on
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {settings.enabled && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>What assistants can read</CardTitle>
              <CardDescription>
                Overviews, process flows, signals, systems, coverage and Fabric help are always available.
              </CardDescription>
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
                  Also allow individual contributions: transcripts and what each contributor said.
                  <span className="block text-xs text-muted-foreground">
                    These carry contributors&rsquo; own words and names, so they leave Fabric when an assistant reads them.
                  </span>
                </span>
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Connect an assistant</CardTitle>
              <CardDescription>Members also find these under Help → Connect AI assistants.</CardDescription>
            </CardHeader>
            <CardContent>
              <ConnectionGuide workspaceUrl={settings.workspaceUrl} />
            </CardContent>
          </Card>

          <CopilotStudioCard />
        </>
      )}

      <WorkspaceUsageCard />

      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title="Switch off AI assistant access?"
        description="Connected assistants lose access immediately. Switching it on again needs the terms accepted again."
        confirmLabel="Switch off"
        destructive
        onConfirm={() => run(() => setEnabled({ enabled: false, acceptedPolicyVersion: null }), "AI assistant access is off.")}
      />
    </div>
  );
}

/** This workspace's MCP use over the last 30 days (Phase 3), shown once there is any. */
function WorkspaceUsageCard() {
  const [range] = useState(() => utcRangeEndingToday(30));
  const usage = useQuery(api.mcpUsage.workspaceUsage, range);
  if (!usage || usage.totals.calls === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage</CardTitle>
        <CardDescription>Tool calls from AI assistants over the last 30 days. What members asked isn&rsquo;t recorded.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <McpUsageStats totals={usage.totals} users={{ label: "Active members", value: usage.activeMembers }} />
        <McpDailyBars days={usage.byDay} />
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">By member</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Last used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.members.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell className="max-w-0 truncate">{member.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{member.calls}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatRelativeTime(member.lastAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
        <McpBreakdownTables totals={usage.totals} />
        {usage.capped && <p className="text-xs text-muted-foreground">Figures cover the most recent calls only.</p>}
      </CardContent>
    </Card>
  );
}

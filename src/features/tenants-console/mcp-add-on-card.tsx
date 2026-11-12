"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/lib/user-error-message";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/**
 * The AI assistants (Fabric MCP) add-on for one workspace (M6). Fabric staff
 * grant or revoke it here; the workspace's own admin then switches it on and
 * accepts the terms under Admin → MCP.
 */
export function McpAddOnCard({ tenantId }: { tenantId: Id<"tenants"> }) {
  const addOn = useQuery(api.mcpSettings.tenantAddOn, { tenantId });
  const setGranted = useMutation(api.mcpSettings.setGranted);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [busy, setBusy] = useState(false);

  const update = async (granted: boolean) => {
    setBusy(true);
    try {
      await setGranted({ tenantId, granted });
      toast.success(granted ? "AI assistants add-on granted." : "AI assistants add-on revoked.");
    } catch (error) {
      toast.error(describeError(error, "Couldn't update the add-on."));
    } finally {
      setBusy(false);
    }
  };

  const status = !addOn
    ? null
    : !addOn.granted
      ? { label: "Not granted", variant: "outline" as const }
      : addOn.enabled
        ? { label: "On", variant: "default" as const }
        : { label: "Granted, switched off", variant: "secondary" as const };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>AI assistants (MCP)</CardTitle>
          {status && <Badge variant={status.variant}>{status.label}</Badge>}
        </div>
        <CardDescription>
          A paid add-on. Once granted, the workspace&rsquo;s admin switches it on and accepts the terms under Admin → MCP.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {addOn === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : addOn === null ? null : (
          <>
            {!addOn.deploymentAllows && (
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                The MCP server is switched off for this workspace on this deployment (FABRIC_MCP), so nothing here takes
                effect yet.
              </p>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {addOn.granted && (
                <>
                  <dt className="text-muted-foreground">Granted</dt>
                  <dd>
                    {addOn.grantedAt ? dateFormat.format(addOn.grantedAt) : "Yes"}
                    {addOn.grantedByName ? ` by ${addOn.grantedByName}` : ""}
                  </dd>
                </>
              )}
              {addOn.enabled && (
                <>
                  <dt className="text-muted-foreground">Switched on</dt>
                  <dd>
                    {addOn.enabledAt ? dateFormat.format(addOn.enabledAt) : "Yes"}
                    {addOn.enabledByName ? ` by ${addOn.enabledByName}` : ""}
                    {addOn.enabledByStaff ? " (Fabric staff)" : ""}
                  </dd>
                  <dt className="text-muted-foreground">Contributions</dt>
                  <dd>{addOn.conversationTools ? "Available to assistants" : "Not available"}</dd>
                </>
              )}
            </dl>
            {addOn.granted ? (
              <Button variant="outline" disabled={busy} onClick={() => setConfirmRevoke(true)}>
                Revoke add-on
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => update(true)}>
                Grant add-on
              </Button>
            )}
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title="Revoke the AI assistants add-on?"
        description="Connected assistants lose access immediately. If you grant it again, the workspace's admin must switch it on and accept the terms again."
        confirmLabel="Revoke"
        destructive
        onConfirm={() => update(false)}
      />
    </Card>
  );
}

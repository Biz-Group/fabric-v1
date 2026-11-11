"use client";

import { useMutation, useQuery } from "convex/react";
import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
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
import { describeError } from "@/lib/user-error-message";

/**
 * Workspace export in the tenants console (docs/client-offboarding-plan.md,
 * Phase 2): prepare a zip of everything the client owns, then download it
 * and send it on. Links last 7 days.
 */

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDateTime(ts: number) {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function WorkspaceExportCard({ tenantId }: { tenantId: Id<"tenants"> }) {
  const exports = useQuery(api.workspaceExport.listExports, { tenantId });
  const startExport = useMutation(api.workspaceExport.startExport);
  const discardExport = useMutation(api.workspaceExport.discardExport);
  const [starting, setStarting] = useState(false);
  const [discardId, setDiscardId] = useState<Id<"tenantExports"> | null>(null);

  const running = exports?.find((row) => row.status === "running" && !row.stale);

  const handleStart = async () => {
    setStarting(true);
    try {
      await startExport({ tenantId });
      toast.success("Preparing the export. This page updates when it's ready.");
    } catch (err) {
      toast.error(describeError(err, "The export couldn't be started."));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export data</CardTitle>
        <CardDescription>
          A zip of everything the client owns: every interview with its
          transcript and recording, process overviews, maps and
          recommendations, and the member list, as readable files and as
          JSON. AskFabric chats aren&apos;t included; they&apos;re private to
          each member. Download links last 7 days.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={() => void handleStart()} disabled={starting || !!running || exports === undefined}>
          {running ? "Preparing export…" : starting ? "Starting…" : "Prepare export"}
        </Button>

        {exports && exports.length > 0 && (
          <ul className="divide-y rounded-md border text-sm">
            {exports.map((row) => (
              <li key={row.exportId} className="space-y-2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{formatDateTime(row.createdAt)}</span>
                  <span className="text-muted-foreground">by {row.requestedByName}</span>
                  {row.status === "running" && !row.stale && (
                    <Badge tone="info">
                      {row.phase === "audio"
                        ? `Collecting recordings (${row.audioIncluded} so far)`
                        : "Writing files"}
                    </Badge>
                  )}
                  {row.stale && <Badge tone="warning">Stopped responding</Badge>}
                  {row.status === "ready" && <Badge tone="success">Ready</Badge>}
                  {row.status === "failed" && <Badge tone="destructive">Failed</Badge>}
                  {row.status === "expired" && <Badge tone="neutral">Expired</Badge>}
                </div>

                {row.status === "failed" && row.error && (
                  <p className="text-xs text-destructive">{row.error}</p>
                )}

                {row.status === "ready" && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {row.audioIncluded} recording(s) included
                      {row.audioMissing > 0 && `, ${row.audioMissing} unavailable (see audio-index.csv)`}
                      {row.expiresAt && `. Links expire ${formatDateTime(row.expiresAt)}.`}
                    </p>
                    <ul className="space-y-1">
                      {row.files.map((file) => (
                        <li key={file.name} className="flex items-center gap-2">
                          {file.url ? (
                            <a
                              href={file.url}
                              download={file.name}
                              className="inline-flex items-center gap-1.5 font-mono text-xs hover:underline"
                            >
                              <Download className="size-3.5" aria-hidden="true" />
                              {file.name}
                            </a>
                          ) : (
                            <span className="font-mono text-xs text-muted-foreground">{file.name}</span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {formatBytes(file.sizeBytes)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <Button size="sm" variant="outline" onClick={() => setDiscardId(row.exportId)}>
                      Delete files now
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <ConfirmDialog
          open={discardId !== null}
          onOpenChange={(open) => {
            if (!open) setDiscardId(null);
          }}
          title="Delete this export's files?"
          description="The download links stop working. The workspace's own data isn't touched."
          confirmLabel="Delete files"
          destructive
          onConfirm={async () => {
            if (!discardId) return;
            try {
              await discardExport({ exportId: discardId });
              toast.success("Export files deleted.");
            } catch (err) {
              toast.error(describeError(err, "The files couldn't be deleted."));
              throw err;
            }
          }}
        />
      </CardContent>
    </Card>
  );
}

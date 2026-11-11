"use client";

import { useQuery } from "convex/react";
import { Trash2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { conversationStatusMeta } from "@/features/status/status-meta";

const TYPE_LABEL = {
  agent: "AI interview",
  voiceRecord: "Voice note",
  audioUpload: "Uploaded recording",
} as const;

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Admin-only. The workspace's last 50 deleted contributions and why each was
 * deleted (D7 in docs/move-contribution-task-list.md).
 */
export function DeletedContributionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const log = useQuery(api.conversations.deletionLogForAdmin, open ? {} : "skip");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Deleted contributions</DialogTitle>
          <DialogDescription>
            The last 50 contributions deleted in this workspace, who deleted
            them and why.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {log === undefined ? (
            <div role="status" className="space-y-3">
              <span className="sr-only">Loading deleted contributions</span>
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="space-y-2 rounded-md border p-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ))}
            </div>
          ) : log.length === 0 ? (
            <EmptyState
              icon={Trash2}
              title="Nothing deleted yet"
              description="When an admin deletes a contribution, it's listed here with the reason they gave."
              className="min-h-48"
            />
          ) : (
            <ul className="space-y-3">
              {log.map((entry) => {
                const type = TYPE_LABEL[entry.inputMode];
                return (
                  <li key={entry._id} className="space-y-1.5 rounded-md border p-3">
                    <p className="text-sm font-medium break-words">
                      {entry.title ?? `${type} with ${entry.contributorName}`}
                    </p>
                    <p className="text-xs text-muted-foreground break-words">
                      {entry.contributorName} · {type} · recorded{" "}
                      {formatDate(entry.recordedAt)} ·{" "}
                      {conversationStatusMeta[entry.status].label.toLowerCase()} when
                      deleted
                    </p>
                    <p className="text-xs text-muted-foreground break-words">
                      {entry.processLabel}
                    </p>
                    <p className="text-sm break-words">
                      <span className="text-muted-foreground">
                        Deleted by {entry.actorName}, {formatDate(entry.createdAt)}:
                      </span>{" "}
                      “{entry.reason}”
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

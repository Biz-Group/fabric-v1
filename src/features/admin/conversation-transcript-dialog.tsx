"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowUpRight, Tag } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConversationFailureNotice } from "@/features/conversations/conversation-failure-notice";
import { useWorkspaceRoutes } from "@/features/shell/use-workspace-routes";
import { processConversationHref } from "@/features/workbench/use-selection-params";
import { StatusBadge } from "@/features/status/status-badge";
import { conversationStatusMeta } from "@/features/status/status-meta";

type TranscriptMessage = {
  role: string;
  content: string;
  speakerName?: string;
};

function transcriptSpeakerName(
  msg: TranscriptMessage,
  contributorName: string,
): string {
  return msg.speakerName ?? (msg.role === "user" ? contributorName : "Agent");
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ConversationTranscriptDialog({
  conversationId,
  open,
  onOpenChange,
}: {
  conversationId: Id<"conversations"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const routes = useWorkspaceRoutes();
  const conversation = useQuery(
    api.conversations.getForAdmin,
    conversationId ? { conversationId } : "skip",
  );
  const processHref = conversation
    ? processConversationHref(routes.appHref, conversation)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {conversation?.contributorName ?? "Contribution"}
          </DialogTitle>
          <DialogDescription>
            {conversation
              ? [
                  formatDateTime(conversation._creationTime),
                  formatDuration(conversation.durationSeconds),
                  // Only present when an admin filed this for someone else; the
                  // dialog is titled with the contributor's name, so an admin
                  // auditing the record needs to see who actually submitted it.
                  conversation.submittedByName
                    ? `Submitted by ${conversation.submittedByName}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {conversation === undefined && (
          // The description above already says "Loading…".
          <div className="space-y-4" aria-hidden="true">
            <Skeleton className="h-5 w-24 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
            <Skeleton className="h-28 w-full" />
          </div>
        )}

        {conversation && (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="flex items-center gap-2">
              <StatusBadge meta={conversationStatusMeta[conversation.status]} />
            </div>

            {conversation.status === "failed" && (
              <ConversationFailureNotice conversation={conversation} canRetry />
            )}

            {conversation.summary && (
              <section className="space-y-1">
                <SectionLabel render={<h3 />}>Summary</SectionLabel>
                <p className="text-sm whitespace-pre-wrap">
                  {conversation.summary}
                </p>
              </section>
            )}

            {conversation.transcript && conversation.transcript.length > 0 ? (
              <section className="space-y-2">
                <SectionLabel render={<h3 />}>Transcript</SectionLabel>
                <div className="space-y-2 rounded-md border p-3">
                  {conversation.transcript.map((msg, i) => (
                    <div
                      key={i}
                      className={
                        msg.role === "user"
                          ? "text-sm"
                          : "text-sm text-muted-foreground"
                      }
                    >
                      <span className="mr-1.5 text-xs font-medium uppercase">
                        {transcriptSpeakerName(
                          msg as TranscriptMessage,
                          conversation.contributorName,
                        )}
                      </span>
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              <p className="text-sm text-muted-foreground">
                No transcript available.
              </p>
            )}
          </div>
        )}

        {conversation && processHref && (
          <DialogFooter>
            {conversation.status === "needs_speaker_labels" ? (
              <Button render={<Link href={processHref} />}>
                <Tag />
                Label speakers
              </Button>
            ) : (
              <Button variant="outline" render={<Link href={processHref} />}>
                <ArrowUpRight />
                Open in process
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

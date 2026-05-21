"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AudioLines, CheckCircle2, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useConversationAudioUrl } from "@/hooks/use-conversation-audio-url";

type TranscriptMessage = {
  role: string;
  content: string;
  time_in_call_secs: number;
  speakerId?: string;
  speakerName?: string;
};

type SpeakerLabel = {
  speakerId: string;
  displayName: string;
  userId?: Id<"users">;
};

type SpeakerDraft = {
  displayName: string;
  userId: Id<"users"> | null;
};

type SpeakerRow = {
  speakerId: string;
  defaultName: string;
  samples: string[];
};

function buildSpeakerRows(
  transcript: TranscriptMessage[] | undefined,
  speakerLabels: SpeakerLabel[] | undefined,
): SpeakerRow[] {
  const rows: SpeakerRow[] = [];
  const byId = new Map<string, SpeakerRow>();
  for (const label of speakerLabels ?? []) {
    const row = {
      speakerId: label.speakerId,
      defaultName: label.displayName,
      samples: [],
    };
    byId.set(label.speakerId, row);
    rows.push(row);
  }

  for (const msg of transcript ?? []) {
    const speakerId = msg.speakerId ?? "speaker_0";
    let row = byId.get(speakerId);
    if (!row) {
      row = {
        speakerId,
        defaultName: msg.speakerName ?? `Speaker ${rows.length + 1}`,
        samples: [],
      };
      byId.set(speakerId, row);
      rows.push(row);
    }
    if (row.samples.length < 2 && msg.content.trim()) {
      row.samples.push(msg.content.trim());
    }
  }

  if (rows.length === 0 && transcript && transcript.length > 0) {
    rows.push({
      speakerId: "speaker_0",
      defaultName: "Speaker 1",
      samples: transcript.slice(0, 2).map((msg) => msg.content),
    });
  }

  return rows;
}

export function SpeakerLabelReview({
  conversation,
  className,
  onSubmitted,
}: {
  conversation: Doc<"conversations">;
  className?: string;
  onSubmitted?: () => void;
}) {
  const transcript = conversation.transcript as TranscriptMessage[] | undefined;
  const speakerLabels = conversation.speakerLabels as SpeakerLabel[] | undefined;
  const speakerRows = useMemo(
    () => buildSpeakerRows(transcript, speakerLabels),
    [transcript, speakerLabels],
  );
  const speakerSignature = speakerRows
    .map((row) => `${row.speakerId}:${row.defaultName}`)
    .join("|");

  if (!transcript || transcript.length === 0) {
    return (
      <div className={cn("rounded-lg border bg-muted/20 p-4", className)}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Preparing speaker review...
        </div>
      </div>
    );
  }

  return (
    <SpeakerLabelEditor
      key={`${conversation._id}:${speakerSignature}`}
      conversation={conversation}
      speakerRows={speakerRows}
      speakerLabels={speakerLabels}
      className={className}
      onSubmitted={onSubmitted}
    />
  );
}

function initialDraftsFor(
  speakerRows: SpeakerRow[],
  speakerLabels: SpeakerLabel[] | undefined,
): Record<string, SpeakerDraft> {
  const next: Record<string, SpeakerDraft> = {};
  for (const row of speakerRows) {
    const existing = speakerLabels?.find(
      (label) => label.speakerId === row.speakerId,
    );
    next[row.speakerId] = {
      displayName: existing?.displayName ?? row.defaultName,
      userId: existing?.userId ?? null,
    };
  }
  return next;
}

function SpeakerLabelEditor({
  conversation,
  speakerRows,
  speakerLabels,
  className,
  onSubmitted,
}: {
  conversation: Doc<"conversations">;
  speakerRows: SpeakerRow[];
  speakerLabels: SpeakerLabel[] | undefined;
  className?: string;
  onSubmitted?: () => void;
}) {
  const members = useQuery(api.users.listOrgMemberOptions);
  const submitSpeakerLabels = useMutation(
    api.voiceRecordings.submitSpeakerLabels,
  );
  const audioUrl = useConversationAudioUrl(
    conversation.clerkOrgId,
    conversation._id,
  );
  const [drafts, setDrafts] = useState<Record<string, SpeakerDraft>>(() =>
    initialDraftsFor(speakerRows, speakerLabels),
  );
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    speakerRows.length > 0 &&
    speakerRows.every((row) => drafts[row.speakerId]?.displayName.trim());

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await submitSpeakerLabels({
        conversationId: conversation._id,
        labels: speakerRows.map((row) => {
          const draft = drafts[row.speakerId];
          const displayName = draft.displayName.trim();
          return draft.userId
            ? { speakerId: row.speakerId, displayName, userId: draft.userId }
            : { speakerId: row.speakerId, displayName };
        }),
      });
      toast.success("Speaker labels saved. Analysis is running.");
      onSubmitted?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save labels.";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={cn("space-y-4 rounded-lg border bg-background p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Name the speakers</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            These names will be used in the transcript, summary, and process
            analysis.
          </p>
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <UserRound className="h-4 w-4" />
        </div>
      </div>

      {audioUrl && (
        <div className="space-y-2 rounded-md bg-muted/35 p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <AudioLines className="h-3.5 w-3.5" />
            Recording audio
          </div>
          <audio controls src={audioUrl} className="h-9 w-full" />
        </div>
      )}

      <div className="space-y-3">
        {speakerRows.map((row) => {
          const draft = drafts[row.speakerId] ?? {
            displayName: row.defaultName,
            userId: null,
          };
          return (
            <div key={row.speakerId} className="rounded-md border p-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px]">
                <div className="space-y-1.5">
                  <label
                    htmlFor={`speaker-${conversation._id}-${row.speakerId}`}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {row.defaultName}
                  </label>
                  <Input
                    id={`speaker-${conversation._id}-${row.speakerId}`}
                    value={draft.displayName}
                    onChange={(event) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [row.speakerId]: {
                          ...draft,
                          displayName: event.target.value,
                        },
                      }))
                    }
                    placeholder="Speaker name"
                  />
                </div>
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Member
                  </span>
                  <Select
                    value={draft.userId ?? "none"}
                    onValueChange={(value) => {
                      if (value === "none") {
                        setDrafts((prev) => ({
                          ...prev,
                          [row.speakerId]: { ...draft, userId: null },
                        }));
                        return;
                      }
                      const member = members?.find((m) => m.userId === value);
                      setDrafts((prev) => ({
                        ...prev,
                        [row.speakerId]: {
                          displayName: member?.name ?? draft.displayName,
                          userId: value as Id<"users">,
                        },
                      }));
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Optional" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No linked member</SelectItem>
                      {(members ?? []).map((member) => (
                        <SelectItem key={member.userId} value={member.userId}>
                          {member.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {row.samples.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {row.samples.map((sample, index) => (
                    <p
                      key={`${row.speakerId}-${index}`}
                      className="line-clamp-2 rounded-md bg-muted/35 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
                    >
                      {sample}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="gap-2"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          Save and Analyze
        </Button>
      </div>
    </div>
  );
}

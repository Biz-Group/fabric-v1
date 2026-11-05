"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { Bot, Mic, Upload, type LucideIcon } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { AskDisplayPart } from "../../../../convex/lib/askSchema";
import { canContribute } from "../../../../convex/lib/roles";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RecordingModal, type RecordingMode } from "@/features/recording/recording-modal";

const ACTIONS: Array<{ mode: RecordingMode; label: string; icon: LucideIcon }> = [
  { mode: "agent", label: "Start AI interview", icon: Bot },
  { mode: "voiceRecord", label: "Record a voice note", icon: Mic },
  { mode: "audioUpload", label: "Upload files", icon: Upload },
];

/** Why the card is shown, from the process's live count. */
export function thinEvidenceLine(done: number): string {
  if (done === 0) return "No contributions yet.";
  return done === 1 ? "Only 1 contribution so far." : `Only ${done} contributions so far.`;
}

/**
 * The contribute card (FR-11.5, D11): the three ways to add a contribution to
 * a thinly covered process, opening the same recording flow as the workbench.
 * The server stores it only for contributors and admins; the role is checked
 * again here, so a stored card never shows to someone who can't use it.
 */
export function ContributeCard({ part }: { part: AskDisplayPart }) {
  const membership = useQuery(api.users.getMyMembership);
  const allowed = canContribute(membership?.role);
  const processId = part.refs.find((ref) => ref.kind === "process")?.id as Id<"processes"> | undefined;
  const workbench = useQuery(api.processes.getWorkbench, allowed && processId ? { processId } : "skip");
  const [mode, setMode] = useState<RecordingMode | null>(null);
  const [open, setOpen] = useState(false);

  if (!allowed || !processId || workbench === null) return null;
  if (workbench === undefined) return <Skeleton className="h-28 w-full rounded-lg" />;

  const safe = (text: string | null, status: string | null) => (status === "safe" ? (text ?? undefined) : undefined);
  return (
    <section
      aria-label={`Add a contribution to ${workbench.process.name}`}
      className="flex flex-col gap-3 rounded-lg border border-org-accent-border bg-org-accent-subtle/60 p-3"
    >
      <div className="space-y-0.5">
        <p className="text-sm font-semibold text-foreground">Help fill in {workbench.process.name}</p>
        <p className="text-xs text-muted-foreground">
          {thinEvidenceLine(workbench.conversationCounts.done)} Each contribution makes the answers here more reliable.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((action) => (
          <Button
            key={action.mode}
            type="button"
            variant="outline"
            className="bg-background"
            onClick={() => {
              setMode(action.mode);
              setOpen(true);
            }}
          >
            <action.icon className="size-4" aria-hidden />
            {action.label}
          </Button>
        ))}
      </div>
      {/* Mounted once a flow is chosen, then kept, so closing can animate. */}
      {mode && (
        <RecordingModal
          open={open}
          onOpenChange={setOpen}
          processId={processId}
          processName={workbench.process.name}
          functionName={workbench.function.name}
          departmentName={workbench.department.name}
          departmentDescription={safe(workbench.department.description, workbench.department.descriptionSafetyStatus)}
          processDescription={safe(workbench.process.description, workbench.process.descriptionSafetyStatus)}
          mode={mode}
        />
      )}
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SectionLabel } from "@/components/ui/section-label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceRoutes } from "@/features/shell/use-workspace-routes";
import { processConversationHref } from "@/features/workbench/use-selection-params";
import { describeError } from "@/lib/user-error-message";

const MAX_NOTE_LENGTH = 500;

export type MovableContribution = {
  _id: Id<"conversations">;
  contributorName: string;
  processId: Id<"processes">;
};

/**
 * Admin-only. Moves a finished contribution to another process in the
 * workspace (docs/move-contribution-task-list.md). Only done rows are offered
 * the action; the server refuses anything else too.
 */
export function MoveContributionDialog({
  contribution,
  open,
  onOpenChange,
  onMoved,
}: {
  contribution: MovableContribution | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs after a successful move, before the dialog closes. */
  onMoved?: (conversationId: Id<"conversations">) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {contribution && (
          // Keyed so a different row starts from a clean pick and note.
          <MoveContributionForm
            key={contribution._id}
            contribution={contribution}
            onDone={() => {
              onMoved?.(contribution._id);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MoveContributionForm({
  contribution,
  onDone,
}: {
  contribution: MovableContribution;
  /** Called only after a successful move. */
  onDone: () => void;
}) {
  const router = useRouter();
  const routes = useWorkspaceRoutes();
  const [targetId, setTargetId] = useState<Id<"processes"> | null>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const move = useMutation(api.conversations.moveForAdmin);

  const impact = useQuery(
    api.conversations.moveImpactForAdmin,
    targetId
      ? { conversationId: contribution._id, targetProcessId: targetId }
      : "skip",
  );

  const handleMove = async () => {
    if (!targetId) return;
    setPending(true);
    try {
      const result = await move({
        conversationId: contribution._id,
        targetProcessId: targetId,
        note: note.trim() || undefined,
      });
      const href = processConversationHref(routes.appHref, {
        _id: contribution._id,
        processId: result.processId,
        departmentId: result.departmentId,
        functionId: result.functionId,
      });
      toast.success(
        `Moved to ${impact?.target.processName ?? "the new process"}.`,
        href
          ? { action: { label: "Open", onClick: () => router.push(href) } }
          : undefined,
      );
      onDone();
    } catch (err) {
      toast.error(describeError(err, "Couldn't move this contribution."));
    } finally {
      setPending(false);
    }
  };

  const noteTooLong = note.trim().length > MAX_NOTE_LENGTH;
  const canMove =
    targetId !== null &&
    impact !== undefined &&
    impact.blocker === null &&
    !noteTooLong &&
    !pending;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Move to another process</DialogTitle>
        <DialogDescription>
          Move {contribution.contributorName}&apos;s contribution. The overview
          and flow of both processes will be updated to match.
        </DialogDescription>
      </DialogHeader>

      {targetId === null ? (
        <ProcessPicker
          currentProcessId={contribution.processId}
          onPick={setTargetId}
        />
      ) : (
        <div className="space-y-4">
          <section className="space-y-1.5">
            <SectionLabel render={<h3 />}>Move to</SectionLabel>
            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <span className="min-w-0 text-sm">
                {impact ? (
                  impact.target.label
                ) : (
                  <Skeleton className="h-4 w-48" />
                )}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTargetId(null)}
                disabled={pending}
              >
                Change
              </Button>
            </div>
          </section>

          {impact === undefined ? (
            <div className="space-y-2" aria-hidden="true">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ) : impact.blocker ? (
            <p className="text-sm text-destructive">
              {impact.blocker === "not_done"
                ? "Only finished contributions can be moved. Finish labelling speakers or retry it first."
                : "This contribution is already in that process."}
            </p>
          ) : (
            <MoveImpactSummary impact={impact} />
          )}

          <section className="space-y-1.5">
            <label
              htmlFor="move-note"
              className="text-sm font-medium"
            >
              Reason <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              id="move-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Recorded under the wrong process"
              rows={2}
              aria-invalid={noteTooLong}
            />
            {noteTooLong && (
              <p className="text-xs text-destructive">
                Keep the reason under {MAX_NOTE_LENGTH} characters.
              </p>
            )}
          </section>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={handleMove} disabled={!canMove}>
          {pending ? "Moving…" : "Move"}
        </Button>
      </DialogFooter>
    </>
  );
}

type MoveImpact = FunctionReturnType<
  typeof api.conversations.moveImpactForAdmin
>;

function MoveImpactSummary({ impact }: { impact: MoveImpact }) {
  const sourceName = impact.source.processName ?? "the current process";
  const targetName = impact.target.processName;
  return (
    <div className="space-y-3">
      {impact.isAgentInterview && (
        <div className="flex gap-2 rounded-md border border-warning-border bg-warning-subtle p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            This interview was conducted about <strong>{sourceName}</strong>.
            The transcript will still refer to it.
          </p>
        </div>
      )}
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          {impact.source.outcome === "cleared"
            ? `This is the last finished contribution in ${sourceName}, so its overview and flow will be cleared.`
            : `${sourceName}'s overview and flow will be marked out of date. Rebuild them when you're ready.`}
        </li>
        <li>
          {impact.target.outcome === "generates"
            ? `This is ${targetName}'s first finished contribution, so its overview and flow will start building now.`
            : `${targetName}'s overview and flow will be marked out of date. Rebuild them when you're ready.`}
        </li>
      </ul>
    </div>
  );
}

/** Every other process in the workspace, grouped by function and department. */
function ProcessPicker({
  currentProcessId,
  onPick,
}: {
  currentProcessId: Id<"processes">;
  onPick: (processId: Id<"processes">) => void;
}) {
  const processes = useQuery(api.processes.listAll);
  const groups = useMemo(() => {
    const byGroup = new Map<
      string,
      { _id: Id<"processes">; name: string; search: string }[]
    >();
    for (const p of processes ?? []) {
      if (p._id === currentProcessId) continue;
      const heading = `${p.functionName} › ${p.departmentName}`;
      const list = byGroup.get(heading) ?? [];
      list.push({
        _id: p._id,
        name: p.name,
        search: `${p.name} ${p.departmentName} ${p.functionName} ${p._id}`,
      });
      byGroup.set(heading, list);
    }
    return [...byGroup.entries()];
  }, [processes, currentProcessId]);

  return (
    <Command className="rounded-md border">
      <CommandInput placeholder="Search processes…" autoFocus />
      <CommandList className="max-h-72">
        <CommandEmpty>
          {processes === undefined ? "Loading…" : "No other processes match."}
        </CommandEmpty>
        {groups.map(([heading, items]) => (
          <CommandGroup key={heading} heading={heading}>
            {items.map((p) => (
              <CommandItem
                key={p._id}
                value={p.search}
                onSelect={() => onPick(p._id)}
              >
                <span className="truncate">{p.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}

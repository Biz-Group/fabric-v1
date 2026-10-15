"use client";

import { useId, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { Check, ChevronDown, PartyPopper } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { describeError } from "@/lib/user-error-message";
import { InviteMemberDialog } from "@/features/admin/invite-member-dialog";
import type { ProcessTreeData } from "@/features/hierarchy/process-tree-navigator";
import type { RevealPath } from "@/features/workbench/reveal-path";
import { BuilderStep } from "./builder-step";
import {
  checklistSteps,
  type ChecklistStep,
  type ChecklistStepId,
  type MyOnboarding,
  type TreeProcessEntry,
} from "./onboarding-view-model";
import { TourDialog } from "./tour-dialog";

export type ProcessPath = Extract<RevealPath, { kind: "process" }>;

export type GettingStartedActions = {
  /** Show a new function or department in the tree, staying on Home. */
  onReveal: (path: RevealPath) => void;
  /** Open a process. `captureHint` points at its capture actions; `flow`
   * lands on the Process Flow tab. */
  onOpenProcess: (
    path: ProcessPath,
    options?: { captureHint?: boolean; tab?: "flow" },
  ) => void;
  /** Phones: switch Home to the Browse tab. */
  onSeeInTree?: () => void;
};

const STEP_TITLES: Record<ChecklistStepId, string> = {
  tour: "Watch the 2-minute tour",
  function: "Add your first function",
  department: "Add a department",
  process: "Add a process",
  contribution: "Capture your first contribution",
  invite: "Invite your teammates",
};

function processPath({ fn, department, process }: TreeProcessEntry): ProcessPath {
  return {
    kind: "process",
    functionId: fn._id,
    functionName: fn.name,
    departmentId: department._id,
    departmentName: department.name,
    processId: process._id,
    processName: process.name,
  };
}

function StepMarker({ step, index }: { step: ChecklistStep; index: number }) {
  if (step.state === "done") {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-org-accent text-org-accent-foreground">
        <Check className="size-3.5" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums",
        step.state === "current"
          ? "border-org-accent text-org-accent"
          : "text-muted-foreground",
      )}
      aria-hidden="true"
    >
      {index + 1}
    </span>
  );
}

type GettingStartedCardProps = {
  tree: ProcessTreeData;
  onboarding: MyOnboarding;
  mobile: boolean;
  actions: GettingStartedActions;
};

/**
 * The admin's checklist on Home: tour, Function → Department → Process with
 * an inline builder, the first contribution and its map, and invites. It
 * collapses to a slim bar once the tree exists, can be hidden (Help brings it
 * back), and retires after "You're set up" is closed.
 */
export function GettingStartedCard({
  tree,
  onboarding,
  mobile,
  actions,
}: GettingStartedCardProps) {
  const headingId = useId();
  const setChecklistHidden = useMutation(api.onboarding.setChecklistHidden);
  const markChecklistCompleted = useMutation(api.onboarding.markChecklistCompleted);
  const markHintSeen = useMutation(api.onboarding.markHintSeen);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const checklist = checklistSteps(tree, onboarding);
  const total = checklist.steps.length;
  // Open while there's still a tree to build; a slim bar after that, unless
  // the admin opens it.
  const open = expanded ?? !checklist.treeDone;

  const runMutation = (promise: Promise<unknown>, fallback: string) => {
    promise.catch((err: unknown) => toast.error(describeError(err, fallback)));
  };

  const handleCreated = (path: RevealPath) => {
    if (path.kind === "process") {
      actions.onOpenProcess(path, { captureHint: true });
    } else {
      actions.onReveal(path);
    }
  };

  const stepBody = (step: ChecklistStep): ReactNode => {
    switch (step.id) {
      case "tour":
        return (
          <div className="space-y-3">
            <p className="text-sm leading-6 text-muted-foreground">
              See how Fabric turns conversations about your work into process
              maps.
            </p>
            <Button type="button" size="sm" onClick={() => setTourOpen(true)}>
              Watch the tour
            </Button>
          </div>
        );
      case "function":
        return <BuilderStep kind="function" tree={tree} onCreated={handleCreated} />;
      case "department":
        return (
          <BuilderStep
            kind="department"
            tree={tree}
            defaultParentId={checklist.newestFunction?.fn._id}
            onCreated={handleCreated}
          />
        );
      case "process":
        return (
          <BuilderStep
            kind="process"
            tree={tree}
            defaultParentId={checklist.newestDepartment?.department._id}
            onCreated={handleCreated}
          />
        );
      case "contribution":
        if (checklist.contribution === "processing") {
          return (
            <p className="text-sm leading-6 text-muted-foreground" role="status">
              Fabric is turning your contribution into a process map. It takes a
              few minutes; this card will tell you when it&apos;s ready.
            </p>
          );
        }
        if (checklist.contribution === "mapReady" && checklist.mapProcess) {
          const mapProcess = checklist.mapProcess;
          return (
            <div className="space-y-3">
              <p className="text-sm font-medium" role="status">
                Your first process map is ready.
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  runMutation(
                    markHintSeen({ hint: "firstMap" }),
                    "Couldn't save your progress.",
                  );
                  actions.onOpenProcess(processPath(mapProcess), { tab: "flow" });
                }}
              >
                View it
              </Button>
            </div>
          );
        }
        return (
          <div className="space-y-3">
            <p className="text-sm leading-6 text-muted-foreground">
              Your first contribution turns into a process map. Start an AI
              interview, record a voice note, or upload a recording.
            </p>
            {checklist.newestProcess && (
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  checklist.newestProcess &&
                  actions.onOpenProcess(processPath(checklist.newestProcess), {
                    captureHint: true,
                  })
                }
              >
                Open {checklist.newestProcess.process.name}
              </Button>
            )}
          </div>
        );
      case "invite":
        return (
          <div className="space-y-3">
            <p className="text-sm leading-6 text-muted-foreground">
              Bring in the people who do the work. Each of them can add what
              they know.
            </p>
            <Button type="button" size="sm" onClick={() => setInviteOpen(true)}>
              Invite teammates
            </Button>
          </div>
        );
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      data-tour="getting-started"
      className="mt-8 scroll-mt-6 rounded-xl border bg-card"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
        <h2 id={headingId} className="text-base font-semibold tracking-tight">
          Getting started
        </h2>
        <span className="text-sm tabular-nums text-muted-foreground">
          {checklist.doneCount} of {total}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {!checklist.allDone && checklist.treeDone && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn("gap-1", mobile && "h-10")}
              aria-expanded={open}
              onClick={() => setExpanded(!open)}
            >
              {open ? "Show less" : "Continue"}
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform motion-reduce:transition-none",
                  open && "rotate-180",
                )}
                aria-hidden="true"
              />
            </Button>
          )}
          {!checklist.allDone && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn("text-muted-foreground", mobile && "h-10")}
              onClick={() =>
                runMutation(
                  setChecklistHidden({ hidden: true }),
                  "Couldn't hide Getting started.",
                )
              }
            >
              Hide
            </Button>
          )}
        </div>
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Getting started progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={checklist.doneCount}
        >
          <div
            className="h-full rounded-full bg-org-accent transition-[width] motion-reduce:transition-none"
            style={{ width: `${(checklist.doneCount / total) * 100}%` }}
          />
        </div>
      </div>

      {checklist.allDone ? (
        <div className="flex flex-wrap items-center gap-3 border-t px-4 py-4 sm:px-5">
          <PartyPopper className="size-5 text-org-accent" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">You&apos;re set up</p>
            <p className="text-sm text-muted-foreground">
              Your workspace is mapping how the work gets done. Keep adding
              processes and contributions as you go.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() =>
              runMutation(markChecklistCompleted({}), "Couldn't close Getting started.")
            }
          >
            Close
          </Button>
        </div>
      ) : (
        open && (
          <ol className="border-t">
            {checklist.steps.map((step, index) => {
              const isTreeStep =
                step.id === "function" ||
                step.id === "department" ||
                step.id === "process";
              return (
                <li
                  key={step.id}
                  aria-current={step.state === "current" ? "step" : undefined}
                  className="border-b px-4 py-3 last:border-b-0 sm:px-5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <StepMarker step={step} index={index} />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-sm",
                          step.state === "current" ? "font-semibold" : "font-medium",
                          step.state === "todo" && "text-muted-foreground",
                        )}
                      >
                        {STEP_TITLES[step.id]}
                        <span className="sr-only">
                          {step.state === "done"
                            ? " (done)"
                            : step.state === "current"
                              ? " (next)"
                              : ""}
                        </span>
                      </p>
                      {step.detail && (
                        <p className="truncate text-xs text-muted-foreground">
                          {step.detail}
                        </p>
                      )}
                    </div>
                    {mobile && isTreeStep && step.state === "done" && actions.onSeeInTree && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-10 shrink-0"
                        onClick={actions.onSeeInTree}
                      >
                        See it in the tree
                      </Button>
                    )}
                    {step.id === "invite" && step.state === "todo" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn("shrink-0", mobile && "h-10")}
                        onClick={() => setInviteOpen(true)}
                      >
                        Invite
                      </Button>
                    )}
                  </div>
                  {step.state === "current" && (
                    <div className="mt-3 sm:pl-9">{stepBody(step)}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )
      )}

      <TourDialog open={tourOpen} onOpenChange={setTourOpen} />
      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </section>
  );
}

"use client";

import { useState } from "react";
import { Compass, House, Layers, Mic } from "lucide-react";
import { Coachmark } from "@/components/ui/coachmark";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { RevealPath } from "@/features/workbench/reveal-path";
import type { WalkthroughStep } from "./walkthrough-steps";

export type WalkthroughOutcome = "completed" | "skipped";

/** Help, the waiting card and the deep-link toast ask the workbench to start
 * the walkthrough through this window event, so none of them needs a path to
 * the workbench's state. */
export const SHOW_ME_AROUND_EVENT = "fabric:show-me-around";

export function requestShowMeAround() {
  window.dispatchEvent(new Event(SHOW_ME_AROUND_EVENT));
}

const SIDE_BY_ANCHOR: Partial<Record<WalkthroughStep["anchor"], "right" | "bottom">> = {
  tree: "right",
  "tree-node": "right",
};

/**
 * The desktop Explore walkthrough: one coachmark per step, moving the real
 * selection as it goes (step 2 selects the function, Next on the process
 * opens it). A step whose element never appears is skipped. Esc, Skip tour
 * and Close end it as skipped; Done on the last step as completed.
 */
export function Walkthrough({
  steps,
  onSelect,
  onFinish,
}: {
  steps: WalkthroughStep[];
  onSelect: (path: RevealPath) => void;
  onFinish: (outcome: WalkthroughOutcome) => void;
}) {
  const [index, setIndex] = useState(0);
  const step = steps[index];
  if (!step) return null;
  const isLast = index === steps.length - 1;

  const goTo = (target: number) => {
    const forward = target > index;
    if (target >= steps.length) {
      onFinish("completed");
      return;
    }
    const next = steps[target];
    if (forward && step.selectOnNext) onSelect(step.selectOnNext);
    else if (next.select) onSelect(next.select);
    setIndex(target);
  };

  return (
    <Coachmark
      key={`${step.id}-${index}`}
      anchor={step.anchor}
      anchorNode={step.node}
      side={SIDE_BY_ANCHOR[step.anchor] ?? "bottom"}
      title={step.title}
      body={step.body}
      step={{
        index,
        total: steps.length,
        onBack: () => goTo(index - 1),
        onNext: () => goTo(index + 1),
        nextLabel: isLast ? "Done" : "Next",
      }}
      dismissLabel="Skip tour"
      onDismiss={() => onFinish("skipped")}
      onAnchorMissing={() => goTo(index + 1)}
    />
  );
}

/**
 * Phones and tablets: the drill-down layout has no tree to point at, so the
 * walkthrough is three cards in a bottom sheet. Done completes it; closing it
 * any other way skips it.
 */
export function ExploreSheet({
  open,
  canCapture,
  departmentName,
  onFinish,
}: {
  open: boolean;
  canCapture: boolean;
  /** The member's own department, when they have one. */
  departmentName: string | null;
  onFinish: (outcome: WalkthroughOutcome) => void;
}) {
  const [index, setIndex] = useState(0);
  const cards = [
    {
      icon: Layers,
      title: "How Fabric is organized",
      body: "Your organization is laid out as functions, then the departments inside them, then the processes each team runs. Browse them from the Browse tab.",
    },
    {
      icon: House,
      title: departmentName ? `${departmentName} is on Home` : "Your department is on Home",
      body: departmentName
        ? `${departmentName} and its processes are on your Home tab, along with what you opened recently.`
        : "Once you're placed in a department, its processes appear on your Home tab, along with what you opened recently.",
    },
    canCapture
      ? {
          icon: Mic,
          title: "Share how the work gets done",
          body: "Open a process and tap + to start an AI interview, record a voice note, or upload a recording.",
        }
      : {
          icon: Compass,
          title: "Explore the maps",
          body: "Open any process to see its overview, process flow and insights.",
        },
  ];
  const card = cards[index];
  const Icon = card.icon;
  const isLast = index === cards.length - 1;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onFinish("skipped");
      }}
    >
      <SheetContent
        side="bottom"
        className="gap-0 rounded-t-2xl p-0 sm:mx-auto sm:max-w-lg"
      >
        <SheetHeader className="gap-3 p-5 pr-14">
          <span className="flex size-10 items-center justify-center rounded-xl bg-org-accent-subtle text-org-accent">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <SheetTitle>{card.title}</SheetTitle>
          <SheetDescription className="leading-6">{card.body}</SheetDescription>
          <p className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {index + 1} of {cards.length}
          </p>
        </SheetHeader>
        <SheetFooter className="flex-row justify-between gap-2 border-t p-4">
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            onClick={() => onFinish("skipped")}
          >
            Skip
          </Button>
          <div className="flex gap-2">
            {index > 0 && (
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => setIndex(index - 1)}
              >
                Back
              </Button>
            )}
            <Button
              type="button"
              className="h-11"
              onClick={() =>
                isLast ? onFinish("completed") : setIndex(index + 1)
              }
            >
              {isLast ? "Done" : "Next"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

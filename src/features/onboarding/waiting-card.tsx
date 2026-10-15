"use client";

import { useState } from "react";
import { Compass, Hourglass, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TourDialog } from "./tour-dialog";
import { requestShowMeAround } from "./walkthrough";

/**
 * Home for a contributor or viewer who arrives before there's a process.
 * It's reactive: when the first process appears it turns into "Your
 * workspace is ready" with Show me around. Guidance only; contributors keep
 * their create rights in the tree.
 */
export function WaitingCard({
  state,
  canCapture,
  mobile,
}: {
  state: "waiting" | "ready";
  canCapture: boolean;
  mobile: boolean;
}) {
  const [tourOpen, setTourOpen] = useState(false);
  const ready = state === "ready";
  const Icon = ready ? Compass : Hourglass;

  return (
    <div
      className={cn(
        "mt-10 rounded-xl border px-6 py-10 text-center",
        ready ? "border-org-accent-border bg-org-accent-subtle" : "border-dashed",
      )}
      role="status"
    >
      <Icon
        className={cn(
          "mx-auto size-7",
          ready ? "text-org-accent" : "text-muted-foreground",
        )}
        aria-hidden="true"
      />
      <h2 className="mt-4 text-lg font-semibold">
        {ready ? "Your workspace is ready" : "Your workspace is being set up"}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        {ready
          ? "The first processes are in. Take a quick look around to find your department and see how it works."
          : `Your admin is adding the functions, departments and processes. Once the first process is added, you'll find your department here${
              canCapture ? " and can start sharing how your work gets done" : ""
            }.`}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {ready ? (
          <Button
            type="button"
            className={cn(mobile && "h-11 px-4")}
            onClick={requestShowMeAround}
          >
            Show me around
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            className={cn("gap-1.5", mobile && "h-11 px-4")}
            onClick={() => setTourOpen(true)}
          >
            <PlayCircle className="size-4" aria-hidden="true" />
            Replay the tour
          </Button>
        )}
      </div>
      <TourDialog open={tourOpen} onOpenChange={setTourOpen} />
    </div>
  );
}

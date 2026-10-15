"use client";

import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TourPlayer, type TourWatchedVia } from "./tour-player";

/** The two-minute tour in a dialog, for replays (Help, Getting started, the
 * waiting card). Watching 90% of it, or reading the transcript, records the
 * tour as watched for this person in every workspace. */
export function TourDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const markTourWatched = useMutation(api.onboarding.markTourWatched);

  const handleWatched = (via: TourWatchedVia) => {
    markTourWatched({ via }).catch((err: unknown) => {
      console.warn("Couldn't record the tour as watched", err);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-3 p-3 sm:max-w-5xl sm:p-4">
        <DialogHeader className="pr-8">
          <DialogTitle>Fabric in two minutes</DialogTitle>
          <DialogDescription>
            Find your way around, capture how work gets done, and see it turned
            into process maps, insights, and automation ideas.
          </DialogDescription>
        </DialogHeader>
        {open && <TourPlayer mode="replay" onWatched={handleWatched} />}
      </DialogContent>
    </Dialog>
  );
}

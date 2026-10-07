"use client";

import { useState, useSyncExternalStore } from "react";
import { PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Rendered from captures of the live product; tools/demo-video/README.md
// explains how to regenerate these files after UI changes.
const TOUR_VIDEO_SRC = "/demo/fabric-tour.mp4";
const TOUR_POSTER_SRC = "/demo/fabric-tour-poster.jpg";
const TOUR_CAPTIONS_SRC = "/demo/fabric-tour.en.vtt";

const TOUR_WATCHED_KEY = "fabric:product-tour-watched";
const TOUR_WATCHED_EVENT = "fabric:product-tour-watched-change";

function getTourWatchedSnapshot(): boolean {
  return window.localStorage.getItem(TOUR_WATCHED_KEY) === "true";
}

// Server render assumes "watched" so first-time users get the prominent
// button only after hydration, rather than everyone flashing it.
function getServerTourWatchedSnapshot(): boolean {
  return true;
}

function subscribeToTourWatched(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(TOUR_WATCHED_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(TOUR_WATCHED_EVENT, onStoreChange);
  };
}

/**
 * Header entry point for the two-minute product tour. First-time users see a
 * labelled button; once they've opened the tour it shrinks to an icon so it
 * stays available without competing with the workspace.
 */
export function ProductTourButton() {
  const [open, setOpen] = useState(false);
  const watched = useSyncExternalStore(
    subscribeToTourWatched,
    getTourWatchedSnapshot,
    getServerTourWatchedSnapshot,
  );

  const openTour = () => {
    setOpen(true);
    if (!watched) {
      window.localStorage.setItem(TOUR_WATCHED_KEY, "true");
      window.dispatchEvent(new Event(TOUR_WATCHED_EVENT));
    }
  };

  return (
    <>
      {watched ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={openTour}
                aria-label="Watch the product tour"
              />
            }
          >
            <PlayCircle className="size-4" />
          </TooltipTrigger>
          <TooltipContent>Watch the product tour</TooltipContent>
        </Tooltip>
      ) : (
        <Button
          type="button"
          onClick={openTour}
          className="shrink-0 gap-1.5 bg-org-accent text-org-accent-foreground hover:bg-org-accent/90"
          aria-label="Watch the 2-minute product tour"
        >
          <PlayCircle className="size-4" />
          <span className="hidden sm:inline">Watch the 2-min tour</span>
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-3 p-3 sm:max-w-5xl sm:p-4">
          <DialogHeader className="pr-8">
            <DialogTitle>Fabric in two minutes</DialogTitle>
            <DialogDescription>
              Find your way around, capture how work gets done, and see it
              turned into process maps, insights, and automation ideas.
            </DialogDescription>
          </DialogHeader>
          {open && (
            <video
              className="aspect-video w-full rounded-lg bg-muted"
              src={TOUR_VIDEO_SRC}
              poster={TOUR_POSTER_SRC}
              controls
              autoPlay
              playsInline
              preload="metadata"
              aria-label="Fabric product tour"
            >
              <track
                src={TOUR_CAPTIONS_SRC}
                kind="captions"
                srcLang="en"
                label="English"
                default
              />
            </video>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

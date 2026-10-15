"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { CircleHelp, Megaphone, PlayCircle } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TourPlayer, type TourWatchedVia } from "@/features/onboarding/tour-player";
import { useWorkspaceRoutes } from "@/features/shell/use-workspace-routes";

/**
 * The header's "?" menu: the two-minute tour, and release notes. Phase 3 adds
 * Getting started (admins) and Phase 4 Show me around. A dot marks the icon
 * while a member who's being onboarded hasn't watched the tour.
 */
export function HelpMenu() {
  const router = useRouter();
  const routes = useWorkspaceRoutes();
  const onboarding = useQuery(api.onboarding.getMyOnboarding);
  const markTourWatched = useMutation(api.onboarding.markTourWatched);
  const [tourOpen, setTourOpen] = useState(false);

  const showDot = Boolean(onboarding?.eligible && !onboarding.tour.watched);

  const handleWatched = (via: TourWatchedVia) => {
    markTourWatched({ via }).catch((err: unknown) => {
      console.warn("Couldn't record the tour as watched", err);
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="relative shrink-0"
              aria-label={showDot ? "Help (tour not watched yet)" : "Help"}
            />
          }
        >
          <CircleHelp className="size-4" aria-hidden="true" />
          {showDot && (
            <span
              aria-hidden="true"
              className="absolute right-1.5 top-1.5 size-2 rounded-full bg-org-accent ring-2 ring-background"
            />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => setTourOpen(true)}>
            <PlayCircle className="size-4" />
            Watch the 2-minute tour
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push(routes.releaseNotesHref)}>
            <Megaphone className="size-4" />
            Release notes
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={tourOpen} onOpenChange={setTourOpen}>
        <DialogContent className="gap-3 p-3 sm:max-w-5xl sm:p-4">
          <DialogHeader className="pr-8">
            <DialogTitle>Fabric in two minutes</DialogTitle>
            <DialogDescription>
              Find your way around, capture how work gets done, and see it
              turned into process maps, insights, and automation ideas.
            </DialogDescription>
          </DialogHeader>
          {tourOpen && <TourPlayer mode="replay" onWatched={handleWatched} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

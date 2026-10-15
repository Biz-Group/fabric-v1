"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import {
  CircleHelp,
  Compass,
  ListChecks,
  Megaphone,
  PlayCircle,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { findTourAnchor } from "@/components/ui/coachmark";
import { describeError } from "@/lib/user-error-message";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TourDialog } from "@/features/onboarding/tour-dialog";
import { requestShowMeAround } from "@/features/onboarding/walkthrough";
import { useWorkspaceRoutes } from "@/features/shell/use-workspace-routes";

const SCROLL_WAIT_MS = 2000;
const SCROLL_POLL_MS = 100;

/** Scrolls Home to the Getting started card once it's on screen: after a
 * navigation, and after un-hiding, it takes a moment to appear. */
function scrollToGettingStarted() {
  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    const card = findTourAnchor("getting-started");
    if (card) {
      window.clearInterval(timer);
      card.scrollIntoView({ block: "start", behavior: "smooth" });
    } else if (Date.now() - startedAt >= SCROLL_WAIT_MS) {
      window.clearInterval(timer);
    }
  }, SCROLL_POLL_MS);
}

/**
 * The header's "?" menu: the two-minute tour, Show me around (the Explore
 * walkthrough, for anyone), Getting started (eligible admins) and release
 * notes. A dot marks the icon while a member who's being onboarded hasn't
 * watched the tour.
 */
export function HelpMenu() {
  const router = useRouter();
  const routes = useWorkspaceRoutes();
  const onboarding = useQuery(api.onboarding.getMyOnboarding);
  const setChecklistHidden = useMutation(api.onboarding.setChecklistHidden);
  const [tourOpen, setTourOpen] = useState(false);

  const showDot = Boolean(onboarding?.eligible && !onboarding.tour.watched);
  // Only eligible admins have a checklist; hidden or not, Help leads to it.
  const hasGettingStarted = Boolean(
    onboarding?.checklist.visible || onboarding?.checklist.hidden,
  );

  const openGettingStarted = async () => {
    if (onboarding?.checklist.hidden) {
      try {
        await setChecklistHidden({ hidden: false });
      } catch (err) {
        toast.error(describeError(err, "Couldn't show Getting started."));
        return;
      }
    }
    // Home is the workspace route with nothing selected.
    router.push(routes.appHref);
    scrollToGettingStarted();
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
          <DropdownMenuItem onClick={requestShowMeAround}>
            <Compass className="size-4" />
            Show me around
          </DropdownMenuItem>
          {hasGettingStarted && (
            <DropdownMenuItem onClick={() => void openGettingStarted()}>
              <ListChecks className="size-4" />
              Getting started
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => router.push(routes.releaseNotesHref)}>
            <Megaphone className="size-4" />
            Release notes
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <TourDialog open={tourOpen} onOpenChange={setTourOpen} />
    </>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { cn } from "@/lib/utils";
import { describeError } from "@/lib/user-error-message";
import { firstName } from "@/features/home/home-view-model";
import {
  PlacementFields,
  ProfileFields,
  SignOutHint,
} from "@/features/profile/profile-onboarding";
import { WorkspaceBrandLockup } from "@/features/shell/workspace-brand-lockup";
import {
  formatSecondsLeft,
  resolveWelcomeStep,
  welcomeSteps,
  type MyOnboarding,
  type OnboardingPath,
  type WelcomeState,
  type WelcomeStep,
} from "./onboarding-view-model";
import { TourPlayer, type TourWatchedVia } from "./tour-player";

// A skipped tour isn't stored on the server (only watching it is), so it's
// remembered for the tab: a refresh on a later step doesn't go back to it.
const TOUR_SKIPPED_KEY_PREFIX = "fabric:welcome-tour-skipped:";

function readTourSkipped(key: string) {
  try {
    return window.sessionStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function rememberTourSkipped(key: string) {
  try {
    window.sessionStorage.setItem(key, "true");
  } catch {
    // Private mode or blocked storage: a refresh just shows the tour again.
  }
}

type FirstRunFlowProps = {
  onboarding: MyOnboarding & { path: OnboardingPath };
  userName: string | undefined;
  profileComplete: boolean;
  /** The workspace page's latched placement gate (see placement-gate.ts). */
  placementOwed: boolean;
};

/** The once-only, full-screen welcome for members joining after onboarding
 * launched: the tour, then About you and Where do you sit? when they're
 * owed. Leaving the last step records `welcomedAt`, which hands over to the
 * workspace. */
export function FirstRunFlow({
  onboarding,
  userName,
  profileComplete,
  placementOwed,
}: FirstRunFlowProps) {
  const { organization } = useOrganization();
  const completeWelcome = useMutation(api.onboarding.completeWelcome);
  const markTourWatched = useMutation(api.onboarding.markTourWatched);
  const skipKey = `${TOUR_SKIPPED_KEY_PREFIX}${organization?.id ?? "workspace"}`;
  const { path } = onboarding;

  const state: WelcomeState = {
    path,
    tourWatched: onboarding.tour.watched,
    tourSkipped: false,
    profileComplete,
    placementOwed,
  };
  const [steps] = useState(() => welcomeSteps(state));
  const [step, setStep] = useState<WelcomeStep | null>(() =>
    resolveWelcomeStep(steps, {
      ...state,
      tourSkipped: readTourSkipped(skipKey),
    }),
  );
  const [watchedNow, setWatchedNow] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [finishError, setFinishError] = useState("");
  const finishingRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const tourWatched = onboarding.tour.watched || watchedNow;
  const orgName = organization?.name ?? "your organization";

  // On success the onboarding query reports `welcomed` and the workspace
  // page takes over, so only a failure needs handling here.
  const finish = () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    completeWelcome({}).catch((err: unknown) => {
      finishingRef.current = false;
      setFinishError(
        describeError(err, "Your workspace couldn't be opened. Try again."),
      );
    });
  };

  // Nothing left to ask (on opening, or after the last step): hand over.
  useEffect(() => {
    if (step === null) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finish is guarded and only needs to run when the step runs out
  }, [step]);

  // Move focus to each new step's heading, so screen readers announce it.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const advance = () => {
    const current = step === null ? -1 : steps.indexOf(step);
    setStep(
      resolveWelcomeStep(steps.slice(current + 1), {
        ...state,
        tourWatched: true,
      }),
    );
  };

  const handleWatched = (via: TourWatchedVia) => {
    setWatchedNow(true);
    markTourWatched({ via }).catch((err: unknown) => {
      // The gate is UX only: carry on, and the next visit asks again.
      console.warn("Couldn't record the tour as watched", err);
    });
  };

  const skipTour = () => {
    rememberTourSkipped(skipKey);
    advance();
  };

  if (step === null) {
    if (!finishError) return <LoadingScreen message="Opening your workspace..." />;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-4 text-center">
        <p role="alert" className="max-w-sm text-sm text-destructive">
          {finishError}
        </p>
        <Button
          type="button"
          onClick={() => {
            setFinishError("");
            finish();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  const stepIndex = steps.indexOf(step);
  const name = firstName(userName);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between gap-4 px-4 py-4 sm:px-8">
        <WorkspaceBrandLockup organization={organization ?? null} />
        {steps.length > 1 && (
          <ol className="flex items-center gap-2" aria-label="Progress">
            {steps.map((item, index) => (
              <li
                key={item}
                aria-current={index === stepIndex ? "step" : undefined}
                className={cn(
                  "size-2 rounded-full transition-colors motion-reduce:transition-none",
                  index <= stepIndex ? "bg-org-accent" : "bg-muted-foreground/30",
                )}
              >
                <span className="sr-only">
                  Step {index + 1} of {steps.length}
                  {index === stepIndex ? " (current)" : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </header>

      <main
        className={cn(
          "mx-auto flex w-full flex-1 flex-col px-4 pb-10 pt-4 sm:pt-10",
          step === "tour" ? "max-w-3xl" : "max-w-md",
        )}
      >
        {step === "tour" && (
          <>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight focus:outline-none sm:text-3xl"
            >
              {name ? `Welcome to Fabric, ${name}` : "Welcome to Fabric"}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">
              Fabric maps how {orgName} works by listening to the people who do
              the work.{" "}
              {path === "build"
                ? "Watch this two-minute tour before you set up your workspace."
                : "Here's how it works, in two minutes."}
            </p>
            <TourPlayer
              mode="gate"
              className="mt-6"
              onWatched={handleWatched}
              onSecondsLeftChange={setSecondsLeft}
            />
            <div className="mt-6 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
              {path === "build" ? (
                <Button
                  type="button"
                  size="lg"
                  disabled={!tourWatched}
                  onClick={advance}
                >
                  {tourWatched
                    ? "Let's set up"
                    : secondsLeft === null
                      ? "Watch the tour to continue"
                      : `Let's set up · ${formatSecondsLeft(secondsLeft)}`}
                </Button>
              ) : tourWatched ? (
                <Button type="button" size="lg" onClick={advance}>
                  Continue
                </Button>
              ) : (
                <Button type="button" size="lg" variant="ghost" onClick={skipTour}>
                  Skip for now
                </Button>
              )}
            </div>
          </>
        )}

        {step === "profile" && (
          <>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight focus:outline-none"
            >
              About you
            </h1>
            <p className="mb-6 mt-2 text-sm leading-6 text-muted-foreground">
              Your profile follows you to every Fabric workspace you join.
            </p>
            <ProfileFields
              askPlacement={false}
              submitLabel="Continue"
              onDone={advance}
            />
          </>
        )}

        {step === "placement" && (
          <>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight focus:outline-none"
            >
              Where do you sit?
            </h1>
            <p className="mb-6 mt-2 text-sm leading-6 text-muted-foreground">
              Choose your function and department in {orgName}.
            </p>
            <PlacementFields submitLabel="Continue" onDone={advance} />
          </>
        )}

        <SignOutHint className="mt-auto pt-10" />
      </main>
    </div>
  );
}

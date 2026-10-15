import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";

// Pure derivations for first-run onboarding, kept out of the components so
// they can be unit-tested.

export type MyOnboarding = NonNullable<
  FunctionReturnType<typeof api.onboarding.getMyOnboarding>
>;
export type OnboardingPath = NonNullable<MyOnboarding["path"]>;

/** The share of the tour that must actually be played to count as watched. */
export const TOUR_WATCHED_FRACTION = 0.9;

/** What a `<video>`'s `played` ranges look like, so tests can fake them. */
export type TimeRangesLike = {
  readonly length: number;
  start(index: number): number;
  end(index: number): number;
};

/** Seconds actually played. Seeking skips the gap, so scrubbing to the end
 * adds nothing, while watching at 1.5× counts in full. */
export function playedSeconds(ranges: TimeRangesLike) {
  let total = 0;
  for (let index = 0; index < ranges.length; index += 1) {
    total += Math.max(0, ranges.end(index) - ranges.start(index));
  }
  return total;
}

/** Seconds still to play before the tour counts as watched, or null while
 * the duration is unknown. */
export function tourSecondsLeft(played: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return Math.max(0, duration * TOUR_WATCHED_FRACTION - played);
}

/** "1:05 left": rounded up, so it never reads 0:00 while still locked. */
export function formatSecondsLeft(seconds: number) {
  const whole = Math.ceil(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return `${minutes}:${rest} left`;
}

export type WelcomeStep = "tour" | "profile" | "placement";

export type WelcomeState = {
  path: OnboardingPath;
  tourWatched: boolean;
  /** Skipped earlier in this browser session (not stored on the server). */
  tourSkipped: boolean;
  profileComplete: boolean;
  /** The member still owes this org a department (see placement-gate.ts). */
  placementOwed: boolean;
};

/** The steps this member's welcome includes, fixed when the flow opens so
 * the progress dots don't shift as steps complete.
 *
 * - The tour always comes first; it doubles as the welcome screen.
 * - About you only when the profile is incomplete. It's global, so someone
 *   who joined another workspace first has already filled it in.
 * - Where do you sit? only on Explore and Waiting. Builders are placed by the
 *   builder itself, as they create their first department.
 */
export function welcomeSteps(state: WelcomeState): WelcomeStep[] {
  const steps: WelcomeStep[] = ["tour"];
  if (!state.profileComplete) steps.push("profile");
  if (state.placementOwed && state.path !== "build") steps.push("placement");
  return steps;
}

/** Where a (re)opened flow starts: the first step not yet done, judged from
 * server state, or null when there's nothing left but to finish. */
export function resolveWelcomeStep(
  steps: readonly WelcomeStep[],
  state: WelcomeState,
): WelcomeStep | null {
  const done: Record<WelcomeStep, boolean> = {
    tour:
      state.tourWatched || (state.tourSkipped && state.path !== "build"),
    profile: state.profileComplete,
    placement: !state.placementOwed,
  };
  return steps.find((step) => !done[step]) ?? null;
}

import { describe, expect, it } from "vitest";
import {
  formatSecondsLeft,
  playedSeconds,
  resolveWelcomeStep,
  tourSecondsLeft,
  welcomeSteps,
  type WelcomeState,
} from "./onboarding-view-model";

function ranges(...pairs: [number, number][]) {
  return {
    length: pairs.length,
    start: (index: number) => pairs[index][0],
    end: (index: number) => pairs[index][1],
  };
}

function stateOf(overrides: Partial<WelcomeState> = {}): WelcomeState {
  return {
    path: "explore",
    tourWatched: false,
    tourSkipped: false,
    profileComplete: false,
    placementOwed: false,
    ...overrides,
  };
}

describe("tour progress", () => {
  it("counts only what was played", () => {
    expect(playedSeconds(ranges())).toBe(0);
    // Watched the first 30 s, then scrubbed to the last 5 s.
    expect(playedSeconds(ranges([0, 30], [118, 123]))).toBe(35);
  });

  it("knows how much is left before 90%", () => {
    expect(tourSecondsLeft(0, 100)).toBe(90);
    expect(tourSecondsLeft(95, 100)).toBe(0);
    expect(tourSecondsLeft(10, Number.NaN)).toBeNull();
    expect(tourSecondsLeft(10, 0)).toBeNull();
  });

  it("formats the time left, rounding up", () => {
    expect(formatSecondsLeft(65)).toBe("1:05 left");
    expect(formatSecondsLeft(0.2)).toBe("0:01 left");
    expect(formatSecondsLeft(110.7)).toBe("1:51 left");
  });
});

describe("welcome steps", () => {
  it("always starts with the tour", () => {
    expect(welcomeSteps(stateOf({ profileComplete: true }))).toEqual(["tour"]);
  });

  it("asks about you only while the profile is incomplete", () => {
    expect(welcomeSteps(stateOf())).toEqual(["tour", "profile"]);
  });

  it("asks where you sit on Explore and Waiting, never on Build", () => {
    const owed = { placementOwed: true, profileComplete: true };
    expect(welcomeSteps(stateOf({ ...owed, path: "explore" }))).toEqual([
      "tour",
      "placement",
    ]);
    expect(welcomeSteps(stateOf({ ...owed, path: "waiting" }))).toEqual([
      "tour",
      "placement",
    ]);
    expect(welcomeSteps(stateOf({ ...owed, path: "build" }))).toEqual(["tour"]);
  });
});

describe("resolveWelcomeStep", () => {
  const steps = ["tour", "profile", "placement"] as const;

  it("opens on the tour", () => {
    expect(resolveWelcomeStep(steps, stateOf({ placementOwed: true }))).toBe(
      "tour",
    );
  });

  it("resumes after a refresh at the first step not done", () => {
    expect(
      resolveWelcomeStep(steps, stateOf({ tourWatched: true, placementOwed: true })),
    ).toBe("profile");
    expect(
      resolveWelcomeStep(
        steps,
        stateOf({ tourWatched: true, profileComplete: true, placementOwed: true }),
      ),
    ).toBe("placement");
  });

  it("remembers a skipped tour, except for builders", () => {
    expect(resolveWelcomeStep(steps, stateOf({ tourSkipped: true }))).toBe(
      "profile",
    );
    expect(
      resolveWelcomeStep(["tour"], stateOf({ path: "build", tourSkipped: true })),
    ).toBe("tour");
  });

  it("has nothing left once every step is done", () => {
    expect(
      resolveWelcomeStep(
        steps,
        stateOf({ tourWatched: true, profileComplete: true }),
      ),
    ).toBeNull();
  });
});

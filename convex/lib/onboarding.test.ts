import { describe, expect, it } from "vitest";
import {
  isOnboardingEligible,
  isTourRequired,
  parseOnboardingLaunchedAt,
  resolveOnboardingPath,
} from "./onboarding";

const LAUNCHED_AT = 1_800_000_000_000;

function membershipAt(
  createdAt: number,
  overrides: Partial<Parameters<typeof isOnboardingEligible>[0]> = {},
) {
  return { createdAt, status: "active" as const, ...overrides };
}

describe("parseOnboardingLaunchedAt", () => {
  it("reads epoch milliseconds", () => {
    expect(parseOnboardingLaunchedAt(String(LAUNCHED_AT))).toBe(LAUNCHED_AT);
    expect(parseOnboardingLaunchedAt(` ${LAUNCHED_AT} `)).toBe(LAUNCHED_AT);
  });

  it("treats unset or malformed values as off", () => {
    expect(parseOnboardingLaunchedAt(undefined)).toBeNull();
    expect(parseOnboardingLaunchedAt("")).toBeNull();
    expect(parseOnboardingLaunchedAt("0")).toBeNull();
    expect(parseOnboardingLaunchedAt("-5")).toBeNull();
    expect(parseOnboardingLaunchedAt("2026-10-15")).toBeNull();
    expect(parseOnboardingLaunchedAt("1.5e12")).toBeNull();
    expect(parseOnboardingLaunchedAt("99999999999999999999")).toBeNull();
  });
});

describe("isOnboardingEligible", () => {
  const person = { platformRole: undefined };

  it("onboards memberships created on or after the cutoff", () => {
    expect(isOnboardingEligible(membershipAt(LAUNCHED_AT), person, LAUNCHED_AT)).toBe(true);
    expect(
      isOnboardingEligible(membershipAt(LAUNCHED_AT - 1), person, LAUNCHED_AT),
    ).toBe(false);
  });

  it("is off while the cutoff is unset", () => {
    expect(isOnboardingEligible(membershipAt(LAUNCHED_AT), person, null)).toBe(false);
  });

  it("never onboards super-admins or their fan-out memberships", () => {
    expect(
      isOnboardingEligible(
        membershipAt(LAUNCHED_AT, { source: "superAdminFanOut" }),
        person,
        LAUNCHED_AT,
      ),
    ).toBe(false);
    expect(
      isOnboardingEligible(
        membershipAt(LAUNCHED_AT),
        { platformRole: "superAdmin" },
        LAUNCHED_AT,
      ),
    ).toBe(false);
  });

  it("ignores removed memberships", () => {
    expect(
      isOnboardingEligible(
        membershipAt(LAUNCHED_AT, { status: "removed" }),
        person,
        LAUNCHED_AT,
      ),
    ).toBe(false);
    expect(
      isOnboardingEligible(
        membershipAt(LAUNCHED_AT, { removedAt: LAUNCHED_AT + 1 }),
        person,
        LAUNCHED_AT,
      ),
    ).toBe(false);
  });
});

describe("resolveOnboardingPath", () => {
  it("sends admins in an empty workspace to build, others to wait", () => {
    expect(resolveOnboardingPath("admin", false)).toBe("build");
    expect(resolveOnboardingPath("contributor", false)).toBe("waiting");
    expect(resolveOnboardingPath("viewer", false)).toBe("waiting");
  });

  it("sends everyone to explore once a process exists", () => {
    expect(resolveOnboardingPath("admin", true)).toBe("explore");
    expect(resolveOnboardingPath("contributor", true)).toBe("explore");
    expect(resolveOnboardingPath("viewer", true)).toBe("explore");
  });
});

describe("isTourRequired", () => {
  const newUser = { _creationTime: LAUNCHED_AT + 1, tourWatchedAt: undefined };

  it("gates new builders until they've watched it", () => {
    expect(isTourRequired(newUser, "build", LAUNCHED_AT)).toBe(true);
    expect(
      isTourRequired({ ...newUser, tourWatchedAt: LAUNCHED_AT + 2 }, "build", LAUNCHED_AT),
    ).toBe(false);
  });

  it("never gates people who existed before the cutoff", () => {
    expect(
      isTourRequired({ ...newUser, _creationTime: LAUNCHED_AT - 1 }, "build", LAUNCHED_AT),
    ).toBe(false);
  });

  it("only gates the build path", () => {
    expect(isTourRequired(newUser, "explore", LAUNCHED_AT)).toBe(false);
    expect(isTourRequired(newUser, "waiting", LAUNCHED_AT)).toBe(false);
    expect(isTourRequired(newUser, null, LAUNCHED_AT)).toBe(false);
    expect(isTourRequired(newUser, "build", null)).toBe(false);
  });
});

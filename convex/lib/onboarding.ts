import { env } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type { Role } from "./orgAuth";

/**
 * First-run onboarding rules. Pure, so the rollout and path matrix can be
 * unit-tested without a database.
 *
 * - **build**: an admin in a workspace with no process yet. They're guided to
 *   create Function → Department → Process, and must watch the tour first.
 * - **explore**: anyone joining a workspace that already has a process. They
 *   get a walkthrough of the tree; admins also get the Getting started card.
 * - **waiting**: a contributor or viewer in an empty workspace. Only admins
 *   build, so they wait for one.
 */
export type OnboardingPath = "build" | "explore" | "waiting";

/** `ONBOARDING_LAUNCHED_AT` as epoch milliseconds, or null when unset or not
 * a positive whole number. Null means onboarding is off. */
export function parseOnboardingLaunchedAt(
  raw: string | undefined,
): number | null {
  const value = raw?.trim();
  if (!value || !/^\d+$/.test(value)) return null;
  const launchedAt = Number(value);
  return Number.isSafeInteger(launchedAt) && launchedAt > 0
    ? launchedAt
    : null;
}

export function onboardingLaunchedAt(): number | null {
  return parseOnboardingLaunchedAt(env.ONBOARDING_LAUNCHED_AT);
}

/** New members only: a membership created on or after the cutoff, never a
 * super-admin's (they get memberships in every tenant by fan-out and never
 * need onboarding). Off entirely while the cutoff is unset. */
export function isOnboardingEligible(
  membership: Pick<
    Doc<"memberships">,
    "status" | "removedAt" | "createdAt" | "source"
  >,
  user: Pick<Doc<"users">, "platformRole">,
  launchedAt: number | null,
): boolean {
  if (launchedAt === null) return false;
  return (
    membership.status !== "removed" &&
    membership.removedAt === undefined &&
    membership.createdAt >= launchedAt &&
    membership.source !== "superAdminFanOut" &&
    user.platformRole !== "superAdmin"
  );
}

export function resolveOnboardingPath(
  role: Role,
  hasProcess: boolean,
): OnboardingPath {
  if (hasProcess) return "explore";
  return role === "admin" ? "build" : "waiting";
}

/** The tour gate is for builders who are new to Fabric. Someone who existed
 * before the cutoff and becomes admin of a new tenant is never made to watch
 * it. */
export function isTourRequired(
  user: Pick<Doc<"users">, "_creationTime" | "tourWatchedAt">,
  path: OnboardingPath | null,
  launchedAt: number | null,
): boolean {
  return (
    path === "build" &&
    launchedAt !== null &&
    user._creationTime >= launchedAt &&
    user.tourWatchedAt === undefined
  );
}

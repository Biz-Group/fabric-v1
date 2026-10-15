import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  isActiveMembership,
  requireOrgMember,
  type OrgContext,
} from "./lib/orgAuth";
import {
  isOnboardingEligible,
  isTourRequired,
  onboardingLaunchedAt,
  resolveOnboardingPath,
} from "./lib/onboarding";

// First-run onboarding state for the signed-in member. The tree steps
// (function, department, process, contribution, first map) aren't computed
// here: the client derives them from `hierarchy.getTree`, which it already
// subscribes to. Nothing here blocks creation on the server; the tour gate
// and the paths are UX only.

type OnboardingState = NonNullable<Doc<"memberships">["onboarding"]>;
type Milestone = keyof OnboardingState;

// Per status. The invite step needs one qualifying intent, not a count.
const INTENTS_SCANNED_PER_STATUS = 25;
const MEMBERS_SCANNED = 20;

async function orgHasProcess(ctx: QueryCtx, clerkOrgId: string) {
  const process = await ctx.db
    .query("processes")
    .withIndex("by_clerkOrgId_and_departmentId", (q) =>
      q.eq("clerkOrgId", clerkOrgId),
    )
    .first();
  return process !== null;
}

/** Whether someone in this workspace, not the platform team, has brought in
 * a teammate. The tenant console's first invite (the founding admin's) also
 * has source "adminInvite", so only an inviter who isn't a super-admin
 * counts. Blocked intents (left by removals) and revoked or expired ones
 * don't count either. Failing that, another real member is proof enough. */
async function hasInvitedTeammates(
  ctx: QueryCtx,
  caller: OrgContext,
): Promise<boolean> {
  const inviterIsReal = new Map<Id<"users">, boolean>();
  for (const status of ["pending", "accepted"] as const) {
    const intents = await ctx.db
      .query("membershipIntents")
      .withIndex("by_clerkOrgId_and_status", (q) =>
        q.eq("clerkOrgId", caller.orgId).eq("status", status),
      )
      .take(INTENTS_SCANNED_PER_STATUS);
    for (const intent of intents) {
      if (!intent.invitedBy) continue;
      let real = inviterIsReal.get(intent.invitedBy);
      if (real === undefined) {
        const inviter = await ctx.db.get(intent.invitedBy);
        real = inviter !== null && inviter.platformRole !== "superAdmin";
        inviterIsReal.set(intent.invitedBy, real);
      }
      if (real) return true;
    }
  }

  const members = await ctx.db
    .query("memberships")
    .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", caller.orgId))
    .take(MEMBERS_SCANNED);
  return members.some(
    (member) =>
      member._id !== caller.membershipId &&
      isActiveMembership(member) &&
      member.source !== "superAdminFanOut" &&
      member.platformRole !== "superAdmin",
  );
}

export const getMyOnboarding = query({
  args: {},
  handler: async (ctx) => {
    // Signed out or not a member yet: null, as users.getMyPlacement does.
    let caller: OrgContext;
    try {
      caller = await requireOrgMember(ctx);
    } catch {
      return null;
    }
    const [user, membership] = await Promise.all([
      ctx.db.get(caller.userId),
      ctx.db.get(caller.membershipId),
    ]);
    if (!user || !membership) return null;

    const launchedAt = onboardingLaunchedAt();
    const eligible = isOnboardingEligible(membership, user, launchedAt);
    const state: OnboardingState = membership.onboarding ?? {};
    const path = eligible
      ? resolveOnboardingPath(
          caller.role,
          await orgHasProcess(ctx, caller.orgId),
        )
      : null;

    // Getting started is for admins on either path, until they hide it or
    // finish it. Help → Getting started brings back a hidden one.
    const checklistOpen =
      eligible &&
      caller.role === "admin" &&
      state.checklistCompletedAt === undefined;
    const checklistHidden =
      checklistOpen && state.checklistDismissedAt !== undefined;
    const checklistVisible = checklistOpen && !checklistHidden;

    return {
      eligible,
      path,
      tour: {
        required: isTourRequired(user, path, launchedAt),
        watched: user.tourWatchedAt !== undefined,
      },
      welcomed: state.welcomedAt !== undefined,
      walkthrough:
        state.walkthroughCompletedAt !== undefined
          ? ("completed" as const)
          : state.walkthroughSkippedAt !== undefined
            ? ("skipped" as const)
            : ("pending" as const),
      checklist: {
        visible: checklistVisible,
        hidden: checklistHidden,
        // Only read while the card is showing.
        invited: checklistVisible
          ? await hasInvitedTeammates(ctx, caller)
          : false,
      },
      hints: {
        captureSeen: state.captureHintSeenAt !== undefined,
        firstMapSeen: state.firstMapSeenAt !== undefined,
      },
    };
  },
});

/** The caller's membership when onboarding applies to them, else null:
 * milestone writes are no-ops for everyone else. */
async function eligibleMembership(ctx: MutationCtx) {
  const caller = await requireOrgMember(ctx);
  const [user, membership] = await Promise.all([
    ctx.db.get(caller.userId),
    ctx.db.get(caller.membershipId),
  ]);
  if (!user || !membership) return null;
  return isOnboardingEligible(membership, user, onboardingLaunchedAt())
    ? membership
    : null;
}

/** Records a milestone once; later calls keep the first timestamp. Patching
 * `onboarding` replaces the whole object, so the rest is carried over. */
async function setMilestoneOnce(
  ctx: MutationCtx,
  membership: Doc<"memberships">,
  milestone: Milestone,
) {
  if (membership.onboarding?.[milestone] !== undefined) return;
  await ctx.db.patch(membership._id, {
    onboarding: { ...membership.onboarding, [milestone]: Date.now() },
  });
}

async function markMilestone(ctx: MutationCtx, milestone: Milestone) {
  const membership = await eligibleMembership(ctx);
  if (membership) await setMilestoneOnce(ctx, membership, milestone);
}

/** Per person, and recorded whether or not this membership is onboarding:
 * someone who watches it from Help is never asked again in another tenant. */
export const markTourWatched = mutation({
  args: { via: v.union(v.literal("video"), v.literal("transcript")) },
  handler: async (ctx, args) => {
    const caller = await requireOrgMember(ctx);
    const user = await ctx.db.get(caller.userId);
    if (!user || user.tourWatchedAt !== undefined) return null;
    await ctx.db.patch(user._id, {
      tourWatchedAt: Date.now(),
      tourWatchedVia: args.via,
    });
    return null;
  },
});

export const completeWelcome = mutation({
  args: {},
  handler: async (ctx) => {
    await markMilestone(ctx, "welcomedAt");
    return null;
  },
});

/** The walkthrough ends once, either way; a later call changes nothing. */
export const resolveWalkthrough = mutation({
  args: { outcome: v.union(v.literal("completed"), v.literal("skipped")) },
  handler: async (ctx, args) => {
    const membership = await eligibleMembership(ctx);
    const state = membership?.onboarding;
    if (
      !membership ||
      state?.walkthroughCompletedAt !== undefined ||
      state?.walkthroughSkippedAt !== undefined
    ) {
      return null;
    }
    await setMilestoneOnce(
      ctx,
      membership,
      args.outcome === "completed"
        ? "walkthroughCompletedAt"
        : "walkthroughSkippedAt",
    );
    return null;
  },
});

/** Hide keeps the first time it was hidden; show clears it. */
export const setChecklistHidden = mutation({
  args: { hidden: v.boolean() },
  handler: async (ctx, args) => {
    if (args.hidden) {
      await markMilestone(ctx, "checklistDismissedAt");
      return null;
    }
    const membership = await eligibleMembership(ctx);
    if (membership?.onboarding?.checklistDismissedAt === undefined) {
      return null;
    }
    const onboarding: OnboardingState = { ...membership.onboarding };
    delete onboarding.checklistDismissedAt;
    await ctx.db.patch(membership._id, { onboarding });
    return null;
  },
});

/** Every step is done: the card shows "You're set up" once, then retires. */
export const markChecklistCompleted = mutation({
  args: {},
  handler: async (ctx) => {
    await markMilestone(ctx, "checklistCompletedAt");
    return null;
  },
});

export const markHintSeen = mutation({
  args: { hint: v.union(v.literal("capture"), v.literal("firstMap")) },
  handler: async (ctx, args) => {
    await markMilestone(
      ctx,
      args.hint === "capture" ? "captureHintSeenAt" : "firstMapSeenAt",
    );
    return null;
  },
});

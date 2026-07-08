import { v } from "convex/values";
import { action, ActionCtx, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { resolveOrgForAction } from "./lib/orgAuth";
import {
  clerkFetch,
  clerkUserIdFromTokenIdentifier,
} from "./lib/clerkApi";

// ---------------------------------------------------------------------------
// Shared admin-check used by every action in this file. Per the orgAuth
// convention, the action resolves auth once via resolveOrgForAction and passes
// `orgId` + `tokenIdentifier` as explicit args into this internal query, which
// MUST NOT re-read ctx.auth.
// ---------------------------------------------------------------------------
export const assertAdminFor = internalQuery({
  args: { orgId: v.string(), tokenIdentifier: v.string() },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_tokenIdentifier_and_clerkOrgId", (q) =>
        q
          .eq("tokenIdentifier", args.tokenIdentifier)
          .eq("clerkOrgId", args.orgId),
      )
      .unique();
    if (!membership || membership.role !== "admin") {
      throw new Error("Insufficient permissions");
    }
    return { membershipId: membership._id, userId: membership.userId };
  },
});

type ClerkInvitation = {
  id: string;
  email_address: string;
  role: string;
  status: string;
  organization_id: string;
  created_at: number;
  expires_at?: number | null;
};

type Role = "admin" | "contributor" | "viewer";

type AdminCheckResult = {
  membershipId: Id<"memberships">;
  userId: Id<"users">;
};

type InvitationIntentRole = {
  clerkInvitationId: string | null;
  emailLower: string;
  requestedRole: Role;
};

async function requireAdminForAction(
  ctx: ActionCtx,
  orgId: string,
  tokenIdentifier: string,
): Promise<AdminCheckResult> {
  return await ctx.runQuery(internal.invitations.assertAdminFor, {
    orgId,
    tokenIdentifier,
  });
}

// Clerk's default invitation email links to the hosted Account Portal, which
// strands invitees outside the tenant subdomain. Point the link at the
// tenant's own /sign-up instead: Clerk appends `__clerk_ticket`, the <SignUp>
// component consumes it, and the invitee joins the org atomically with the
// invited email enforced. Returns null (Clerk default) when the slug or
// ROOT_DOMAIN isn't available.
export function inviteRedirectUrl(orgSlug: string | null): string | null {
  const root = process.env.ROOT_DOMAIN?.trim();
  if (!root || !orgSlug) return null;
  const rootHost = root.split(":")[0];
  const isLocal =
    rootHost === "localhost" ||
    rootHost === "127.0.0.1" ||
    rootHost === "lvh.me" ||
    rootHost.endsWith(".localhost") ||
    rootHost.endsWith(".lvh.me");
  const scheme = isLocal ? "http" : "https";
  return `${scheme}://${orgSlug}.${root}/sign-up`;
}

/** Emails (lowercased) from `candidates` that already hold an active
 * membership in the org. Used to hide fulfilled invitations from the pending
 * list: with open subdomain enrollment a user can join directly, which leaves
 * their Clerk invitation pending forever. */
export const getMemberEmailsAmong = internalQuery({
  args: { orgId: v.string(), emailsLower: v.array(v.string()) },
  handler: async (ctx, args) => {
    const memberEmails: string[] = [];
    for (const emailLower of args.emailsLower) {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_clerkOrgId_and_emailLower", (q) =>
          q.eq("clerkOrgId", args.orgId).eq("emailLower", emailLower),
        )
        .first();
      if (membership) memberEmails.push(emailLower);
    }
    return memberEmails;
  },
});

/** Admin-only. Invite a new member to the caller's active org via Clerk. The
 * invitee accepts in Clerk → signs in → `users.store` auto-provisions their
 * Fabric membership with the requested Convex role. Clerk only carries the
 * organization membership; Fabric owns app access. */
export const invite = action({
  args: {
    email: v.string(),
    role: v.optional(
      v.union(
        v.literal("admin"),
        v.literal("contributor"),
        v.literal("viewer"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const { orgId, orgSlug, tokenIdentifier } = await resolveOrgForAction(ctx);
    const caller = await requireAdminForAction(ctx, orgId, tokenIdentifier);
    const requestedRole = args.role ?? "contributor";

    const inviterClerkUserId = clerkUserIdFromTokenIdentifier(tokenIdentifier);
    const redirectUrl = inviteRedirectUrl(orgSlug);
    const invitation = (await clerkFetch(
      `/organizations/${orgId}/invitations`,
      {
        method: "POST",
        body: {
          email_address: args.email,
          role: "org:member",
          inviter_user_id: inviterClerkUserId,
          ...(redirectUrl ? { redirect_url: redirectUrl } : {}),
        },
      },
    )) as ClerkInvitation;

    // Defense-in-depth: Clerk should never return an invitation for a different
    // org, but re-assert in case the API contract shifts.
    if (invitation.organization_id !== orgId) {
      throw new Error("Invitation org mismatch");
    }

    await ctx.runMutation(internal.users.createMembershipIntent, {
      clerkOrgId: orgId,
      email: invitation.email_address,
      requestedRole,
      source: "adminInvite",
      invitedBy: caller.userId,
      clerkInvitationId: invitation.id,
    });

    return {
      id: invitation.id,
      email: invitation.email_address,
      role: requestedRole,
      status: invitation.status,
      createdAt: invitation.created_at,
      expiresAt: invitation.expires_at ?? null,
    };
  },
});

/** Admin-only. Lists pending invitations for the caller's active org. */
export const list = action({
  args: {},
  handler: async (ctx) => {
    const { orgId, tokenIdentifier } = await resolveOrgForAction(ctx);
    await requireAdminForAction(ctx, orgId, tokenIdentifier);

    const response = (await clerkFetch(
      `/organizations/${orgId}/invitations`,
      { query: { status: "pending", limit: "100" } },
    )) as { data: ClerkInvitation[] } | ClerkInvitation[];

    const rows = Array.isArray(response) ? response : response.data;
    const intentRoles: InvitationIntentRole[] = await ctx.runQuery(
      internal.users.getInvitationIntentRoles,
      { clerkOrgId: orgId },
    );

    // Users can join directly via the subdomain (open enrollment), which
    // fulfills an invitation without Clerk ever marking it accepted. Hide
    // those from the pending list so admins don't re-invite existing members.
    const memberEmails: string[] = await ctx.runQuery(
      internal.invitations.getMemberEmailsAmong,
      {
        orgId,
        emailsLower: rows.map((row) =>
          row.email_address.trim().toLowerCase(),
        ),
      },
    );
    const alreadyMembers = new Set(memberEmails);

    // Defense-in-depth: filter out any rows whose organization_id doesn't match
    // the JWT-derived orgId. The Clerk URL already scopes by org, but this
    // belt-and-braces guards against API shape drift.
    return rows
      .filter((row) => row.organization_id === orgId)
      .filter((row) => !alreadyMembers.has(row.email_address.trim().toLowerCase()))
      .map((row) => ({
        role:
          intentRoles.find(
            (intent) =>
              intent.clerkInvitationId === row.id ||
              intent.emailLower === row.email_address.trim().toLowerCase(),
          )?.requestedRole ?? "contributor",
        id: row.id,
        email: row.email_address,
        status: row.status,
        createdAt: row.created_at,
        expiresAt: row.expires_at ?? null,
      }));
  },
});

/** Admin-only. Revokes a pending invitation. Clerk requires the inviter's user
 * id in the body of the revoke call. */
export const revoke = action({
  args: { invitationId: v.string() },
  handler: async (ctx, args) => {
    const { orgId, tokenIdentifier } = await resolveOrgForAction(ctx);
    await requireAdminForAction(ctx, orgId, tokenIdentifier);

    const requestingUserId = clerkUserIdFromTokenIdentifier(tokenIdentifier);
    const result = (await clerkFetch(
      `/organizations/${orgId}/invitations/${args.invitationId}/revoke`,
      {
        method: "POST",
        body: { requesting_user_id: requestingUserId },
      },
    )) as ClerkInvitation;

    // Defense-in-depth: refuse to confirm success if Clerk somehow returned a
    // record for a different org.
    if (result.organization_id !== orgId) {
      throw new Error("Revoke returned a record for a different organization");
    }

    await ctx.runMutation(internal.users.markInvitationRevoked, {
      clerkOrgId: orgId,
      clerkInvitationId: args.invitationId,
    });

    return { id: result.id, status: result.status };
  },
});

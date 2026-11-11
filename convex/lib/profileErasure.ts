import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

/** What a blanked profile reads as wherever it is still shown. */
export const FORMER_MEMBER = "Former member";

/**
 * Removes a person's name and email from their global profile and marks it
 * deleted. The row itself stays: other records may still point at its id.
 * Used by a workspace purge and a person erasure (D5) and by Clerk's
 * `user.deleted` (Saish 2026-11-11: their interviews stay with the client,
 * their profile doesn't keep their details).
 */
export async function blankUserProfile(ctx: MutationCtx, user: Doc<"users">): Promise<void> {
  await ctx.db.patch(user._id, {
    name: FORMER_MEMBER,
    email: "",
    emailLower: undefined,
    jobTitle: undefined,
    hireDate: undefined,
    deletedAt: user.deletedAt ?? Date.now(),
  });
}

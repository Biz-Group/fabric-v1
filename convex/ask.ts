import { v } from "convex/values";
import { query } from "./_generated/server";
import { askFabricAvailability } from "./lib/askFabricFeature";
import { requireOrgMember } from "./lib/orgAuth";

const unavailableReasonValidator = v.union(
  v.literal("switchOff"),
  v.literal("missingConfig"),
  v.literal("invalidConfig"),
);

/**
 * Whether AskFabric is available in the caller's active org (FR-9.6). Members
 * see only "unavailable"; admins also get the reason, which `/admin` shows.
 */
export const getAvailability = query({
  args: {},
  returns: v.object({
    available: v.boolean(),
    reason: v.union(unavailableReasonValidator, v.null()),
  }),
  handler: async (ctx) => {
    const org = await requireOrgMember(ctx);
    const availability = askFabricAvailability(org.orgId);
    if (availability.available) return { available: true, reason: null };
    return {
      available: false,
      reason: org.role === "admin" ? availability.reason : null,
    };
  },
});

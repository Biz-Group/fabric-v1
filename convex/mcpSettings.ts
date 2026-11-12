import { v } from "convex/values";
import { env, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrgAdmin, requireOrgMember, requireSuperAdmin } from "./lib/orgAuth";
import { isOrgInRollout, parseOrgRollout } from "./lib/orgRollout";
import { userError } from "./lib/userError";
import { MCP_POLICY, MCP_POLICY_ACCEPTANCE } from "./mcp/policy";
import { workspaceMcpUrl } from "./mcp/urls";

/**
 * Fabric MCP server settings (docs/fabric-mcp-build-task-list.md, Phase 2).
 *
 * Three gates, all required for any MCP access:
 *   1. the deployment switch `FABRIC_MCP` (env; emergency off),
 *   2. the paid add-on, granted by Fabric staff in the tenants console (M6),
 *   3. the workspace admin's switch, with the residency policy accepted (M1, M4).
 * Fabric staff may flip the admin switch too; it is then labelled "Enabled by
 * Fabric staff" for the workspace's own admins (B5).
 */

type Features = Doc<"orgFeatures">;

async function readFeatures(ctx: QueryCtx | MutationCtx, clerkOrgId: string): Promise<Features | null> {
  return await ctx.db
    .query("orgFeatures")
    .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", clerkOrgId))
    .first();
}

async function writeFeatures(
  ctx: MutationCtx,
  clerkOrgId: string,
  patch: Partial<Omit<Features, "_id" | "_creationTime" | "clerkOrgId">>,
): Promise<void> {
  const existing = await readFeatures(ctx, clerkOrgId);
  const updatedAt = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, { ...patch, updatedAt });
  } else {
    await ctx.db.insert("orgFeatures", {
      clerkOrgId,
      mcpGranted: false,
      mcpEnabled: false,
      mcpConversationTools: false,
      ...patch,
      updatedAt,
    });
  }
}

async function audit(
  ctx: MutationCtx,
  clerkOrgId: string,
  actorUserId: Id<"users">,
  action: "mcpGranted" | "mcpRevoked" | "mcpEnabled" | "mcpDisabled" | "mcpConversationToolsChanged",
  detail?: string,
): Promise<void> {
  await ctx.db.insert("authAuditEvents", { clerkOrgId, actorUserId, action, ...(detail ? { detail } : {}), createdAt: Date.now() });
}

function deploymentAllows(clerkOrgId: string): boolean {
  return isOrgInRollout(parseOrgRollout(env.FABRIC_MCP), clerkOrgId);
}

/** What the MCP endpoint needs to know about a workspace, on every request. */
export async function mcpAccessFor(
  ctx: QueryCtx,
  clerkOrgId: string,
): Promise<{ enabled: boolean; conversationTools: boolean }> {
  const features = await readFeatures(ctx, clerkOrgId);
  const enabled = deploymentAllows(clerkOrgId) && features?.mcpGranted === true && features.mcpEnabled === true;
  return { enabled, conversationTools: enabled && features?.mcpConversationTools === true };
}

async function userName(ctx: QueryCtx, userId: Id<"users"> | undefined): Promise<string | null> {
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  return user?.name ?? user?.email ?? null;
}

async function slugFor(ctx: QueryCtx, clerkOrgId: string): Promise<string | null> {
  const tenant = await ctx.db
    .query("tenants")
    .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", clerkOrgId))
    .first();
  return tenant?.slug ?? null;
}

// ---- Members -------------------------------------------------------------------

/**
 * For the "Connect AI assistants" page and its help-menu link (B6). Any
 * member; "unavailable" when the add-on isn't granted, so members never see
 * a feature their workspace hasn't bought.
 */
export const mySetup = query({
  args: {},
  handler: async (ctx) => {
    // Shown in the header's help menu, so signed-out or not-yet-a-member
    // callers get "unavailable" rather than an error, as getMyOnboarding does.
    let org: Awaited<ReturnType<typeof requireOrgMember>>;
    try {
      org = await requireOrgMember(ctx);
    } catch {
      return { status: "unavailable" as const };
    }
    const features = await readFeatures(ctx, org.orgId);
    if (!deploymentAllows(org.orgId) || features?.mcpGranted !== true) return { status: "unavailable" as const };
    if (!features.mcpEnabled) return { status: "off" as const, isAdmin: org.role === "admin" };
    const slug = await slugFor(ctx, org.orgId);
    return {
      status: "on" as const,
      isAdmin: org.role === "admin",
      workspaceUrl: slug ? workspaceMcpUrl(slug) : null,
    };
  },
});

// ---- Workspace admins ----------------------------------------------------------------

/** For Admin → MCP. `granted: false` hides the page and its nav item. */
export const adminSettings = query({
  args: {},
  handler: async (ctx) => {
    const org = await requireOrgAdmin(ctx);
    const features = await readFeatures(ctx, org.orgId);
    if (!deploymentAllows(org.orgId) || features?.mcpGranted !== true) return { granted: false as const };
    const slug = await slugFor(ctx, org.orgId);
    return {
      granted: true as const,
      enabled: features.mcpEnabled,
      enabledAt: features.mcpEnabledAt ?? null,
      enabledByName: await userName(ctx, features.mcpEnabledByUserId),
      enabledByStaff: features.mcpEnabledByStaff === true,
      acceptedPolicyVersion: features.mcpPolicyVersion ?? null,
      conversationTools: features.mcpConversationTools,
      policy: { ...MCP_POLICY, acceptance: MCP_POLICY_ACCEPTANCE },
      workspaceUrl: slug ? workspaceMcpUrl(slug) : null,
    };
  },
});

async function actorFor(ctx: MutationCtx, userId: Id<"users">): Promise<Doc<"users">> {
  const user = await ctx.db.get(userId);
  if (!user) throw userError("NOT_FOUND", "Your profile could not be found.");
  return user;
}

export const setEnabled = mutation({
  args: { enabled: v.boolean(), acceptedPolicyVersion: v.union(v.string(), v.null()) },
  handler: async (ctx, { enabled, acceptedPolicyVersion }) => {
    const org = await requireOrgAdmin(ctx);
    const features = await readFeatures(ctx, org.orgId);
    if (!deploymentAllows(org.orgId) || features?.mcpGranted !== true) {
      throw userError("MCP_NOT_GRANTED", "AI assistant access isn't part of this workspace's plan.");
    }
    if (features.mcpEnabled === enabled) return null;
    const actor = await actorFor(ctx, org.userId);
    if (enabled) {
      if (acceptedPolicyVersion !== MCP_POLICY.version) {
        throw userError("MCP_POLICY_NOT_ACCEPTED", "Accept the current terms to switch this on.");
      }
      await writeFeatures(ctx, org.orgId, {
        mcpEnabled: true,
        mcpEnabledAt: Date.now(),
        mcpEnabledByUserId: actor._id,
        mcpEnabledByStaff: actor.platformRole === "superAdmin",
        mcpPolicyVersion: MCP_POLICY.version,
      });
      await audit(ctx, org.orgId, actor._id, "mcpEnabled", `policy ${MCP_POLICY.version}${actor.platformRole === "superAdmin" ? ", by Fabric staff" : ""}`);
    } else {
      await writeFeatures(ctx, org.orgId, { mcpEnabled: false });
      await audit(ctx, org.orgId, actor._id, "mcpDisabled");
    }
    return null;
  },
});

export const setConversationTools = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const org = await requireOrgAdmin(ctx);
    const features = await readFeatures(ctx, org.orgId);
    if (!deploymentAllows(org.orgId) || features?.mcpGranted !== true) {
      throw userError("MCP_NOT_GRANTED", "AI assistant access isn't part of this workspace's plan.");
    }
    if (features.mcpConversationTools === enabled) return null;
    await writeFeatures(ctx, org.orgId, { mcpConversationTools: enabled });
    await audit(ctx, org.orgId, org.userId, "mcpConversationToolsChanged", enabled ? "on" : "off");
    return null;
  },
});

// ---- Fabric staff (tenants console) ----------------------------------------------------

/** The add-on card on tenants-console/[tenantId]. */
export const tenantAddOn = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, { tenantId }) => {
    await requireSuperAdmin(ctx);
    const tenant = await ctx.db.get(tenantId);
    if (!tenant) return null;
    const features = await readFeatures(ctx, tenant.clerkOrgId);
    return {
      deploymentAllows: deploymentAllows(tenant.clerkOrgId),
      granted: features?.mcpGranted === true,
      grantedAt: features?.mcpGrantedAt ?? null,
      grantedByName: await userName(ctx, features?.mcpGrantedByUserId),
      enabled: features?.mcpEnabled === true,
      enabledAt: features?.mcpEnabledAt ?? null,
      enabledByName: await userName(ctx, features?.mcpEnabledByUserId),
      enabledByStaff: features?.mcpEnabledByStaff === true,
      conversationTools: features?.mcpConversationTools === true,
    };
  },
});

/**
 * Grants or revokes the add-on. Revoking also switches MCP off, so a later
 * grant needs the workspace's admin to switch it on and accept the terms again.
 */
export const setGranted = mutation({
  args: { tenantId: v.id("tenants"), granted: v.boolean() },
  handler: async (ctx, { tenantId, granted }) => {
    const staff = await requireSuperAdmin(ctx);
    const tenant = await ctx.db.get(tenantId);
    if (!tenant) throw userError("NOT_FOUND", "Workspace not found.");
    const features = await readFeatures(ctx, tenant.clerkOrgId);
    if ((features?.mcpGranted === true) === granted) return null;
    if (granted) {
      await writeFeatures(ctx, tenant.clerkOrgId, { mcpGranted: true, mcpGrantedAt: Date.now(), mcpGrantedByUserId: staff._id });
      await audit(ctx, tenant.clerkOrgId, staff._id, "mcpGranted");
    } else {
      await writeFeatures(ctx, tenant.clerkOrgId, { mcpGranted: false, mcpEnabled: false });
      await audit(ctx, tenant.clerkOrgId, staff._id, "mcpRevoked");
    }
    return null;
  },
});

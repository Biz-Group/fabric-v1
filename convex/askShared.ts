import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSuperAdmin } from "./lib/orgAuth";

/**
 * Shared AskFabric exchanges for the Fabric team (FR-7.3, D20). Super admins
 * only; org admins have no path to them. The list shows metadata only;
 * opening one is a mutation so the audit row and the read are one transaction.
 */

const LIST_LIMIT = 100;

export const listSharedExchanges = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);
    // Newest first: retention is fixed, so the latest expiry is the latest share.
    const rows = await ctx.db.query("askSharedExchanges").withIndex("by_expiresAt").order("desc").take(LIST_LIMIT);
    const tenantNames = new Map<string, string>();
    for (const row of rows) {
      if (tenantNames.has(row.clerkOrgId)) continue;
      const tenant = await ctx.db
        .query("tenants")
        .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", row.clerkOrgId))
        .unique();
      tenantNames.set(row.clerkOrgId, tenant?.name ?? row.clerkOrgId);
    }
    return rows.map((row) => ({
      _id: row._id,
      tenantName: tenantNames.get(row.clerkOrgId)!,
      sharedAt: row.sharedAt,
      expiresAt: row.expiresAt,
      hasNote: row.note !== undefined,
      citations: row.citations.length,
      toolCalls: row.toolCalls.length,
    }));
  },
});

export const viewSharedExchange = mutation({
  args: { exchangeId: v.id("askSharedExchanges") },
  handler: async (ctx, args) => {
    const admin = await requireSuperAdmin(ctx);
    const row = await ctx.db.get(args.exchangeId);
    if (!row) return null;
    await ctx.db.insert("authAuditEvents", {
      clerkOrgId: row.clerkOrgId,
      actorUserId: admin._id,
      targetUserId: row.userId,
      action: "sharedExchangeViewed",
      detail: `AskFabric shared exchange ${row._id}`,
      createdAt: Date.now(),
    });
    return {
      sharedAt: row.sharedAt,
      expiresAt: row.expiresAt,
      question: row.question,
      answer: row.answer,
      reasoning: row.reasoning,
      citations: row.citations,
      toolCalls: row.toolCalls,
      note: row.note ?? null,
    };
  },
});

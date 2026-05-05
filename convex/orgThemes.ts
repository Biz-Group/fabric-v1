import { v } from "convex/values";
import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { getActiveOrgClaims, requireAuth, requireOrgAdmin } from "./lib/orgAuth";
import { buildOrgThemeTokens, clampRgb } from "./themeColors";

async function requireActiveOrgId(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await requireAuth(ctx);
  const { orgId } = getActiveOrgClaims(identity);
  if (!orgId) throw new Error("No active organization");
  return orgId;
}

async function getExistingTheme(ctx: QueryCtx | MutationCtx, clerkOrgId: string) {
  return await ctx.db
    .query("orgThemes")
    .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", clerkOrgId))
    .unique();
}

function cleanReason(reason: string): string {
  return reason.trim().slice(0, 240) || "Logo color extraction failed.";
}

function hasRuntimeTokens(theme: Awaited<ReturnType<typeof getExistingTheme>>) {
  return Boolean(
    theme &&
      ((theme.activeLightTokens && theme.activeDarkTokens) ||
        (theme.lightTokens && theme.darkTokens)),
  );
}

function getRuntimeTokens(theme: Awaited<ReturnType<typeof getExistingTheme>>) {
  if (!theme) return null;
  if (theme.status !== "ready" && theme.status !== "override") return null;

  const lightTokens = theme.activeLightTokens ?? theme.lightTokens;
  const darkTokens = theme.activeDarkTokens ?? theme.darkTokens;
  if (!lightTokens || !darkTokens) return null;

  return {
    status: theme.status,
    sourceLogoUrl: theme.sourceLogoUrl,
    lightTokens,
    darkTokens,
    adminApprovedAt: theme.adminApprovedAt ?? null,
    updatedAt: theme.updatedAt,
  };
}

export const getForCurrentOrg = query({
  args: {},
  handler: async (ctx) => {
    const clerkOrgId = await requireActiveOrgId(ctx);
    const theme = await getExistingTheme(ctx, clerkOrgId);
    return getRuntimeTokens(theme);
  },
});

export const getThemeAdminState = query({
  args: {},
  handler: async (ctx) => {
    const org = await requireOrgAdmin(ctx);
    return await getExistingTheme(ctx, org.orgId);
  },
});

export const startThemeGeneration = mutation({
  args: {
    sourceLogoUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const org = await requireOrgAdmin(ctx);
    const now = Date.now();
    const existing = await getExistingTheme(ctx, org.orgId);

    const patch = {
      sourceLogoUrl: args.sourceLogoUrl,
      status: "extracting" as const,
      extractionAttempts: (existing?.extractionAttempts ?? 0) + 1,
      lastExtractionRequestedAt: now,
      lastExtractionError: undefined,
      fallbackReason: undefined,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("orgThemes", {
      clerkOrgId: org.orgId,
      ...patch,
    });
  },
});

export const saveGeneratedCandidate = mutation({
  args: {
    sourceLogoUrl: v.string(),
    accentRgb: v.object({
      r: v.number(),
      g: v.number(),
      b: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const org = await requireOrgAdmin(ctx);
    const accentRgb = clampRgb(args.accentRgb);
    const tokens = buildOrgThemeTokens(accentRgb);
    const now = Date.now();
    const existing = await getExistingTheme(ctx, org.orgId);
    const candidateFields = {
      sourceLogoUrl: args.sourceLogoUrl,
      status: "pending" as const,
      candidateAccentRgb: accentRgb,
      candidateLightTokens: tokens.lightTokens,
      candidateDarkTokens: tokens.darkTokens,
      candidateGeneratedAt: now,
      lastExtractionError: undefined,
      fallbackReason: undefined,
      extractedAt: now,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, candidateFields);
      return existing._id;
    }

    return await ctx.db.insert("orgThemes", {
      clerkOrgId: org.orgId,
      extractionAttempts: 1,
      lastExtractionRequestedAt: now,
      ...candidateFields,
    });
  },
});

export const approveCandidateTheme = mutation({
  args: {},
  handler: async (ctx) => {
    const org = await requireOrgAdmin(ctx);
    const existing = await getExistingTheme(ctx, org.orgId);
    if (!existing?.candidateLightTokens || !existing.candidateDarkTokens) {
      throw new Error("No generated theme candidate to approve.");
    }

    const now = Date.now();
    await ctx.db.patch(existing._id, {
      status: "ready",
      activeAccentRgb: existing.candidateAccentRgb ?? existing.accentRgb,
      activeLightTokens: existing.candidateLightTokens,
      activeDarkTokens: existing.candidateDarkTokens,
      // Legacy fields stay in sync during the migration window.
      accentRgb: existing.candidateAccentRgb ?? existing.accentRgb,
      lightTokens: existing.candidateLightTokens,
      darkTokens: existing.candidateDarkTokens,
      candidateAccentRgb: undefined,
      candidateLightTokens: undefined,
      candidateDarkTokens: undefined,
      candidateGeneratedAt: undefined,
      adminApprovedAt: now,
      approvedByUserId: org.userId,
      lastExtractionError: undefined,
      fallbackReason: undefined,
      updatedAt: now,
    });
    return existing._id;
  },
});

export const rejectCandidateTheme = mutation({
  args: {},
  handler: async (ctx) => {
    const org = await requireOrgAdmin(ctx);
    const existing = await getExistingTheme(ctx, org.orgId);
    if (!existing) return null;

    const hasActive = hasRuntimeTokens(existing);
    await ctx.db.patch(existing._id, {
      status: hasActive ? "ready" : "pending",
      candidateAccentRgb: undefined,
      candidateLightTokens: undefined,
      candidateDarkTokens: undefined,
      candidateGeneratedAt: undefined,
      fallbackReason: hasActive ? undefined : "Generated theme was rejected.",
      updatedAt: Date.now(),
    });
    return existing._id;
  },
});

export const markThemeGenerationFailed = mutation({
  args: {
    sourceLogoUrl: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const org = await requireOrgAdmin(ctx);
    const now = Date.now();
    const existing = await getExistingTheme(ctx, org.orgId);
    const hasActive = hasRuntimeTokens(existing);
    const failedFields = {
      sourceLogoUrl: args.sourceLogoUrl,
      status: hasActive ? "ready" as const : "failed" as const,
      lastExtractionError: cleanReason(args.reason),
      fallbackReason: hasActive ? undefined : cleanReason(args.reason),
      extractedAt: now,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...failedFields,
        candidateAccentRgb: undefined,
        candidateLightTokens: undefined,
        candidateDarkTokens: undefined,
      });
      return existing._id;
    }

    return await ctx.db.insert("orgThemes", {
      clerkOrgId: org.orgId,
      extractionAttempts: 1,
      lastExtractionRequestedAt: now,
      ...failedFields,
    });
  },
});

export const resetToNeutral = mutation({
  args: {},
  handler: async (ctx) => {
    const org = await requireOrgAdmin(ctx);
    const existing = await getExistingTheme(ctx, org.orgId);
    if (!existing) return null;

    await ctx.db.patch(existing._id, {
      status: "pending",
      activeAccentRgb: undefined,
      activeLightTokens: undefined,
      activeDarkTokens: undefined,
      adminApprovedAt: undefined,
      approvedByUserId: undefined,
      candidateAccentRgb: undefined,
      candidateLightTokens: undefined,
      candidateDarkTokens: undefined,
      candidateGeneratedAt: undefined,
      accentRgb: undefined,
      lightTokens: undefined,
      darkTokens: undefined,
      fallbackReason: undefined,
      updatedAt: Date.now(),
    });
    return existing._id;
  },
});
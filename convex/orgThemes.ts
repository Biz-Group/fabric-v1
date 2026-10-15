import { v } from "convex/values";
import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { requireOrgAdmin, requireOrgMember } from "./lib/orgAuth";
import { authErrorCode } from "./lib/authErrors";
import { userError } from "./lib/userError";
import { buildOrgThemeTokens, clampRgb } from "./themeColors";

const MANUAL_OVERRIDE_REASON = "Manual accent color selected by admin.";

const NO_PREVIOUS_THEME = {
  previousAccentRgb: undefined,
  previousLightTokens: undefined,
  previousDarkTokens: undefined,
  previousSource: undefined,
  previousApprovedAt: undefined,
};

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

function activeStatusFor(theme: Awaited<ReturnType<typeof getExistingTheme>>) {
  if (theme?.activeSource === "manual" || theme?.status === "override") {
    return "override" as const;
  }
  return "ready" as const;
}

/**
 * The approved theme as a `previous*` patch, so whatever replaces or clears it
 * can keep it for "Restore previous theme". Reads the active fields, else the
 * legacy ones on rows from before the migration. Null when no approved theme
 * exists (the workspace is neutral).
 */
function approvedThemeAsPrevious(
  theme: Awaited<ReturnType<typeof getExistingTheme>>,
) {
  if (!theme) return null;
  const lightTokens = theme.activeLightTokens ?? theme.lightTokens;
  const darkTokens = theme.activeDarkTokens ?? theme.darkTokens;
  if (!lightTokens || !darkTokens) return null;

  return {
    previousAccentRgb: theme.activeAccentRgb ?? theme.accentRgb,
    previousLightTokens: lightTokens,
    previousDarkTokens: darkTokens,
    previousSource:
      theme.activeSource ??
      (activeStatusFor(theme) === "override" ? ("manual" as const) : ("logo" as const)),
    previousApprovedAt: theme.adminApprovedAt,
  };
}

/**
 * The approved theme the workspace wears, or null for neutral. Keyed on the
 * approved tokens, not `status`: `status` also tracks the candidate workflow
 * ("extracting", "pending", "failed"), and generating or reviewing a new
 * candidate must not take the approved theme off the live workspace. Only
 * approval and restore write these tokens and only a reset clears them, so
 * their presence means an admin approved what they hold.
 */
function getRuntimeTokens(theme: Awaited<ReturnType<typeof getExistingTheme>>) {
  if (!theme) return null;

  const lightTokens = theme.activeLightTokens ?? theme.lightTokens;
  const darkTokens = theme.activeDarkTokens ?? theme.darkTokens;
  if (!lightTokens || !darkTokens) return null;

  return {
    status: activeStatusFor(theme),
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
    // Members only, like every other tenant read. The workspace also renders
    // this theme around its "setting up" and "access removed" screens, so a
    // caller who isn't (or isn't yet) a member gets the default theme rather
    // than an error.
    let orgId: string;
    try {
      ({ orgId } = await requireOrgMember(ctx));
    } catch (error) {
      if (authErrorCode(error)) return null;
      throw error;
    }
    const theme = await getExistingTheme(ctx, orgId);
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
      candidateSource: "logo" as const,
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

export const saveManualCandidate = mutation({
  args: {
    sourceLogoUrl: v.optional(v.string()),
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
      sourceLogoUrl: args.sourceLogoUrl ?? existing?.sourceLogoUrl ?? "manual",
      status: "pending" as const,
      candidateAccentRgb: accentRgb,
      candidateLightTokens: tokens.lightTokens,
      candidateDarkTokens: tokens.darkTokens,
      candidateSource: "manual" as const,
      candidateGeneratedAt: now,
      lastExtractionError: undefined,
      fallbackReason: undefined,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, candidateFields);
      return existing._id;
    }

    return await ctx.db.insert("orgThemes", {
      clerkOrgId: org.orgId,
      extractionAttempts: 0,
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
    const candidateSource = existing.candidateSource ?? "logo";
    await ctx.db.patch(existing._id, {
      // The theme this replaces stays restorable. Approving from neutral keeps
      // the slot as it was, so a theme cleared by a reset can still come back.
      ...approvedThemeAsPrevious(existing),
      status: candidateSource === "manual" ? "override" : "ready",
      activeAccentRgb: existing.candidateAccentRgb ?? existing.accentRgb,
      activeLightTokens: existing.candidateLightTokens,
      activeDarkTokens: existing.candidateDarkTokens,
      activeSource: candidateSource,
      // Legacy fields stay in sync during the migration window.
      accentRgb: existing.candidateAccentRgb ?? existing.accentRgb,
      lightTokens: existing.candidateLightTokens,
      darkTokens: existing.candidateDarkTokens,
      candidateAccentRgb: undefined,
      candidateLightTokens: undefined,
      candidateDarkTokens: undefined,
      candidateSource: undefined,
      candidateGeneratedAt: undefined,
      adminApprovedAt: now,
      approvedByUserId: org.userId,
      lastExtractionError: undefined,
      overrideReason:
        candidateSource === "manual" ? MANUAL_OVERRIDE_REASON : undefined,
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
    const activeStatus = activeStatusFor(existing);
    await ctx.db.patch(existing._id, {
      status: hasActive ? activeStatus : "pending",
      candidateAccentRgb: undefined,
      candidateLightTokens: undefined,
      candidateDarkTokens: undefined,
      candidateSource: undefined,
      candidateGeneratedAt: undefined,
      fallbackReason: hasActive ? undefined : "Generated theme was rejected.",
      overrideReason:
        hasActive && activeStatus === "override" ? existing.overrideReason : undefined,
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
    const activeStatus = activeStatusFor(existing);
    const failedFields = {
      sourceLogoUrl: args.sourceLogoUrl,
      status: hasActive ? activeStatus : "failed" as const,
      lastExtractionError: cleanReason(args.reason),
      fallbackReason: hasActive ? undefined : cleanReason(args.reason),
      overrideReason:
        hasActive && activeStatus === "override" ? existing?.overrideReason : undefined,
      extractedAt: now,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...failedFields,
        candidateAccentRgb: undefined,
        candidateLightTokens: undefined,
        candidateDarkTokens: undefined,
        candidateSource: undefined,
        candidateGeneratedAt: undefined,
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
      // Keep the cleared theme restorable, so a reset can be undone.
      ...approvedThemeAsPrevious(existing),
      status: "pending",
      activeAccentRgb: undefined,
      activeLightTokens: undefined,
      activeDarkTokens: undefined,
      activeSource: undefined,
      adminApprovedAt: undefined,
      approvedByUserId: undefined,
      candidateAccentRgb: undefined,
      candidateLightTokens: undefined,
      candidateDarkTokens: undefined,
      candidateSource: undefined,
      candidateGeneratedAt: undefined,
      accentRgb: undefined,
      lightTokens: undefined,
      darkTokens: undefined,
      overrideReason: undefined,
      fallbackReason: undefined,
      updatedAt: Date.now(),
    });
    return existing._id;
  },
});

export const restorePreviousTheme = mutation({
  args: {},
  handler: async (ctx) => {
    const org = await requireOrgAdmin(ctx);
    const existing = await getExistingTheme(ctx, org.orgId);
    if (!existing?.previousLightTokens || !existing.previousDarkTokens) {
      throw userError("NO_PREVIOUS_THEME", "There's no earlier theme to restore.");
    }

    const now = Date.now();
    const restoredSource = existing.previousSource ?? "logo";
    await ctx.db.patch(existing._id, {
      // The theme being replaced takes the slot, so restoring again swaps
      // back. Restoring over neutral leaves nothing earlier to keep.
      ...NO_PREVIOUS_THEME,
      ...approvedThemeAsPrevious(existing),
      status: restoredSource === "manual" ? "override" : "ready",
      activeAccentRgb: existing.previousAccentRgb,
      activeLightTokens: existing.previousLightTokens,
      activeDarkTokens: existing.previousDarkTokens,
      activeSource: restoredSource,
      // Legacy fields stay in sync during the migration window.
      accentRgb: existing.previousAccentRgb,
      lightTokens: existing.previousLightTokens,
      darkTokens: existing.previousDarkTokens,
      // A candidate awaiting approval is dropped, as a reset drops it: it was
      // proposed against the theme this replaces.
      candidateAccentRgb: undefined,
      candidateLightTokens: undefined,
      candidateDarkTokens: undefined,
      candidateSource: undefined,
      candidateGeneratedAt: undefined,
      adminApprovedAt: now,
      approvedByUserId: org.userId,
      overrideReason:
        restoredSource === "manual" ? MANUAL_OVERRIDE_REASON : undefined,
      fallbackReason: undefined,
      updatedAt: now,
    });
    return existing._id;
  },
});
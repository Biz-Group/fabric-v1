/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";
import { buildOrgThemeTokens } from "./themeColors";

const modules = import.meta.glob("./**/*.ts");

const ORG_ID = "org_theme_test";
const OTHER_ORG_ID = "org_theme_other";
const ISSUER = "https://test.clerk";

const BLUE = { r: 28, g: 95, b: 210 };
const ORANGE = { r: 220, g: 76, b: 44 };
const MAGENTA = { r: 180, g: 48, b: 92 };

type SeededThemeUsers = {
  adminId: Id<"users">;
  contributorId: Id<"users">;
};

async function seedThemeUsers(
  t: ReturnType<typeof convexTest>,
): Promise<SeededThemeUsers> {
  return await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("users", {
      tokenIdentifier: `${ISSUER}|theme_admin`,
      name: "Theme Admin",
      email: "admin@example.com",
      profileComplete: true,
    });
    const contributorId = await ctx.db.insert("users", {
      tokenIdentifier: `${ISSUER}|theme_contributor`,
      name: "Theme Contributor",
      email: "contributor@example.com",
      profileComplete: true,
    });

    await ctx.db.insert("memberships", {
      tokenIdentifier: `${ISSUER}|theme_admin`,
      userId: adminId,
      clerkOrgId: ORG_ID,
      role: "admin",
      createdAt: Date.now(),
    });
    await ctx.db.insert("memberships", {
      tokenIdentifier: `${ISSUER}|theme_contributor`,
      userId: contributorId,
      clerkOrgId: ORG_ID,
      role: "contributor",
      createdAt: Date.now(),
    });

    return { adminId, contributorId };
  });
}

function identityFor(userId: "theme_admin" | "theme_contributor") {
  return {
    tokenIdentifier: `${ISSUER}|${userId}`,
    subject: userId,
    issuer: ISSUER,
    orgId: ORG_ID,
    orgSlug: "theme-test",
  };
}

async function seedOtherOrgAdmin(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: `${ISSUER}|other_admin`,
      name: "Other Admin",
      email: "other-admin@example.com",
      profileComplete: true,
    });
    await ctx.db.insert("memberships", {
      tokenIdentifier: `${ISSUER}|other_admin`,
      userId,
      clerkOrgId: OTHER_ORG_ID,
      role: "admin",
      createdAt: Date.now(),
    });
  });
  return t.withIdentity({
    tokenIdentifier: `${ISSUER}|other_admin`,
    subject: "other_admin",
    issuer: ISSUER,
    orgId: OTHER_ORG_ID,
    orgSlug: "theme-other",
  });
}

type ThemeCaller = ReturnType<ReturnType<typeof convexTest>["withIdentity"]>;

async function approveTheme(
  caller: ThemeCaller,
  accentRgb: { r: number; g: number; b: number },
  source: "logo" | "manual" = "logo",
) {
  if (source === "manual") {
    await caller.mutation(api.orgThemes.saveManualCandidate, { accentRgb });
  } else {
    await caller.mutation(api.orgThemes.saveGeneratedCandidate, {
      sourceLogoUrl: "https://example.com/logo.png",
      accentRgb,
    });
  }
  await caller.mutation(api.orgThemes.approveCandidateTheme);
}

// convex-test leaves ConvexError data as its JSON string.
async function rejectionData(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (rejection: unknown) => rejection,
  );
  const data = (error as { data?: unknown } | null)?.data;
  return typeof data === "string" ? JSON.parse(data) : data;
}

describe("org theme workflow", () => {
  test("admin-generated candidates are inert until approved", async () => {
    const t = convexTest(schema, modules);
    await seedThemeUsers(t);
    const admin = t.withIdentity(identityFor("theme_admin"));

    await admin.mutation(api.orgThemes.saveGeneratedCandidate, {
      sourceLogoUrl: "https://example.com/logo.png",
      accentRgb: { r: 28, g: 95, b: 210 },
    });

    const runtimeBeforeApproval = await admin.query(api.orgThemes.getForCurrentOrg);
    expect(runtimeBeforeApproval).toBeNull();

    const adminState = await admin.query(api.orgThemes.getThemeAdminState);
    expect(adminState?.status).toBe("pending");
    expect(adminState?.candidateLightTokens).toBeTruthy();

    await admin.mutation(api.orgThemes.approveCandidateTheme);

    const runtimeAfterApproval = await admin.query(api.orgThemes.getForCurrentOrg);
    expect(runtimeAfterApproval?.status).toBe("ready");
    expect(runtimeAfterApproval?.lightTokens.accent).toMatch(/^oklch\(/);

    const approvedState = await admin.query(api.orgThemes.getThemeAdminState);
    expect(approvedState?.candidateLightTokens).toBeUndefined();
    expect(approvedState?.activeLightTokens).toBeTruthy();
  });

  test("contributors cannot generate org themes", async () => {
    const t = convexTest(schema, modules);
    await seedThemeUsers(t);

    await expect(
      t.withIdentity(identityFor("theme_contributor")).mutation(
        api.orgThemes.saveGeneratedCandidate,
        {
          sourceLogoUrl: "https://example.com/logo.png",
          accentRgb: { r: 28, g: 95, b: 210 },
        },
      ),
    ).rejects.toThrow("Insufficient permissions");
  });

  test("manual color candidates are inert until approved as overrides", async () => {
    const t = convexTest(schema, modules);
    await seedThemeUsers(t);
    const admin = t.withIdentity(identityFor("theme_admin"));

    await admin.mutation(api.orgThemes.saveManualCandidate, {
      accentRgb: { r: 180, g: 48, b: 92 },
    });

    const runtimeBeforeApproval = await admin.query(api.orgThemes.getForCurrentOrg);
    const candidateState = await admin.query(api.orgThemes.getThemeAdminState);
    expect(runtimeBeforeApproval).toBeNull();
    expect(candidateState?.candidateSource).toBe("manual");

    await admin.mutation(api.orgThemes.approveCandidateTheme);

    const runtimeAfterApproval = await admin.query(api.orgThemes.getForCurrentOrg);
    const approvedState = await admin.query(api.orgThemes.getThemeAdminState);
    expect(runtimeAfterApproval?.status).toBe("override");
    expect(approvedState?.activeSource).toBe("manual");
    expect(approvedState?.candidateSource).toBeUndefined();
    expect(approvedState?.overrideReason).toBe("Manual accent color selected by admin.");
  });

  test("reset removes active and candidate runtime tokens", async () => {
    const t = convexTest(schema, modules);
    await seedThemeUsers(t);
    const admin = t.withIdentity(identityFor("theme_admin"));

    await admin.mutation(api.orgThemes.saveGeneratedCandidate, {
      sourceLogoUrl: "https://example.com/logo.png",
      accentRgb: { r: 28, g: 95, b: 210 },
    });
    await admin.mutation(api.orgThemes.approveCandidateTheme);
    await admin.mutation(api.orgThemes.saveGeneratedCandidate, {
      sourceLogoUrl: "https://example.com/logo-v2.png",
      accentRgb: { r: 220, g: 76, b: 44 },
    });

    await admin.mutation(api.orgThemes.resetToNeutral);

    const runtime = await admin.query(api.orgThemes.getForCurrentOrg);
    const adminState = await admin.query(api.orgThemes.getThemeAdminState);
    expect(runtime).toBeNull();
    expect(adminState?.activeLightTokens).toBeUndefined();
    expect(adminState?.candidateLightTokens).toBeUndefined();
  });

  test("legacy ready rows still hydrate runtime tokens during migration", async () => {
    const t = convexTest(schema, modules);
    await seedThemeUsers(t);
    const tokens = buildOrgThemeTokens({ r: 28, g: 95, b: 210 });

    await t.run(async (ctx) => {
      await ctx.db.insert("orgThemes", {
        clerkOrgId: ORG_ID,
        sourceLogoUrl: "https://example.com/legacy-logo.png",
        status: "ready",
        accentRgb: { r: 28, g: 95, b: 210 },
        lightTokens: tokens.lightTokens,
        darkTokens: tokens.darkTokens,
        updatedAt: Date.now(),
      });
    });

    const runtime = await t
      .withIdentity(identityFor("theme_admin"))
      .query(api.orgThemes.getForCurrentOrg);

    expect(runtime?.lightTokens.accent).toBe(tokens.lightTokens.accent);
  });
});

describe("restoring the previous theme", () => {
  test("restores the theme a newer approval replaced, and restoring again swaps back", async () => {
    const t = convexTest(schema, modules);
    await seedThemeUsers(t);
    const admin = t.withIdentity(identityFor("theme_admin"));
    const blue = buildOrgThemeTokens(BLUE);
    const magenta = buildOrgThemeTokens(MAGENTA);

    await approveTheme(admin, BLUE);
    await approveTheme(admin, MAGENTA, "manual");

    const beforeRestore = await admin.query(api.orgThemes.getThemeAdminState);
    expect(beforeRestore?.previousLightTokens).toEqual(blue.lightTokens);
    expect(beforeRestore?.previousSource).toBe("logo");

    await admin.mutation(api.orgThemes.restorePreviousTheme);

    const runtime = await admin.query(api.orgThemes.getForCurrentOrg);
    const restored = await admin.query(api.orgThemes.getThemeAdminState);
    expect(runtime?.status).toBe("ready");
    expect(runtime?.lightTokens).toEqual(blue.lightTokens);
    expect(runtime?.darkTokens).toEqual(blue.darkTokens);
    expect(restored?.activeSource).toBe("logo");
    expect(restored?.activeAccentRgb).toEqual(BLUE);
    expect(restored?.overrideReason).toBeUndefined();
    // The replaced manual theme is now the one to restore.
    expect(restored?.previousLightTokens).toEqual(magenta.lightTokens);
    expect(restored?.previousSource).toBe("manual");

    await admin.mutation(api.orgThemes.restorePreviousTheme);

    const swappedBack = await admin.query(api.orgThemes.getThemeAdminState);
    expect(swappedBack?.status).toBe("override");
    expect(swappedBack?.activeLightTokens).toEqual(magenta.lightTokens);
    expect(swappedBack?.overrideReason).toBe("Manual accent color selected by admin.");
    expect(swappedBack?.previousLightTokens).toEqual(blue.lightTokens);
  });

  test("undoes a reset to neutral, and a later approval from neutral keeps it restorable", async () => {
    const t = convexTest(schema, modules);
    await seedThemeUsers(t);
    const admin = t.withIdentity(identityFor("theme_admin"));
    const blue = buildOrgThemeTokens(BLUE);

    await approveTheme(admin, BLUE);
    await admin.mutation(api.orgThemes.resetToNeutral);
    expect(await admin.query(api.orgThemes.getForCurrentOrg)).toBeNull();

    // Approving from neutral leaves the reset theme in the slot.
    await approveTheme(admin, ORANGE);
    const afterApproval = await admin.query(api.orgThemes.getThemeAdminState);
    expect(afterApproval?.previousLightTokens).toEqual(blue.lightTokens);

    await admin.mutation(api.orgThemes.resetToNeutral);
    await admin.mutation(api.orgThemes.restorePreviousTheme);

    const runtime = await admin.query(api.orgThemes.getForCurrentOrg);
    const restored = await admin.query(api.orgThemes.getThemeAdminState);
    expect(runtime?.lightTokens).toEqual(buildOrgThemeTokens(ORANGE).lightTokens);
    // Restored over neutral: there is nothing earlier to keep.
    expect(restored?.previousLightTokens).toBeUndefined();
    expect(restored?.previousSource).toBeUndefined();
  });

  test("discards a candidate awaiting approval", async () => {
    const t = convexTest(schema, modules);
    await seedThemeUsers(t);
    const admin = t.withIdentity(identityFor("theme_admin"));

    await approveTheme(admin, BLUE);
    await approveTheme(admin, ORANGE);
    await admin.mutation(api.orgThemes.saveManualCandidate, { accentRgb: MAGENTA });

    await admin.mutation(api.orgThemes.restorePreviousTheme);

    const restored = await admin.query(api.orgThemes.getThemeAdminState);
    expect(restored?.status).toBe("ready");
    expect(restored?.activeLightTokens).toEqual(buildOrgThemeTokens(BLUE).lightTokens);
    expect(restored?.candidateLightTokens).toBeUndefined();
    expect(restored?.candidateSource).toBeUndefined();
  });

  test("refuses with a readable error when there is no earlier theme", async () => {
    const t = convexTest(schema, modules);
    await seedThemeUsers(t);
    const admin = t.withIdentity(identityFor("theme_admin"));
    const expected = {
      code: "NO_PREVIOUS_THEME",
      userMessage: "There's no earlier theme to restore.",
    };

    // No theme row at all.
    expect(
      await rejectionData(admin.mutation(api.orgThemes.restorePreviousTheme)),
    ).toEqual(expected);

    // One approved theme, nothing before it.
    await approveTheme(admin, BLUE);
    expect(
      await rejectionData(admin.mutation(api.orgThemes.restorePreviousTheme)),
    ).toEqual(expected);

    const unchanged = await admin.query(api.orgThemes.getThemeAdminState);
    expect(unchanged?.activeLightTokens).toEqual(buildOrgThemeTokens(BLUE).lightTokens);
  });

  test("contributors cannot restore a theme", async () => {
    const t = convexTest(schema, modules);
    await seedThemeUsers(t);
    const admin = t.withIdentity(identityFor("theme_admin"));
    await approveTheme(admin, BLUE);
    await approveTheme(admin, ORANGE);

    await expect(
      t
        .withIdentity(identityFor("theme_contributor"))
        .mutation(api.orgThemes.restorePreviousTheme),
    ).rejects.toThrow("Insufficient permissions");

    const unchanged = await admin.query(api.orgThemes.getThemeAdminState);
    expect(unchanged?.activeLightTokens).toEqual(buildOrgThemeTokens(ORANGE).lightTokens);
  });

  test("only restores within the caller's own org", async () => {
    const t = convexTest(schema, modules);
    await seedThemeUsers(t);
    const admin = t.withIdentity(identityFor("theme_admin"));
    const otherAdmin = await seedOtherOrgAdmin(t);

    await approveTheme(admin, BLUE);
    await approveTheme(admin, ORANGE);
    await approveTheme(otherAdmin, MAGENTA);

    // The other org has one theme and nothing before it; this org's earlier
    // theme is not reachable from there.
    expect(
      await rejectionData(otherAdmin.mutation(api.orgThemes.restorePreviousTheme)),
    ).toMatchObject({ code: "NO_PREVIOUS_THEME" });

    const thisOrg = await admin.query(api.orgThemes.getThemeAdminState);
    const otherOrg = await otherAdmin.query(api.orgThemes.getThemeAdminState);
    expect(thisOrg?.activeLightTokens).toEqual(buildOrgThemeTokens(ORANGE).lightTokens);
    expect(thisOrg?.previousLightTokens).toEqual(buildOrgThemeTokens(BLUE).lightTokens);
    expect(otherOrg?.activeLightTokens).toEqual(buildOrgThemeTokens(MAGENTA).lightTokens);

    // And restoring here leaves the other org's theme alone.
    await admin.mutation(api.orgThemes.restorePreviousTheme);
    const otherOrgAfter = await otherAdmin.query(api.orgThemes.getThemeAdminState);
    expect(otherOrgAfter?.activeLightTokens).toEqual(
      buildOrgThemeTokens(MAGENTA).lightTokens,
    );
  });
});
describe("the live theme while a candidate is in progress", () => {
  test("stays on through generating, reviewing and rejecting a candidate", async () => {
    const t = convexTest(schema, modules);
    await seedThemeUsers(t);
    const admin = t.withIdentity(identityFor("theme_admin"));
    const contributor = t.withIdentity(identityFor("theme_contributor"));
    await approveTheme(admin, BLUE);
    const blue = buildOrgThemeTokens(BLUE);

    // Generation starts: the row reads "extracting".
    await admin.mutation(api.orgThemes.startThemeGeneration, {
      sourceLogoUrl: "https://example.com/logo.png",
    });
    expect(await contributor.query(api.orgThemes.getForCurrentOrg)).toMatchObject({
      status: "ready",
      lightTokens: blue.lightTokens,
      darkTokens: blue.darkTokens,
    });

    // A candidate awaits approval: the row reads "pending".
    await admin.mutation(api.orgThemes.saveGeneratedCandidate, {
      sourceLogoUrl: "https://example.com/logo.png",
      accentRgb: ORANGE,
    });
    expect(
      (await admin.query(api.orgThemes.getThemeAdminState))?.status,
    ).toBe("pending");
    expect(await contributor.query(api.orgThemes.getForCurrentOrg)).toMatchObject({
      status: "ready",
      lightTokens: blue.lightTokens,
    });

    await admin.mutation(api.orgThemes.rejectCandidateTheme);
    expect(await contributor.query(api.orgThemes.getForCurrentOrg)).toMatchObject({
      lightTokens: blue.lightTokens,
    });
  });

  test("a custom accent stays live, reported as an override, while a candidate waits", async () => {
    const t = convexTest(schema, modules);
    await seedThemeUsers(t);
    const admin = t.withIdentity(identityFor("theme_admin"));
    await approveTheme(admin, MAGENTA, "manual");

    await admin.mutation(api.orgThemes.saveManualCandidate, { accentRgb: ORANGE });

    expect(await admin.query(api.orgThemes.getForCurrentOrg)).toMatchObject({
      status: "override",
      lightTokens: buildOrgThemeTokens(MAGENTA).lightTokens,
    });
  });

  test("approving the candidate swaps the live theme", async () => {
    const t = convexTest(schema, modules);
    await seedThemeUsers(t);
    const admin = t.withIdentity(identityFor("theme_admin"));
    await approveTheme(admin, BLUE);

    await approveTheme(admin, ORANGE);

    expect(await admin.query(api.orgThemes.getForCurrentOrg)).toMatchObject({
      status: "ready",
      lightTokens: buildOrgThemeTokens(ORANGE).lightTokens,
    });
  });

  test("a candidate on a neutral workspace changes nothing until approved", async () => {
    const t = convexTest(schema, modules);
    await seedThemeUsers(t);
    const admin = t.withIdentity(identityFor("theme_admin"));
    await approveTheme(admin, BLUE);
    await admin.mutation(api.orgThemes.resetToNeutral);

    await admin.mutation(api.orgThemes.saveManualCandidate, { accentRgb: ORANGE });

    expect(await admin.query(api.orgThemes.getForCurrentOrg)).toBeNull();
  });
});

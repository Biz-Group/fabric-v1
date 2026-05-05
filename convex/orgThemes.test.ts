/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";
import { buildOrgThemeTokens } from "./themeColors";

const modules = import.meta.glob("./**/*.ts");

const ORG_ID = "org_theme_test";
const ISSUER = "https://test.clerk";

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
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { MCP_POLICY } from "./mcp/policy";
import { userErrorMessageOf } from "./lib/userError";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://mcp-settings.test";
const ORG = "org_mcp_settings";
const OTHER = "org_mcp_other";
const ENV: Record<string, string> = { FABRIC_MCP: "true", CONVEX_SITE_URL: "https://settings.convex.site" };
const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

beforeEach(() => Object.assign(process.env, ENV));
afterEach(() => {
  for (const [k, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[k];
    else process.env[k] = value;
  }
});

type Who = "admin" | "member" | "staff" | "otherAdmin";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const person = async (name: string, orgId: string, role: "admin" | "viewer", superAdmin = false) => {
      const tokenIdentifier = `${ISSUER}|${name}`;
      const userId = await ctx.db.insert("users", {
        tokenIdentifier,
        name,
        email: `${name}@example.test`,
        profileComplete: true,
        ...(superAdmin ? { platformRole: "superAdmin" as const } : {}),
      });
      await ctx.db.insert("memberships", { tokenIdentifier, userId, clerkOrgId: orgId, role, status: "active", createdAt: 0 });
      return userId;
    };
    const tenant = (clerkOrgId: string, slug: string) =>
      ctx.db.insert("tenants", { clerkOrgId, name: slug, slug, allowedEmailDomains: [], status: "active", source: "console", createdAt: 0, updatedAt: 0 });
    return {
      tenantId: await tenant(ORG, "acme"),
      otherTenantId: await tenant(OTHER, "other"),
      admin: await person("admin", ORG, "admin"),
      member: await person("member", ORG, "viewer"),
      // Fabric staff reach client workspaces as admins (the super-admin fan-out).
      staff: await person("staff", ORG, "admin", true),
      otherAdmin: await person("otherAdmin", OTHER, "admin"),
    };
  });
  const as = (who: Who) =>
    t.withIdentity({
      tokenIdentifier: `${ISSUER}|${who}`,
      subject: who,
      issuer: ISSUER,
      orgId: who === "otherAdmin" ? OTHER : ORG,
      orgSlug: who === "otherAdmin" ? "other" : "acme",
    });
  return { t, ids, as };
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return userErrorMessageOf(error) ?? (error as Error).message;
  }
  throw new Error("expected a refusal");
}

async function auditActions(t: Awaited<ReturnType<typeof setup>>["t"], orgId: string) {
  return await t.run(async (ctx) =>
    (
      await ctx.db
        .query("authAuditEvents")
        .withIndex("by_clerkOrgId_and_createdAt", (q) => q.eq("clerkOrgId", orgId))
        .collect()
    ).map((row) => row.action),
  );
}

describe("granting the add-on (Fabric staff)", () => {
  test("only super-admins grant, and the workspace sees nothing until then", async () => {
    const { t, ids, as } = await setup();
    expect(await as("admin").query(api.mcpSettings.adminSettings, {})).toEqual({ granted: false });
    expect(await as("member").query(api.mcpSettings.mySetup, {})).toEqual({ status: "unavailable" });
    await expect(as("admin").mutation(api.mcpSettings.setGranted, { tenantId: ids.tenantId, granted: true })).rejects.toThrow();

    await as("staff").mutation(api.mcpSettings.setGranted, { tenantId: ids.tenantId, granted: true });
    expect(await as("staff").query(api.mcpSettings.tenantAddOn, { tenantId: ids.tenantId })).toMatchObject({ granted: true, grantedByName: "staff", enabled: false });
    expect(await as("admin").query(api.mcpSettings.adminSettings, {})).toMatchObject({ granted: true, enabled: false, policy: { version: MCP_POLICY.version } });
    expect(await as("member").query(api.mcpSettings.mySetup, {})).toEqual({ status: "off", isAdmin: false });
    // Another workspace is untouched.
    expect(await as("otherAdmin").query(api.mcpSettings.adminSettings, {})).toEqual({ granted: false });
    expect(await auditActions(t, ORG)).toEqual(["mcpGranted"]);
  });

  test("the deployment switch hides it everywhere", async () => {
    const { ids, as } = await setup();
    await as("staff").mutation(api.mcpSettings.setGranted, { tenantId: ids.tenantId, granted: true });
    process.env.FABRIC_MCP = "false";
    expect(await as("admin").query(api.mcpSettings.adminSettings, {})).toEqual({ granted: false });
    expect(await refusal(as("admin").mutation(api.mcpSettings.setEnabled, { enabled: true, acceptedPolicyVersion: MCP_POLICY.version }))).toMatch(/isn't part of this workspace's plan/);
  });
});

describe("switching it on (workspace admins)", () => {
  test("needs the add-on, an admin and the current terms; members then get the URLs", async () => {
    const { t, ids, as } = await setup();
    expect(await refusal(as("admin").mutation(api.mcpSettings.setEnabled, { enabled: true, acceptedPolicyVersion: MCP_POLICY.version }))).toMatch(/isn't part of this workspace's plan/);
    await as("staff").mutation(api.mcpSettings.setGranted, { tenantId: ids.tenantId, granted: true });

    await expect(as("member").mutation(api.mcpSettings.setEnabled, { enabled: true, acceptedPolicyVersion: MCP_POLICY.version })).rejects.toThrow();
    expect(await refusal(as("admin").mutation(api.mcpSettings.setEnabled, { enabled: true, acceptedPolicyVersion: null }))).toMatch(/Accept the current terms/);
    expect(await refusal(as("admin").mutation(api.mcpSettings.setEnabled, { enabled: true, acceptedPolicyVersion: "old" }))).toMatch(/Accept the current terms/);

    await as("admin").mutation(api.mcpSettings.setEnabled, { enabled: true, acceptedPolicyVersion: MCP_POLICY.version });
    expect(await as("admin").query(api.mcpSettings.adminSettings, {})).toMatchObject({
      enabled: true,
      enabledByName: "admin",
      enabledByStaff: false,
      acceptedPolicyVersion: MCP_POLICY.version,
      workspaceUrl: "https://settings.convex.site/mcp/acme",
    });
    expect(await as("member").query(api.mcpSettings.mySetup, {})).toEqual({
      status: "on",
      isAdmin: false,
      workspaceUrl: "https://settings.convex.site/mcp/acme",
    });
    expect(await t.query(internal.mcp.access.resolveViewer, { slug: "acme", tokenIdentifier: `${ISSUER}|member` })).toMatchObject({ ok: true, enabled: true, conversationTools: false });
    expect(await auditActions(t, ORG)).toEqual(["mcpGranted", "mcpEnabled"]);
  });

  test("staff can switch it on, and it is labelled for the workspace's admins (B5)", async () => {
    const { t, ids, as } = await setup();
    await as("staff").mutation(api.mcpSettings.setGranted, { tenantId: ids.tenantId, granted: true });
    await as("staff").mutation(api.mcpSettings.setEnabled, { enabled: true, acceptedPolicyVersion: MCP_POLICY.version });
    expect(await as("admin").query(api.mcpSettings.adminSettings, {})).toMatchObject({ enabled: true, enabledByStaff: true, enabledByName: "staff" });
    const detail = await t.run(async (ctx) => (await ctx.db.query("authAuditEvents").collect()).find((row) => row.action === "mcpEnabled")?.detail);
    expect(detail).toMatch(/by Fabric staff/);
  });

  test("conversation tools are an admin toggle that changes what MCP exposes", async () => {
    const { t, ids, as } = await setup();
    await as("staff").mutation(api.mcpSettings.setGranted, { tenantId: ids.tenantId, granted: true });
    await as("admin").mutation(api.mcpSettings.setEnabled, { enabled: true, acceptedPolicyVersion: MCP_POLICY.version });
    await expect(as("member").mutation(api.mcpSettings.setConversationTools, { enabled: true })).rejects.toThrow();
    await as("admin").mutation(api.mcpSettings.setConversationTools, { enabled: true });
    expect(await t.query(internal.mcp.access.resolveViewer, { slug: "acme", tokenIdentifier: `${ISSUER}|member` })).toMatchObject({ conversationTools: true });
    expect(await auditActions(t, ORG)).toContain("mcpConversationToolsChanged");
  });
});

describe("revoking and switching off", () => {
  test("switching off stops access at once; revoking also clears the switch", async () => {
    const { t, ids, as } = await setup();
    const access = () => t.query(internal.mcp.access.resolveViewer, { slug: "acme", tokenIdentifier: `${ISSUER}|member` });
    await as("staff").mutation(api.mcpSettings.setGranted, { tenantId: ids.tenantId, granted: true });
    await as("admin").mutation(api.mcpSettings.setEnabled, { enabled: true, acceptedPolicyVersion: MCP_POLICY.version });
    expect(await access()).toMatchObject({ enabled: true });

    await as("admin").mutation(api.mcpSettings.setEnabled, { enabled: false, acceptedPolicyVersion: null });
    expect(await access()).toMatchObject({ enabled: false });

    await as("admin").mutation(api.mcpSettings.setEnabled, { enabled: true, acceptedPolicyVersion: MCP_POLICY.version });
    await as("staff").mutation(api.mcpSettings.setGranted, { tenantId: ids.tenantId, granted: false });
    expect(await access()).toMatchObject({ enabled: false });
    // A later grant starts switched off: the admin must accept again.
    await as("staff").mutation(api.mcpSettings.setGranted, { tenantId: ids.tenantId, granted: true });
    expect(await as("admin").query(api.mcpSettings.adminSettings, {})).toMatchObject({ granted: true, enabled: false });
    expect(await auditActions(t, ORG)).toEqual(["mcpGranted", "mcpEnabled", "mcpDisabled", "mcpEnabled", "mcpRevoked", "mcpGranted"]);
  });

  test("another workspace's admin can't touch this one", async () => {
    const { ids, as } = await setup();
    await as("staff").mutation(api.mcpSettings.setGranted, { tenantId: ids.tenantId, granted: true });
    // otherAdmin's mutations act on their own workspace, which has no add-on.
    expect(await refusal(as("otherAdmin").mutation(api.mcpSettings.setEnabled, { enabled: true, acceptedPolicyVersion: MCP_POLICY.version }))).toMatch(/isn't part of this workspace's plan/);
    await expect(as("otherAdmin").query(api.mcpSettings.tenantAddOn, { tenantId: ids.tenantId })).rejects.toThrow();
    void (ids.otherTenantId satisfies Id<"tenants">);
  });
});

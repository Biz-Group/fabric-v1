/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { utcDayKey } from "./lib/aiUsageRollup";
import { clientLabel, foldMcpCalls, sumDays } from "./mcp/usageFold";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://mcp-usage.test";
const ORG = "org_usage_a";
const OTHER = "org_usage_b";
const DAY = 24 * 60 * 60 * 1000;
const saved = process.env.FABRIC_MCP_CLIENT_NAMES;

beforeEach(() => {
  process.env.FABRIC_MCP_CLIENT_NAMES = "client_claude=Claude (pre-registered)";
});
afterEach(() => {
  if (saved === undefined) delete process.env.FABRIC_MCP_CLIENT_NAMES;
  else process.env.FABRIC_MCP_CLIENT_NAMES = saved;
});

describe("folding", () => {
  test("counts calls, failures, distinct users, tools and clients per workspace", () => {
    const row = (clerkOrgId: string, userId: string, tool: string, outcome: "ok" | "notFound" | "error" | "badArguments" | "rateLimited", clientId = "client_claude") => ({
      clerkOrgId,
      userId: userId as Id<"users">,
      clientId,
      tool,
      outcome,
    });
    const days = foldMcpCalls("2026-11-12", [
      row(ORG, "u1", "rankSignals", "ok"),
      row(ORG, "u1", "rankSignals", "notFound"),
      row(ORG, "u2", "getOverview", "rateLimited", "https://claude.ai/oauth/mcp-client"),
      row(OTHER, "u3", "getOverview", "error"),
    ]);
    expect(days).toEqual([
      {
        clerkOrgId: ORG,
        period: "2026-11-12",
        calls: 3,
        failures: 1,
        users: 2,
        tools: [
          { tool: "rankSignals", calls: 2, failures: 0 },
          { tool: "getOverview", calls: 1, failures: 1 },
        ],
        clients: [
          { clientId: "client_claude", calls: 2 },
          { clientId: "https://claude.ai/oauth/mcp-client", calls: 1 },
        ],
      },
      { clerkOrgId: OTHER, period: "2026-11-12", calls: 1, failures: 1, users: 1, tools: [{ tool: "getOverview", calls: 1, failures: 1 }], clients: [{ clientId: "client_claude", calls: 1 }] },
    ]);
    const totals = sumDays([days[0], { ...days[0], period: "2026-11-13", users: 5 }]);
    expect(totals).toMatchObject({ calls: 6, failures: 2, peakDailyUsers: 5, activeDays: 2 });
    expect(totals.tools[0]).toEqual({ tool: "rankSignals", calls: 4, failures: 0 });
  });

  test("labels clients by configured name, or a CIMD URL by its host", () => {
    expect(clientLabel("client_claude", "client_claude=Claude")).toBe("Claude");
    expect(clientLabel("https://claude.ai/oauth/mcp-client", undefined)).toBe("claude.ai");
    expect(clientLabel("cg6Tsb5DAeTYzxSA", "")).toBe("cg6Tsb5DAeTYzxSA");
  });
});

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
    await ctx.db.insert("tenants", { clerkOrgId: ORG, name: "Acme", slug: "acme", allowedEmailDomains: [], status: "active", source: "console", createdAt: 0, updatedAt: 0 });
    return {
      admin: await person("admin", ORG, "admin"),
      member: await person("member", ORG, "viewer"),
      staff: await person("staff", OTHER, "admin", true),
      otherAdmin: await person("otherAdmin", OTHER, "admin"),
    };
  });
  const as = (who: "admin" | "member" | "staff" | "otherAdmin") =>
    t.withIdentity({ tokenIdentifier: `${ISSUER}|${who}`, subject: who, issuer: ISSUER, orgId: who === "admin" || who === "member" ? ORG : OTHER });
  const call = (clerkOrgId: string, userId: Id<"users">, tool: string, outcome: "ok" | "rateLimited" = "ok", clientId = "client_claude") =>
    t.mutation(internal.mcpUsage.record, { clerkOrgId, userId, clientId, tool, outcome, resultCount: 3, truncated: false, latencyMs: 40 });
  return { t, ids, as, call };
}

describe("nightly fold and pruning", () => {
  test("foldDay writes one row per workspace and is idempotent", async () => {
    const { t, ids, call } = await setup();
    await call(ORG, ids.admin, "rankSignals");
    await call(ORG, ids.member, "getOverview", "rateLimited");
    await call(OTHER, ids.otherAdmin, "getOverview");
    const today = utcDayKey(Date.now());
    for (let run = 0; run < 2; run++) {
      expect(await t.action(internal.mcpUsage.foldDay, { period: today })).toEqual({ period: today, workspaces: 2, calls: 3 });
    }
    const rows = await t.run(async (ctx) => await ctx.db.query("mcpUsageDays").collect());
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.clerkOrgId === ORG)).toMatchObject({ calls: 2, failures: 1, users: 2 });
  });

  test("prunes raw calls past retention only once their day is folded", async () => {
    const { t, ids } = await setup();
    const old = Date.now() - 120 * DAY;
    await t.run(async (ctx) => {
      for (const createdAt of [old, old + 1]) {
        await ctx.db.insert("mcpCalls", { clerkOrgId: ORG, userId: ids.admin, clientId: "c", tool: "rankSignals", outcome: "ok", resultCount: 1, truncated: false, latencyMs: 1, createdAt });
      }
    });
    expect(await t.mutation(internal.mcpUsage.pruneOldCalls, {})).toEqual({ deleted: 0, skipped: 2 });
    await t.action(internal.mcpUsage.foldDay, { period: utcDayKey(old) });
    expect(await t.mutation(internal.mcpUsage.pruneOldCalls, {})).toEqual({ deleted: 2, skipped: 0 });
    expect(await t.run(async (ctx) => (await ctx.db.query("mcpUsageDays").collect()).length)).toBe(1);
  });
});

describe("reading usage", () => {
  test("the tenants console sees any workspace; folded days and today's live calls both count", async () => {
    const { t, ids, as, call } = await setup();
    const yesterday = utcDayKey(Date.now() - DAY);
    const today = utcDayKey(Date.now());
    await t.mutation(internal.mcpUsage.writeDays, {
      days: [{ clerkOrgId: ORG, period: yesterday, calls: 10, failures: 1, users: 3, tools: [{ tool: "rankSignals", calls: 10, failures: 1 }], clients: [{ clientId: "client_claude", calls: 10 }] }],
    });
    await call(ORG, ids.admin, "getOverview");

    await expect(as("admin").query(api.mcpUsage.tenantUsage, { clerkOrgId: ORG, from: yesterday, to: today })).rejects.toThrow();
    const usage = await as("staff").query(api.mcpUsage.tenantUsage, { clerkOrgId: ORG, from: yesterday, to: today });
    expect(usage.byDay).toEqual([
      { period: yesterday, calls: 10, failures: 1, users: 3 },
      { period: today, calls: 1, failures: 0, users: 1 },
    ]);
    expect(usage.totals).toMatchObject({ calls: 11, failures: 1, peakDailyUsers: 3 });
    expect(usage.totals.clients).toEqual([{ clientId: "client_claude", calls: 11, label: "Claude (pre-registered)" }]);

    const overview = await as("staff").query(api.mcpUsage.usageOverview, { from: yesterday, to: today });
    expect(overview.tenants).toEqual([{ clerkOrgId: ORG, name: "Acme", calls: 11, failures: 1, peakDailyUsers: 3, activeDays: 2 }]);
  });

  test("a workspace admin sees only their own workspace, with a per-member breakdown", async () => {
    const { ids, as, call } = await setup();
    const today = utcDayKey(Date.now());
    await call(ORG, ids.admin, "rankSignals");
    await call(ORG, ids.member, "getOverview");
    await call(ORG, ids.member, "listSystems");
    await call(OTHER, ids.otherAdmin, "getOverview");

    await expect(as("member").query(api.mcpUsage.workspaceUsage, { from: today, to: today })).rejects.toThrow();
    const usage = await as("admin").query(api.mcpUsage.workspaceUsage, { from: today, to: today });
    expect(usage.totals.calls).toBe(3);
    expect(usage.activeMembers).toBe(2);
    expect(usage.members.map((m) => [m.name, m.calls])).toEqual([
      ["member", 2],
      ["admin", 1],
    ]);
    const other = await as("otherAdmin").query(api.mcpUsage.workspaceUsage, { from: today, to: today });
    expect(other.totals.calls).toBe(1);
  });
});

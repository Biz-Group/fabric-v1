/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import schema from "./schema";
import { purgeTables } from "./workspacePurge";

/**
 * Workspace purge, phase 3 (docs/client-offboarding-plan.md, D2, D4–D6).
 */

const modules = import.meta.glob("./**/*.ts");
const makeTest = () => convexTest(schema, modules);
type TestConvex = ReturnType<typeof makeTest>;

const ISSUER = "https://test.clerk";
const ORG_A = "org_leaving";
const ORG_B = "org_staying";
const DAY = 24 * 60 * 60 * 1000;

function identity(name: string) {
  return { tokenIdentifier: `${ISSUER}|${name}`, subject: name, issuer: ISSUER, name };
}

type Ids = {
  tenantA: Id<"tenants">;
  tenantB: Id<"tenants">;
  ada: Id<"users">;
  bo: Id<"users">;
  staff: Id<"users">;
  files: Id<"_storage">[];
  conversationB: Id<"conversations">;
  usageA: Id<"aiUsageEvents">;
};

async function seed(t: TestConvex, options: { purgeAfter?: number } = {}): Promise<Ids> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const user = (name: string, extra: { platformRole?: "superAdmin" } = {}) =>
      ctx.db.insert("users", {
        tokenIdentifier: `${ISSUER}|${name}`,
        clerkUserId: name,
        name,
        email: `${name}@example.test`,
        emailLower: `${name}@example.test`,
        jobTitle: "Clerk",
        profileComplete: true,
        ...extra,
      });
    const staff = await user("user_staff", { platformRole: "superAdmin" });
    const ada = await user("user_ada");
    const bo = await user("user_bo");
    const member = (name: string, userId: Id<"users">, clerkOrgId: string) =>
      ctx.db.insert("memberships", {
        tokenIdentifier: `${ISSUER}|${name}`,
        userId,
        clerkOrgId,
        role: "admin",
        createdAt: now,
      });
    await member("user_ada", ada, ORG_A);
    await member("user_bo", bo, ORG_A);
    await member("user_bo", bo, ORG_B);
    await member("user_staff", staff, ORG_A);

    const logo = await ctx.storage.store(new Blob(["logo"]));
    const recording = await ctx.storage.store(new Blob(["audio"], { type: "audio/webm" }));
    const speech = await ctx.storage.store(new Blob(["speech"], { type: "audio/mpeg" }));

    const tenantA = await ctx.db.insert("tenants", {
      clerkOrgId: ORG_A,
      name: "Leaving Ltd",
      slug: "leaving",
      logoUrl: "https://img.clerk.test/logo.png",
      logoStorageId: logo,
      allowedEmailDomains: ["leaving.test"],
      firstInviteEmail: "first@leaving.test",
      status: "suspended",
      offboarding: {
        suspendedAt: now - 31 * DAY,
        suspendedByUserId: staff,
        suspendedByName: "user_staff",
        reason: "Contract ended",
        purgeAfter: options.purgeAfter ?? now - DAY,
      },
      source: "console",
      createdAt: now - 100 * DAY,
      updatedAt: now,
    });
    const tenantB = await ctx.db.insert("tenants", {
      clerkOrgId: ORG_B,
      name: "Staying Co",
      slug: "staying",
      allowedEmailDomains: [],
      status: "active",
      source: "console",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("membershipIntents", {
      clerkOrgId: ORG_A,
      email: "invitee@leaving.test",
      emailLower: "invitee@leaving.test",
      requestedRole: "viewer",
      source: "adminInvite",
      status: "revoked",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("authAuditEvents", {
      clerkOrgId: ORG_A,
      targetUserId: ada,
      action: "memberRemoved",
      createdAt: now,
    });

    const hierarchy = async (clerkOrgId: string) => {
      const fn = await ctx.db.insert("functions", { name: "Ops", sortOrder: 0, clerkOrgId });
      const dept = await ctx.db.insert("departments", { functionId: fn, name: "Hub", sortOrder: 0, clerkOrgId });
      return await ctx.db.insert("processes", { departmentId: dept, name: "Intake", sortOrder: 0, clerkOrgId });
    };
    const procA = await hierarchy(ORG_A);
    const procB = await hierarchy(ORG_B);
    await ctx.db.insert("conversations", {
      processId: procA,
      elevenlabsConversationId: "conv_leaving1",
      contributorName: "user_ada",
      userId: ada,
      inputMode: "agent",
      status: "done",
      clerkOrgId: ORG_A,
    });
    await ctx.db.insert("conversations", {
      processId: procA,
      contributorName: "user_bo",
      userId: bo,
      inputMode: "voiceRecord",
      audioStorageId: recording,
      status: "done",
      clerkOrgId: ORG_A,
    });
    const conversationB = await ctx.db.insert("conversations", {
      processId: procB,
      elevenlabsConversationId: "conv_staying1",
      contributorName: "user_bo",
      userId: bo,
      inputMode: "agent",
      status: "done",
      clerkOrgId: ORG_B,
    });

    const thread = await ctx.db.insert("askThreads", {
      clerkOrgId: ORG_A,
      userId: ada,
      title: "Ask",
      status: "active",
      lastMessageAt: now,
    });
    const message = await ctx.db.insert("askMessages", {
      threadId: thread,
      clerkOrgId: ORG_A,
      userId: ada,
      role: "assistant",
      status: "complete",
      parts: [],
    });
    await ctx.db.insert("askSpeech", {
      messageId: message,
      threadId: thread,
      clerkOrgId: ORG_A,
      userId: ada,
      storageId: speech,
      voiceId: "voice",
      model: "model",
      characters: 10,
    });

    const usageA = await ctx.db.insert("aiUsageEvents", {
      deployment: "prod",
      idempotencyKey: "usage-a",
      createdAt: now,
      clerkOrgId: ORG_A,
      unit: "tokens",
      operation: "flow",
      provider: "foundry",
      model: "m",
      status: "ok",
      costMicroUsd: 1200,
      priceVersion: "v1",
      costSource: "computed",
      actorName: "user_ada",
      actorUserId: "user_ada",
      entityLabel: "Ops › Hub › Intake",
    });

    return { tenantA, tenantB, ada, bo, staff, files: [logo, recording, speech], conversationB, usageA };
  });
}

type Call = { url: string; method: string };

function stubVendors(options: { elevenlabsStatus?: number; adaElsewhere?: boolean } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (url.startsWith("https://api.elevenlabs.io/")) {
        const status = options.elevenlabsStatus ?? 200;
        return status === 200 ? json({ success: true }) : json({ detail: "boom" }, status);
      }
      if (url.includes("/organization_memberships")) {
        const orgs = url.includes("/users/user_ada/") && options.adaElsewhere ? [ORG_A, "org_elsewhere"] : [];
        return json({ data: orgs.map((id) => ({ organization: { id } })), total_count: orgs.length });
      }
      if (method === "DELETE") return json({ deleted: true });
      return json({ errors: [{ code: "not_found", message: "unexpected" }] }, 404);
    }),
  );
  return calls;
}

async function settle(t: TestConvex) {
  // Steps far enough for re-sweeps (2 minutes apart), never as far as any expiry.
  // Each scheduled hop takes one step, so the count grows with the purge's
  // table list (60 since orgFeatures, the Fabric MCP settings).
  for (let step = 0; step < 60; step++) {
    vi.advanceTimersByTime(60_000);
    await t.finishInProgressScheduledFunctions();
  }
}

async function orgRowCount(t: TestConvex, clerkOrgId: string) {
  return await t.run(async (ctx) => {
    const counts: Record<string, number> = {};
    for (const { table, entry } of purgeTables()) {
      const rows = await (
        ctx.db.query(table as TableNames) as unknown as {
          withIndex(i: string, r: (q: { eq(f: string, v: string): unknown }) => unknown): {
            collect(): Promise<unknown[]>;
          };
        }
      )
        .withIndex(entry.orgIndex, (q) => q.eq("clerkOrgId", clerkOrgId))
        .collect();
      if (rows.length) counts[table] = rows.length;
    }
    return counts;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  process.env.CLERK_SECRET_KEY = "sk_test_abc";
  process.env.ELEVENLABS_API_KEY = "xi_test";
  process.env.USAGE_DEPLOYMENT_LABEL = "prod";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.USAGE_DEPLOYMENT_LABEL;
});

describe("purging a workspace", () => {
  test("deletes everything of the workspace, inside and outside Fabric, 30 days after closing", async () => {
    const t = makeTest();
    const ids = await seed(t);
    const calls = stubVendors();
    const beforeB = await orgRowCount(t, ORG_B);

    expect(await t.mutation(internal.workspacePurge.startDuePurges, {})).toMatchObject({ started: 1 });
    await settle(t);

    // Fabric: nothing of org A is left in any table the registry deletes.
    expect(await orgRowCount(t, ORG_A)).toEqual({});
    for (const file of ids.files) {
      expect(await t.run(async (ctx) => (await ctx.storage.get(file)) === null)).toBe(true);
    }
    // ...and the other workspace is untouched.
    expect(await orgRowCount(t, ORG_B)).toEqual(beforeB);

    const state = await t.run(async (ctx) => ({
      tenantA: await ctx.db.get(ids.tenantA),
      tenantB: await ctx.db.get(ids.tenantB),
      ada: await ctx.db.get(ids.ada),
      bo: await ctx.db.get(ids.bo),
      staff: await ctx.db.get(ids.staff),
      usage: await ctx.db.get(ids.usageA),
      items: await ctx.db.query("tenantPurgeItems").collect(),
    }));

    // D4: a tombstone, the certificate and the usage ledger stay.
    expect(state.tenantA).toMatchObject({ status: "purged", name: "Leaving Ltd", slug: "leaving", allowedEmailDomains: [] });
    expect(state.tenantA?.logoUrl).toBeUndefined();
    expect(state.tenantA?.firstInviteEmail).toBeUndefined();
    expect(state.tenantB?.status).toBe("active");
    expect(state.usage).toMatchObject({ costMicroUsd: 1200, clerkOrgId: ORG_A });
    expect(state.usage?.actorName).toBeUndefined();
    expect(state.usage?.entityLabel).toBeUndefined();
    expect(state.items).toHaveLength(0);

    // D5: only people in no other workspace are erased; staff never.
    expect(state.ada).toMatchObject({ name: "Former member", email: "" });
    expect(state.ada?.deletedAt).toBeDefined();
    expect(state.bo).toMatchObject({ name: "user_bo", email: "user_bo@example.test" });
    expect(state.staff).toMatchObject({ name: "user_staff", platformRole: "superAdmin" });

    const deletes = calls.filter((c) => c.method === "DELETE").map((c) => c.url);
    expect(deletes).toContain(`https://api.clerk.com/v1/organizations/${ORG_A}`);
    expect(deletes).toContain("https://api.elevenlabs.io/v1/convai/conversations/conv_leaving1");
    expect(deletes).toContain("https://api.clerk.com/v1/users/user_ada");
    expect(deletes.some((u) => u.includes("user_bo") || u.includes("user_staff"))).toBe(false);
    expect(deletes.some((u) => u.includes("conv_staying1"))).toBe(false);

    const certificate = await t
      .withIdentity(identity("user_staff"))
      .query(api.workspacePurge.getPurge, { tenantId: ids.tenantA });
    expect(certificate).toMatchObject({
      status: "complete",
      trigger: "scheduled",
      filesDeleted: 3,
      usageRowsScrubbed: 1,
      clerkOrg: "deleted",
      elevenlabs: { deleted: 1, alreadyGone: 0, skipped: 0, failed: 0 },
      people: { erased: 1, keptOtherWorkspace: 1, keptStaff: 1, failed: 0 },
    });
    expect(certificate?.rowsByTable).toMatchObject({ conversations: 2, memberships: 3, askThreads: 1 });
  });

  test("waits the full 30 days, and never touches an open workspace", async () => {
    const t = makeTest();
    const ids = await seed(t, { purgeAfter: Date.now() + DAY });
    stubVendors();

    expect(await t.mutation(internal.workspacePurge.startDuePurges, {})).toMatchObject({ started: 0 });
    await settle(t);
    const tenants = await t.run(async (ctx) => [await ctx.db.get(ids.tenantA), await ctx.db.get(ids.tenantB)]);
    expect(tenants.map((row) => row?.status)).toEqual(["suspended", "active"]);
    expect((await orgRowCount(t, ORG_A)).conversations).toBe(2);
  });

  test("off production, leaves ElevenLabs alone: its agent is shared with production", async () => {
    const t = makeTest();
    const ids = await seed(t);
    const calls = stubVendors();
    process.env.USAGE_DEPLOYMENT_LABEL = "dev";

    await t.mutation(internal.workspacePurge.startDuePurges, {});
    await settle(t);

    expect(calls.some((c) => c.url.startsWith("https://api.elevenlabs.io/"))).toBe(false);
    const certificate = await t
      .withIdentity(identity("user_staff"))
      .query(api.workspacePurge.getPurge, { tenantId: ids.tenantA });
    expect(certificate).toMatchObject({ status: "complete", elevenlabs: { skipped: 1, deleted: 0 } });
  });

  test("holds the certificate back until a failed ElevenLabs deletion is retried (D6)", async () => {
    const t = makeTest();
    const ids = await seed(t);
    stubVendors({ elevenlabsStatus: 500 });

    await t.mutation(internal.workspacePurge.startDuePurges, {});
    await settle(t);
    const staff = t.withIdentity(identity("user_staff"));
    expect(await staff.query(api.workspacePurge.getPurge, { tenantId: ids.tenantA })).toMatchObject({
      status: "needsRetry",
      elevenlabs: { failed: 1 },
    });
    expect((await t.run((ctx) => ctx.db.get(ids.tenantA)))?.status).toBe("purging");

    stubVendors();
    await staff.mutation(api.workspacePurge.retryPurge, { tenantId: ids.tenantA });
    await settle(t);
    expect(await staff.query(api.workspacePurge.getPurge, { tenantId: ids.tenantA })).toMatchObject({
      status: "complete",
      elevenlabs: { deleted: 1, failed: 0 },
    });
    expect((await t.run((ctx) => ctx.db.get(ids.tenantA)))?.status).toBe("purged");
  });

  test("keeps the account of someone Clerk knows in another organization", async () => {
    const t = makeTest();
    const ids = await seed(t);
    const calls = stubVendors({ adaElsewhere: true });

    await t.mutation(internal.workspacePurge.startDuePurges, {});
    await settle(t);

    expect((await t.run((ctx) => ctx.db.get(ids.ada)))?.name).toBe("user_ada");
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/users/user_ada"))).toBe(false);
  });

  test("can start early on request, only for a closed workspace, by staff, with the address typed", async () => {
    const t = makeTest();
    const ids = await seed(t, { purgeAfter: Date.now() + 20 * DAY });
    stubVendors();
    const staff = t.withIdentity(identity("user_staff"));

    await expect(
      staff.mutation(api.workspacePurge.purgeNow, { tenantId: ids.tenantB, confirmSlug: "staying" }),
    ).rejects.toThrow(/Close the workspace/);
    await expect(
      staff.mutation(api.workspacePurge.purgeNow, { tenantId: ids.tenantA, confirmSlug: "staying" }),
    ).rejects.toThrow(/to confirm/);
    await expect(
      t.withIdentity(identity("user_ada")).mutation(api.workspacePurge.purgeNow, {
        tenantId: ids.tenantA,
        confirmSlug: "leaving",
      }),
    ).rejects.toThrow(/Platform super-admin required/);

    await staff.mutation(api.workspacePurge.purgeNow, { tenantId: ids.tenantA, confirmSlug: "leaving" });
    await settle(t);
    expect(await staff.query(api.workspacePurge.getPurge, { tenantId: ids.tenantA })).toMatchObject({
      status: "complete",
      trigger: "manual",
      requestedByName: "user_staff",
    });
    // A purged workspace can't be reopened.
    await expect(
      staff.mutation(api.workspaceLifecycle.reinstateWorkspace, { tenantId: ids.tenantA }),
    ).rejects.toThrow(/can't be reopened/);
  });
});

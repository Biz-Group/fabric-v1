/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

/**
 * Erasing one person from a workspace, phase 4 (docs/client-offboarding-plan.md,
 * D5, D7, D8).
 */

const modules = import.meta.glob("./**/*.ts");
const makeTest = () => convexTest(schema, modules);
type TestConvex = ReturnType<typeof makeTest>;

const ISSUER = "https://test.clerk";
const ORG_A = "org_client";
const ORG_B = "org_elsewhere";

function identity(name: string, orgId?: string) {
  return {
    tokenIdentifier: `${ISSUER}|${name}`,
    subject: name,
    issuer: ISSUER,
    name,
    ...(orgId ? { orgId, orgSlug: orgId } : {}),
  };
}

type Ids = {
  tenantA: Id<"tenants">;
  ada: Id<"users">;
  bo: Id<"users">;
  cy: Id<"users">;
  adaMembership: Id<"memberships">;
  boMembership: Id<"memberships">;
  staffMembership: Id<"memberships">;
  adaOwn: Id<"conversations">;
  aboutAda: Id<"conversations">;
  adaForBo: Id<"conversations">;
  cyWithAda: Id<"conversations">;
  adaRecording: Id<"conversations">;
  recordingFile: Id<"_storage">;
  shared: Id<"processes">;
  adaOnly: Id<"processes">;
  usage: Id<"aiUsageEvents">;
};

async function seed(t: TestConvex): Promise<Ids> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const user = (name: string, platformRole?: "superAdmin") =>
      ctx.db.insert("users", {
        tokenIdentifier: `${ISSUER}|${name}`,
        clerkUserId: name,
        name: name.replace("user_", ""),
        email: `${name}@example.test`,
        emailLower: `${name}@example.test`,
        jobTitle: "Analyst",
        profileComplete: true,
        ...(platformRole ? { platformRole } : {}),
      });
    const staff = await user("user_staff", "superAdmin");
    const ada = await user("user_ada");
    const bo = await user("user_bo");
    const cy = await user("user_cy");
    const member = (name: string, userId: Id<"users">, clerkOrgId: string, invitedBy?: Id<"users">) =>
      ctx.db.insert("memberships", {
        tokenIdentifier: `${ISSUER}|${name}`,
        userId,
        clerkOrgId,
        role: "contributor",
        name: name.replace("user_", ""),
        email: `${name}@example.test`,
        createdAt: now,
        ...(invitedBy ? { invitedBy } : {}),
      });
    const adaMembership = await member("user_ada", ada, ORG_A);
    const boMembership = await member("user_bo", bo, ORG_A);
    await member("user_bo", bo, ORG_B);
    await member("user_cy", cy, ORG_A, ada);
    const staffMembership = await member("user_staff", staff, ORG_A);

    const tenantA = await ctx.db.insert("tenants", {
      clerkOrgId: ORG_A,
      name: "Client",
      slug: "client",
      allowedEmailDomains: [],
      status: "active",
      source: "console",
      createdAt: now,
      updatedAt: now,
    });

    const fn = await ctx.db.insert("functions", { name: "Ops", sortOrder: 0, clerkOrgId: ORG_A });
    const dept = await ctx.db.insert("departments", { functionId: fn, name: "Hub", sortOrder: 0, clerkOrgId: ORG_A });
    const process = (name: string) =>
      ctx.db.insert("processes", {
        departmentId: dept,
        name,
        sortOrder: 0,
        rollingSummary: `Overview quoting Ada about ${name}`,
        clerkOrgId: ORG_A,
      });
    const shared = await process("Intake");
    const adaOnly = await process("Returns");

    const conv = (fields: Partial<{
      processId: Id<"processes">;
      userId: Id<"users">;
      subjectUserId: Id<"users">;
      submittedByName: string;
      contributorName: string;
      elevenlabsConversationId: string;
      audioStorageId: Id<"_storage">;
      inputMode: "agent" | "voiceRecord";
      speakerLabels: { speakerId: string; displayName: string; userId?: Id<"users"> }[];
      transcript: { role: string; content: string; time_in_call_secs: number; speakerId?: string; speakerName?: string }[];
    }>) =>
      ctx.db.insert("conversations", {
        processId: shared,
        contributorName: "Ada",
        inputMode: "agent",
        status: "done",
        clerkOrgId: ORG_A,
        ...fields,
      });
    const adaOwn = await conv({ userId: ada, elevenlabsConversationId: "conv_ada" });
    const aboutAda = await conv({ userId: cy, subjectUserId: ada, submittedByName: "Cy" });
    const adaForBo = await conv({ userId: ada, subjectUserId: bo, contributorName: "Bo", submittedByName: "Ada" });
    const cyWithAda = await conv({
      userId: cy,
      contributorName: "Cy",
      inputMode: "voiceRecord",
      speakerLabels: [
        { speakerId: "s1", displayName: "Cy", userId: cy },
        { speakerId: "s2", displayName: "Ada", userId: ada },
      ],
      transcript: [
        { role: "user", content: "We start here.", time_in_call_secs: 0, speakerId: "s1", speakerName: "Cy" },
        { role: "user", content: "Then I check it.", time_in_call_secs: 3, speakerId: "s2", speakerName: "Ada" },
      ],
    });
    const recordingFile = await ctx.storage.store(new Blob(["audio"], { type: "audio/webm" }));
    const adaRecording = await conv({
      processId: adaOnly,
      userId: ada,
      inputMode: "voiceRecord",
      audioStorageId: recordingFile,
    });

    await ctx.db.insert("membershipIntents", {
      clerkOrgId: ORG_A,
      email: "user_ada@example.test",
      emailLower: "user_ada@example.test",
      requestedRole: "contributor",
      source: "adminInvite",
      status: "accepted",
      acceptedUserId: ada,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("authAuditEvents", {
      clerkOrgId: ORG_A,
      targetUserId: ada,
      targetEmailLower: "user_ada@example.test",
      action: "roleChanged",
      detail: "Ada became an admin",
      createdAt: now,
    });
    await ctx.db.insert("conversationDeletions", {
      clerkOrgId: ORG_A,
      conversationId: adaOwn,
      processId: shared,
      processLabel: "Ops › Hub › Intake",
      contributorName: "ada",
      inputMode: "agent",
      status: "done",
      recordedAt: now,
      reason: "Duplicate",
      actorUserId: cy,
      actorName: "Cy",
      createdAt: now,
    });
    await ctx.db.insert("voiceUploadGrants", {
      token: "grant",
      processId: shared,
      clerkOrgId: ORG_A,
      userId: ada,
      expiresAt: now + 60_000,
    });
    await ctx.db.insert("askThreads", {
      clerkOrgId: ORG_A,
      userId: ada,
      title: "Ada's question",
      status: "active",
      lastMessageAt: now,
    });
    const usage = await ctx.db.insert("aiUsageEvents", {
      deployment: "prod",
      idempotencyKey: "u1",
      createdAt: now,
      clerkOrgId: ORG_A,
      unit: "tokens",
      operation: "summary",
      provider: "foundry",
      model: "m",
      status: "ok",
      costMicroUsd: 10,
      priceVersion: "v1",
      costSource: "computed",
      actorUserId: ada,
      actorName: "Ada",
    });

    return {
      tenantA,
      ada,
      bo,
      cy,
      adaMembership,
      boMembership,
      staffMembership,
      adaOwn,
      aboutAda,
      adaForBo,
      cyWithAda,
      adaRecording,
      recordingFile,
      shared,
      adaOnly,
      usage,
    };
  });
}

type Call = { url: string; method: string };

function stubVendors(options: { membershipStatus?: number } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (url.includes(`/organizations/${ORG_A}/memberships/`) && method === "DELETE") {
        const status = options.membershipStatus ?? 200;
        return status === 200 ? json({ deleted: true }) : json({ errors: [{ code: "x", message: "boom" }] }, status);
      }
      if (url.includes("/organization_memberships")) return json({ data: [], total_count: 0 });
      if (url.startsWith("https://api.elevenlabs.io/") || url.startsWith("https://api.clerk.com/")) {
        return method === "DELETE" ? json({ deleted: true }) : json({}, 404);
      }
      // Anything else (the rebuilds' AI calls) is out of scope here.
      return json({ error: "not in this test" }, 503);
    }),
  );
  return calls;
}

async function settle(t: TestConvex) {
  for (let step = 0; step < 30; step++) {
    vi.advanceTimersByTime(1_000);
    await t.finishInProgressScheduledFunctions();
  }
}

async function latestErasure(t: TestConvex) {
  return await t.run((ctx) => ctx.db.query("personErasures").order("desc").first());
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

describe("erasing a person", () => {
  test("removes everything about them from the workspace, and their account", async () => {
    const t = makeTest();
    const ids = await seed(t);
    const calls = stubVendors();
    const staff = t.withIdentity(identity("user_staff"));

    expect(
      await staff.query(api.personErasure.preview, { tenantId: ids.tenantA, membershipId: ids.adaMembership }),
    ).toMatchObject({ contributionsDeleted: 3, contributionsDenamed: 1, otherWorkspaces: 0, isStaff: false });

    await staff.mutation(api.personErasure.eraseMember, {
      tenantId: ids.tenantA,
      membershipId: ids.adaMembership,
      confirmEmail: "USER_ADA@example.test",
    });
    // Access ends straight away, before any background step.
    await expect(
      t.withIdentity(identity("user_ada", ORG_A)).query(api.functions.list, {}),
    ).rejects.toThrow();
    await settle(t);

    const state = await t.run(async (ctx) => ({
      membership: await ctx.db.get(ids.adaMembership),
      adaOwn: await ctx.db.get(ids.adaOwn),
      aboutAda: await ctx.db.get(ids.aboutAda),
      adaRecording: await ctx.db.get(ids.adaRecording),
      adaForBo: await ctx.db.get(ids.adaForBo),
      cyWithAda: await ctx.db.get(ids.cyWithAda),
      file: (await ctx.storage.get(ids.recordingFile)) !== null,
      shared: await ctx.db.get(ids.shared),
      adaOnly: await ctx.db.get(ids.adaOnly),
      intents: await ctx.db.query("membershipIntents").collect(),
      audit: await ctx.db.query("authAuditEvents").collect(),
      deletions: await ctx.db.query("conversationDeletions").collect(),
      grants: await ctx.db.query("voiceUploadGrants").collect(),
      threads: await ctx.db.query("askThreads").collect(),
      usage: await ctx.db.get(ids.usage),
      ada: await ctx.db.get(ids.ada),
      cyMembership: await ctx.db
        .query("memberships")
        .withIndex("by_tokenIdentifier_and_clerkOrgId", (q) =>
          q.eq("tokenIdentifier", `${ISSUER}|user_cy`).eq("clerkOrgId", ORG_A),
        )
        .unique(),
    }));

    expect(state.membership).toBeNull();
    // Interviews they gave, by themselves or about them, are gone.
    expect([state.adaOwn, state.aboutAda, state.adaRecording]).toEqual([null, null, null]);
    expect(state.file).toBe(false);
    // One they recorded for Bo stays, without their name.
    expect(state.adaForBo).toMatchObject({ contributorName: "Bo", submittedByName: "Former member" });
    expect(state.adaForBo?.userId).toBeUndefined();
    // In Cy's recording, they stop being named; Cy's words and label stay.
    expect(state.cyWithAda?.speakerLabels).toEqual([
      { speakerId: "s1", displayName: "Cy", userId: ids.cy },
      { speakerId: "s2", displayName: "Former member" },
    ]);
    expect(state.cyWithAda?.transcript?.map((m) => m.speakerName)).toEqual(["Cy", "Former member"]);

    // D7: overviews built from their interviews are cleared.
    expect(state.shared?.rollingSummary).toBeUndefined();
    expect(state.adaOnly?.rollingSummary).toBeUndefined();

    // Records that named them.
    expect(state.intents).toHaveLength(0);
    expect(state.audit.some((e) => e.targetUserId === ids.ada || e.targetEmailLower?.includes("ada"))).toBe(false);
    expect(state.audit.some((e) => e.detail?.includes("Ada"))).toBe(false);
    expect(state.deletions[0]).toMatchObject({ contributorName: "Former member", actorName: "Cy" });
    expect(state.grants).toHaveLength(0);
    expect(state.threads).toHaveLength(0);
    expect(state.usage).toMatchObject({ costMicroUsd: 10 });
    expect(state.usage?.actorName).toBeUndefined();
    expect(state.cyMembership?.invitedBy).toBeUndefined();

    // D5: in no other workspace, so the account and profile go.
    expect(state.ada).toMatchObject({ name: "Former member", email: "" });
    const deletes = calls.filter((c) => c.method === "DELETE").map((c) => c.url);
    expect(deletes).toContain(`https://api.clerk.com/v1/organizations/${ORG_A}/memberships/user_ada`);
    expect(deletes).toContain("https://api.elevenlabs.io/v1/convai/conversations/conv_ada");
    expect(deletes).toContain("https://api.clerk.com/v1/users/user_ada");
    expect(deletes.some((u) => u.includes(`/organizations/${ORG_A}`) && !u.includes("/memberships/"))).toBe(false);

    const erasure = await latestErasure(t);
    expect(erasure).toMatchObject({
      status: "complete",
      account: "erased",
      clerkMembership: "removed",
      counts: {
        contributionsDeleted: 3,
        contributionsDenamed: 1,
        filesDeleted: 1,
        processesRebuilt: 1,
        processesCleared: 1,
        elevenlabsDeleted: 1,
      },
    });
    // The record of the erasure no longer says who it was.
    expect(erasure?.emailLower).toBeUndefined();
    expect(erasure?.name).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("personErasureItems").collect())).toHaveLength(0);
  });

  test("keeps the account of someone in another workspace", async () => {
    const t = makeTest();
    const ids = await seed(t);
    const calls = stubVendors();
    await t.withIdentity(identity("user_staff")).mutation(api.personErasure.eraseMember, {
      tenantId: ids.tenantA,
      membershipId: ids.boMembership,
      confirmEmail: "user_bo@example.test",
    });
    await settle(t);

    expect(await latestErasure(t)).toMatchObject({ status: "complete", account: "keptOtherWorkspace" });
    expect((await t.run((ctx) => ctx.db.get(ids.bo)))?.name).toBe("bo");
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/users/user_bo"))).toBe(false);
    // Still a member of the other workspace.
    const other = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_tokenIdentifier_and_clerkOrgId", (q) =>
          q.eq("tokenIdentifier", `${ISSUER}|user_bo`).eq("clerkOrgId", ORG_B),
        )
        .unique(),
    );
    expect(other).not.toBeNull();
  });

  test("stops for a retry when Clerk won't remove the membership", async () => {
    const t = makeTest();
    const ids = await seed(t);
    stubVendors({ membershipStatus: 500 });
    const staff = t.withIdentity(identity("user_staff"));
    await staff.mutation(api.personErasure.eraseMember, {
      tenantId: ids.tenantA,
      membershipId: ids.adaMembership,
      confirmEmail: "user_ada@example.test",
    });
    await settle(t);

    const stuck = await latestErasure(t);
    expect(stuck).toMatchObject({ status: "needsRetry", clerkMembership: "failed" });
    // Fabric access is gone regardless; nothing else has been touched yet.
    expect((await t.run((ctx) => ctx.db.get(ids.adaMembership)))?.status).toBe("removed");
    expect(await t.run((ctx) => ctx.db.get(ids.adaOwn))).not.toBeNull();

    stubVendors();
    await staff.mutation(api.personErasure.retryErasure, { erasureId: stuck!._id });
    await settle(t);
    expect(await latestErasure(t)).toMatchObject({ status: "complete", account: "erased" });
  });

  test("is for platform staff, never erases staff, and needs the email typed", async () => {
    const t = makeTest();
    const ids = await seed(t);
    stubVendors();
    const staff = t.withIdentity(identity("user_staff"));

    await expect(
      t.withIdentity(identity("user_cy")).mutation(api.personErasure.eraseMember, {
        tenantId: ids.tenantA,
        membershipId: ids.adaMembership,
        confirmEmail: "user_ada@example.test",
      }),
    ).rejects.toThrow(/Platform super-admin required/);
    await expect(
      staff.mutation(api.personErasure.eraseMember, {
        tenantId: ids.tenantA,
        membershipId: ids.adaMembership,
        confirmEmail: "user_bo@example.test",
      }),
    ).rejects.toThrow(/to confirm/);
    await expect(
      staff.mutation(api.personErasure.eraseMember, {
        tenantId: ids.tenantA,
        membershipId: ids.staffMembership,
        confirmEmail: "user_staff@example.test",
      }),
    ).rejects.toThrow(/staff can't be erased/);
    expect(await t.run((ctx) => ctx.db.query("personErasures").collect())).toHaveLength(0);
  });
});

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { placeProcesses, safeSegment, toCsv } from "./lib/exportRender";

/**
 * Workspace export, phase 2 (docs/client-offboarding-plan.md, D3).
 */

const modules = import.meta.glob("./**/*.ts");
const makeTest = () => convexTest(schema, modules);
type TestConvex = ReturnType<typeof makeTest>;
const ISSUER = "https://test.clerk";
const ORG_A = "org_exporting";
const ORG_B = "org_other";
const AGENT_AUDIO = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 4]);
const RECORDED_AUDIO = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 9, 9]);

function identity(name: string) {
  return { tokenIdentifier: `${ISSUER}|${name}`, subject: name, issuer: ISSUER, name };
}

type Ids = {
  tenantA: Id<"tenants">;
  tenantB: Id<"tenants">;
  recordedStorage: Id<"_storage">;
};

async function seed(t: TestConvex): Promise<Ids> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("users", {
      tokenIdentifier: `${ISSUER}|user_staff`,
      name: "Staff Member",
      email: "staff@bizgroup.test",
      profileComplete: true,
      platformRole: "superAdmin",
    });
    const ada = await ctx.db.insert("users", {
      tokenIdentifier: `${ISSUER}|user_ada`,
      name: "Ada",
      email: "ada@client.test",
      profileComplete: true,
    });
    await ctx.db.insert("memberships", {
      tokenIdentifier: `${ISSUER}|user_ada`,
      userId: ada,
      clerkOrgId: ORG_A,
      role: "admin",
      name: "Ada",
      email: "ada@client.test",
      createdAt: now,
    });
    const tenant = (clerkOrgId: string, slug: string) =>
      ctx.db.insert("tenants", {
        clerkOrgId,
        name: slug === "acme" ? "Acme Ltd" : "Other Co",
        slug,
        allowedEmailDomains: [],
        status: "active",
        source: "console",
        createdAt: now,
        updatedAt: now,
      });
    const tenantA = await tenant(ORG_A, "acme");
    const tenantB = await tenant(ORG_B, "other");

    const fn = await ctx.db.insert("functions", { name: "Finance", sortOrder: 0, clerkOrgId: ORG_A });
    const dept = await ctx.db.insert("departments", {
      functionId: fn,
      name: "Payables",
      sortOrder: 0,
      clerkOrgId: ORG_A,
    });
    const proc = await ctx.db.insert("processes", {
      departmentId: dept,
      name: "Invoice approval",
      description: "From receipt to payment.",
      sortOrder: 0,
      clerkOrgId: ORG_A,
    });
    const transcript = (line: string) => [
      { role: "agent", content: "How do invoices arrive?", time_in_call_secs: 0 },
      { role: "user", content: line, time_in_call_secs: 4 },
    ];
    await ctx.db.insert("conversations", {
      processId: proc,
      elevenlabsConversationId: "conv_ok",
      contributorName: "Ada",
      userId: ada,
      inputMode: "agent",
      title: "Invoices by email",
      transcript: transcript("They come in by email to the AP inbox."),
      durationSeconds: 125,
      status: "done",
      clerkOrgId: ORG_A,
    });
    await ctx.db.insert("conversations", {
      processId: proc,
      elevenlabsConversationId: "conv_gone",
      contributorName: "Ada",
      inputMode: "agent",
      transcript: transcript("Sometimes on paper."),
      status: "done",
      clerkOrgId: ORG_A,
    });
    const recordedStorage = await ctx.storage.store(new Blob([RECORDED_AUDIO], { type: "audio/webm" }));
    await ctx.db.insert("conversations", {
      processId: proc,
      contributorName: "Grace",
      inputMode: "voiceRecord",
      audioStorageId: recordedStorage,
      audioMimeType: "audio/webm",
      transcript: transcript("I approve them in the ERP."),
      status: "done",
      clerkOrgId: ORG_A,
    });
    // Private to Ada: must never leave the workspace in an export.
    await ctx.db.insert("askThreads", {
      clerkOrgId: ORG_A,
      userId: ada,
      title: "PRIVATE-ASK-THREAD",
      status: "active",
      lastMessageAt: now,
    });

    const fnB = await ctx.db.insert("functions", { name: "OTHER-ORG-SECRET", sortOrder: 0, clerkOrgId: ORG_B });
    const deptB = await ctx.db.insert("departments", {
      functionId: fnB,
      name: "Elsewhere",
      sortOrder: 0,
      clerkOrgId: ORG_B,
    });
    const procB = await ctx.db.insert("processes", {
      departmentId: deptB,
      name: "Elsewhere",
      sortOrder: 0,
      clerkOrgId: ORG_B,
    });
    await ctx.db.insert("conversations", {
      processId: procB,
      contributorName: "Bo",
      inputMode: "agent",
      transcript: transcript("OTHER-ORG-TRANSCRIPT"),
      status: "done",
      clerkOrgId: ORG_B,
    });
    return { tenantA, tenantB, recordedStorage };
  });
}

function stubElevenLabs() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/conv_ok/audio")) {
        return new Response(AGENT_AUDIO, { status: 200, headers: { "content-type": "audio/mpeg" } });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

/** Steps the scheduler until the export leaves `running` (never as far as expiry). */
async function runExport(t: TestConvex, exportId: Id<"tenantExports">) {
  for (let step = 0; step < 50; step++) {
    vi.advanceTimersByTime(1_000);
    await t.finishInProgressScheduledFunctions();
    const row = await t.run((ctx) => ctx.db.get(exportId));
    if (row?.status !== "running") return row;
  }
  throw new Error("Export did not finish");
}

async function unzipFile(t: TestConvex, storageId: Id<"_storage">) {
  const bytes = await t.run(async (ctx) => {
    const blob = await ctx.storage.get(storageId);
    return blob ? await blob.arrayBuffer() : null;
  });
  if (!bytes) throw new Error("zip missing");
  return unzipSync(new Uint8Array(bytes));
}

async function exportFiles(t: TestConvex, exportId: Id<"tenantExports">) {
  return await t.run((ctx) =>
    ctx.db
      .query("tenantExportFiles")
      .withIndex("by_clerkOrgId_and_exportId", (q) => q.eq("clerkOrgId", ORG_A).eq("exportId", exportId))
      .collect(),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  process.env.ELEVENLABS_API_KEY = "xi_test";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("workspace export", () => {
  test("zips every interview, recording and record of the workspace, and nothing else", async () => {
    const t = makeTest();
    const ids = await seed(t);
    stubElevenLabs();

    const exportId = await t
      .withIdentity(identity("user_staff"))
      .mutation(api.workspaceExport.startExport, { tenantId: ids.tenantA });
    const done = await runExport(t, exportId);
    expect(done).toMatchObject({ status: "ready", audioIncluded: 2, audioMissing: 1, partCount: 1 });

    const files = await exportFiles(t, exportId);
    const date = new Date(done!.createdAt).toISOString().slice(0, 10);
    const root = `acme-export-${date}`;
    expect(files.map((f) => f.name).sort()).toEqual([`${root}-audio-1.zip`, `${root}-data.zip`]);

    const audioZip = await unzipFile(t, files.find((f) => f.kind === "audio")!.storageId);
    const audioPaths = Object.keys(audioZip).sort();
    expect(audioPaths).toHaveLength(2);
    expect(audioPaths.every((p) => p.startsWith(`${root}/audio/Finance/Payables/Invoice approval/`))).toBe(true);
    expect(audioPaths.some((p) => p.endsWith(".mp3"))).toBe(true);
    expect(audioPaths.some((p) => p.endsWith(".webm"))).toBe(true);
    const agentFile = audioPaths.find((p) => p.endsWith(".mp3"))!;
    expect([...audioZip[agentFile]]).toEqual([...AGENT_AUDIO]);

    const dataZip = await unzipFile(t, files.find((f) => f.kind === "data")!.storageId);
    const text = (path: string) => strFromU8(dataZip[`${root}/${path}`]);
    const paths = Object.keys(dataZip).map((p) => p.slice(root.length + 1));

    expect(paths).toContain("README.md");
    expect(paths).toContain("processes/Finance/Payables/Invoice approval.md");
    expect(paths).toContain("overviews/Finance.md");
    expect(paths).toContain("overviews/Finance/Payables.md");
    const interviews = paths.filter((p) => p.startsWith("interviews/Finance/Payables/Invoice approval/"));
    expect(interviews).toHaveLength(3);
    const emailInterview = interviews.map(text).find((md) => md.includes("Invoices by email"))!;
    expect(emailInterview).toContain("**Ada** [0:04]: They come in by email to the AP inbox.");
    expect(emailInterview).toContain("**Fabric interviewer** [0:00]");
    expect(emailInterview).toContain("- **Length:** 2:05");
    expect(emailInterview).toContain(`${root}-audio-1.zip`);

    const index = text("audio-index.csv");
    expect(index).toContain("ElevenLabs no longer holds this recording");
    expect(text("members.csv")).toContain("ada@client.test");
    expect(text("processes/Finance/Payables/Invoice approval.md")).toContain("From receipt to payment.");

    // Raw records: this workspace's only, and never the private AskFabric chats.
    const conversations = JSON.parse(text("data/conversations.json")) as { clerkOrgId: string }[];
    expect(conversations).toHaveLength(3);
    expect(conversations.every((c) => c.clerkOrgId === ORG_A)).toBe(true);
    expect(paths.some((p) => p.startsWith("data/ask"))).toBe(false);
    const everything = Object.values(dataZip).map((bytes) => strFromU8(bytes)).join("\n");
    expect(everything).not.toContain("PRIVATE-ASK-THREAD");
    expect(everything).not.toContain("OTHER-ORG");
    expect(text("README.md")).toContain("AskFabric chats are private to each member");

    // The recordings themselves are untouched by exporting.
    expect(await t.run(async (ctx) => (await ctx.storage.get(ids.recordedStorage)) !== null)).toBe(true);
  });

  test("lists download links for platform admins, then deletes the files after 7 days", async () => {
    const t = makeTest();
    const ids = await seed(t);
    stubElevenLabs();
    const staff = t.withIdentity(identity("user_staff"));
    const exportId = await staff.mutation(api.workspaceExport.startExport, { tenantId: ids.tenantA });
    await runExport(t, exportId);

    const listed = await staff.query(api.workspaceExport.listExports, { tenantId: ids.tenantA });
    expect(listed[0]).toMatchObject({ status: "ready" });
    expect(listed[0].files[0]).toMatchObject({ kind: "data" });
    expect(listed[0].files.every((f) => typeof f.url === "string")).toBe(true);
    const storageIds = (await exportFiles(t, exportId)).map((f) => f.storageId);

    vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000 + 1_000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await t.run((ctx) => ctx.db.get(exportId)))?.status).toBe("expired");
    expect(await exportFiles(t, exportId)).toHaveLength(0);
    for (const storageId of storageIds) {
      expect(await t.run(async (ctx) => (await ctx.storage.get(storageId)) === null)).toBe(true);
    }
  });

  test("can be discarded early, and stops a running build", async () => {
    const t = makeTest();
    const ids = await seed(t);
    stubElevenLabs();
    const staff = t.withIdentity(identity("user_staff"));
    const exportId = await staff.mutation(api.workspaceExport.startExport, { tenantId: ids.tenantA });
    await staff.mutation(api.workspaceExport.discardExport, { exportId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await t.run((ctx) => ctx.db.get(exportId)))?.status).toBe("failed");
    expect(await exportFiles(t, exportId)).toHaveLength(0);
  });

  test("is for platform admins only, one at a time, and not after a purge", async () => {
    const t = makeTest();
    const ids = await seed(t);
    const staff = t.withIdentity(identity("user_staff"));

    await expect(
      t.withIdentity(identity("user_ada")).mutation(api.workspaceExport.startExport, { tenantId: ids.tenantA }),
    ).rejects.toThrow(/Platform super-admin required/);

    await staff.mutation(api.workspaceExport.startExport, { tenantId: ids.tenantA });
    await expect(
      staff.mutation(api.workspaceExport.startExport, { tenantId: ids.tenantA }),
    ).rejects.toThrow(/already being prepared/);
    await expect(
      t.withIdentity(identity("user_ada")).query(api.workspaceExport.listExports, { tenantId: ids.tenantA }),
    ).rejects.toThrow(/Platform super-admin required/);

    await t.run((ctx) => ctx.db.patch(ids.tenantB, { status: "purged" }));
    await expect(
      staff.mutation(api.workspaceExport.startExport, { tenantId: ids.tenantB }),
    ).rejects.toThrow(/nothing to export/);
  });
});

describe("export rendering", () => {
  test("keeps path segments safe and spreadsheet cells inert", () => {
    expect(safeSegment('a/b\\c:d*?"<>|e. ')).toBe("a b c d e");
    expect(safeSegment("   ")).toBe("untitled");
    expect(toCsv(["x"], [["=HYPERLINK(\"bad\")"], ["plain, comma"]])).toBe(
      'x\r\n"\'=HYPERLINK(""bad"")"\r\n"plain, comma"\r\n',
    );
  });

  test("gives same-named processes distinct folders", () => {
    const places = placeProcesses({
      functions: [{ id: "f1", name: "Ops" }],
      departments: [{ id: "d1", name: "Hub", functionId: "f1" }],
      processes: [
        { id: "p_aaaaaa111111", name: "Intake", departmentId: "d1" },
        { id: "p_bbbbbb222222", name: "Intake", departmentId: "d1" },
        { id: "p_cccccc333333", name: "Orphan", departmentId: "gone" },
      ],
    });
    expect(places.get("p_aaaaaa111111")?.segments[2]).toBe("Intake (111111)");
    expect(places.get("p_bbbbbb222222")?.segments[2]).toBe("Intake (222222)");
    expect(places.get("p_cccccc333333")?.segments).toEqual(["Unfiled", "Unfiled", "Orphan"]);
  });
});

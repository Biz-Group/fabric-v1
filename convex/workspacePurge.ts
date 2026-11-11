import { v } from "convex/values";
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { requireSuperAdmin } from "./lib/orgAuth";
import { TENANT_DATA, type OrgTableEntry } from "./lib/tenantData";
import { userError } from "./lib/userError";
import { blankUserProfile } from "./lib/profileErasure";
import {
  assertClerkId,
  ClerkApiError,
  clerkFetch,
  clerkUserIdFromTokenIdentifier,
  isClerkId,
} from "./lib/clerkApi";
import {
  buildElevenLabsConversationUrl,
  isElevenLabsConversationId,
} from "./lib/elevenLabsConversation";

// ---------------------------------------------------------------------------
// Workspace purge, phase 3 (docs/client-offboarding-plan.md).
//
// The one-way deletion of a suspended workspace: automatically 30 days after
// suspension (D2, the hourly cron below), or straight away when a platform
// admin presses "Delete data now" because the client asked. Phases:
//
//   collect  – note every ElevenLabs conversation id and every person before
//              the rows naming them go (all clients share one ElevenLabs agent,
//              so the Fabric row is the only record of whose a recording is)
//   tables   – delete the org's rows in every table the registry
//              (lib/tenantData.ts) marks "delete", with their stored files;
//              scrub names from the usage ledger; reduce the tenant row to a
//              tombstone
//   vendors  – delete the Clerk org, the ElevenLabs conversations, and the
//              Clerk accounts of people in no other workspace (D5)
//   verify   – count what is left; anything a late background job wrote is
//              swept again, up to three rounds
//
// The purge row is the completion certificate (D4). A vendor failure leaves
// it at needsRetry, never complete (D6).
// ---------------------------------------------------------------------------

const ROW_BATCH = 25;
const COLLECT_BATCH = 200;
const SCRUB_BATCH = 200;
const VENDOR_BATCH = 25;
const MAX_SWEEP_ROUNDS = 3;
const SWEEP_RETRY_MS = 2 * 60 * 1000;
/** A running purge not heard from in this long is resumed by the cron. */
const STALE_MS = 15 * 60 * 1000;

/** Tables the purge deletes, in order: every org table the registry marks "delete". */
export function purgeTables(): { table: TableNames; entry: OrgTableEntry }[] {
  return (Object.entries(TENANT_DATA) as [TableNames, (typeof TENANT_DATA)[TableNames]][])
    .filter((pair): pair is [TableNames, OrgTableEntry] => {
      const entry = pair[1];
      return entry.scope === "org" && entry.purge === "delete";
    })
    .map(([table, entry]) => ({ table, entry }));
}

type OrgIndexedTable = {
  withIndex(
    index: string,
    range: (q: { eq(field: "clerkOrgId", value: string): unknown }) => unknown,
  ): {
    take(n: number): Promise<(Record<string, unknown> & { _id: Id<TableNames> })[]>;
    first(): Promise<Record<string, unknown> | null>;
  };
};

function orgRows(ctx: MutationCtx, table: TableNames, entry: OrgTableEntry, clerkOrgId: string) {
  // The registry test guarantees `orgIndex` exists and leads with clerkOrgId.
  return (ctx.db.query(table) as unknown as OrgIndexedTable).withIndex(entry.orgIndex, (q) =>
    q.eq("clerkOrgId", clerkOrgId),
  );
}

async function deleteStoredFile(ctx: MutationCtx, value: unknown): Promise<number> {
  if (typeof value !== "string") return 0;
  try {
    await ctx.storage.delete(value as Id<"_storage">);
    return 1;
  } catch {
    return 0; // Already gone.
  }
}

// ---- Starting ----------------------------------------------------------------

async function beginPurge(
  ctx: MutationCtx,
  tenant: Doc<"tenants">,
  trigger: "scheduled" | "manual",
  actor?: Doc<"users">,
): Promise<Id<"tenantPurges">> {
  const now = Date.now();
  await ctx.db.patch(tenant._id, { status: "purging", updatedAt: now });

  // An export still being built would write files after its rows are gone.
  const running = await ctx.db
    .query("tenantExports")
    .withIndex("by_clerkOrgId_and_createdAt", (q) => q.eq("clerkOrgId", tenant.clerkOrgId))
    .order("desc")
    .take(20);
  for (const row of running) {
    if (row.status === "running") {
      await ctx.db.patch(row._id, { status: "failed", error: "The workspace's data is being deleted.", updatedAt: now });
    }
  }

  const purgeId = await ctx.db.insert("tenantPurges", {
    clerkOrgId: tenant.clerkOrgId,
    tenantId: tenant._id,
    trigger,
    ...(actor ? { requestedByUserId: actor._id, requestedByName: actor.name || "A platform admin" } : {}),
    status: "running",
    phase: "collect",
    collectSource: "conversations",
    cursor: null,
    tableIndex: 0,
    sweepRound: 0,
    rowsDeleted: {},
    filesDeleted: 0,
    usageRowsScrubbed: 0,
    elevenlabs: { deleted: 0, alreadyGone: 0, skipped: 0, failed: 0 },
    clerkOrg: "pending",
    people: { erased: 0, keptOtherWorkspace: 0, keptStaff: 0, alreadyErased: 0, failed: 0 },
    startedAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.workspacePurge.collectStep, { purgeId });
  return purgeId;
}

/** Hourly: purges workspaces whose 30 days are up, and resumes stalled purges. */
export const startDuePurges = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const tenants = await ctx.db.query("tenants").take(1000);
    let started = 0;
    for (const tenant of tenants) {
      if (
        tenant.status === "suspended" &&
        tenant.offboarding !== undefined &&
        tenant.offboarding.purgeAfter <= now
      ) {
        await beginPurge(ctx, tenant, "scheduled");
        started++;
      }
    }
    const stalled = await ctx.db
      .query("tenantPurges")
      .withIndex("by_status_and_updatedAt", (q) => q.eq("status", "running").lt("updatedAt", now - STALE_MS))
      .take(20);
    for (const purge of stalled) {
      await ctx.db.patch(purge._id, { updatedAt: now });
      await schedulePhase(ctx, purge);
    }
    return { started, resumed: stalled.length };
  },
});

/** "Delete data now": the client asked for deletion before the 30 days are up. */
export const purgeNow = mutation({
  args: { tenantId: v.id("tenants"), confirmSlug: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireSuperAdmin(ctx);
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) throw userError("NOT_FOUND", "That workspace doesn't exist.");
    if (tenant.status !== "suspended") {
      throw userError("NOT_SUSPENDED", "Close the workspace before deleting its data.");
    }
    if (args.confirmSlug.trim().toLowerCase() !== tenant.slug.toLowerCase()) {
      throw userError("CONFIRMATION_MISMATCH", `Type the workspace's address, ${tenant.slug}, to confirm.`);
    }
    return await beginPurge(ctx, tenant, "manual", actor);
  },
});

async function schedulePhase(ctx: MutationCtx, purge: Doc<"tenantPurges">) {
  const next =
    purge.phase === "collect"
      ? internal.workspacePurge.collectStep
      : purge.phase === "tables"
        ? internal.workspacePurge.tableStep
        : purge.phase === "vendors"
          ? internal.workspacePurge.vendorStep
          : purge.phase === "verify"
            ? internal.workspacePurge.verifyStep
            : null;
  if (next) await ctx.scheduler.runAfter(0, next, { purgeId: purge._id });
}

async function loadRunning(ctx: MutationCtx, purgeId: Id<"tenantPurges">, phase: Doc<"tenantPurges">["phase"]) {
  const purge = await ctx.db.get(purgeId);
  return purge && purge.status === "running" && purge.phase === phase ? purge : null;
}

// ---- Collect --------------------------------------------------------------------

async function addItem(
  ctx: MutationCtx,
  purge: Doc<"tenantPurges">,
  kind: Doc<"tenantPurgeItems">["kind"],
  externalId: string,
) {
  const existing = await ctx.db
    .query("tenantPurgeItems")
    .withIndex("by_purgeId_and_kind_and_externalId", (q) =>
      q.eq("purgeId", purge._id).eq("kind", kind).eq("externalId", externalId),
    )
    .first();
  if (existing) return;
  await ctx.db.insert("tenantPurgeItems", {
    clerkOrgId: purge.clerkOrgId,
    purgeId: purge._id,
    kind,
    externalId,
    status: "pending",
  });
}

export const collectStep = internalMutation({
  args: { purgeId: v.id("tenantPurges") },
  handler: async (ctx, args) => {
    const purge = await loadRunning(ctx, args.purgeId, "collect");
    if (!purge) return;
    const now = Date.now();

    if (purge.collectSource !== "memberships") {
      const page = await ctx.db
        .query("conversations")
        .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", purge.clerkOrgId))
        .paginate({ numItems: COLLECT_BATCH, cursor: purge.cursor });
      for (const conv of page.page) {
        if (conv.elevenlabsConversationId) {
          await addItem(ctx, purge, "elevenlabsConversation", conv.elevenlabsConversationId);
        }
        if (conv.userId) await addItem(ctx, purge, "person", conv.userId);
        if (conv.subjectUserId) await addItem(ctx, purge, "person", conv.subjectUserId);
      }
      await ctx.db.patch(purge._id, {
        collectSource: page.isDone ? "memberships" : "conversations",
        cursor: page.isDone ? null : page.continueCursor,
        updatedAt: now,
      });
    } else {
      const page = await ctx.db
        .query("memberships")
        .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", purge.clerkOrgId))
        .paginate({ numItems: COLLECT_BATCH, cursor: purge.cursor });
      for (const membership of page.page) {
        await addItem(ctx, purge, "person", membership.userId);
      }
      await ctx.db.patch(purge._id, {
        ...(page.isDone
          ? { phase: "tables" as const, collectSource: undefined, cursor: null, tableIndex: 0 }
          : { cursor: page.continueCursor }),
        updatedAt: now,
      });
      if (page.isDone) {
        await ctx.scheduler.runAfter(0, internal.workspacePurge.tableStep, args);
        return;
      }
    }
    await ctx.scheduler.runAfter(0, internal.workspacePurge.collectStep, args);
  },
});

// ---- Tables -------------------------------------------------------------------------

export const tableStep = internalMutation({
  args: { purgeId: v.id("tenantPurges") },
  handler: async (ctx, args) => {
    const purge = await loadRunning(ctx, args.purgeId, "tables");
    if (!purge) return;
    const tables = purgeTables();
    const now = Date.now();

    if (purge.tableIndex < tables.length) {
      const { table, entry } = tables[purge.tableIndex];
      const rows = await orgRows(ctx, table, entry, purge.clerkOrgId).take(ROW_BATCH);
      let files = 0;
      for (const row of rows) {
        if (table === "askThreads") {
          // Read-aloud audio has no org index; it goes with its thread.
          const speech = await ctx.db
            .query("askSpeech")
            .withIndex("by_threadId", (q) => q.eq("threadId", row._id as Id<"askThreads">))
            .take(200);
          for (const clip of speech) {
            files += await deleteStoredFile(ctx, clip.storageId);
            await ctx.db.delete(clip._id);
          }
        }
        for (const field of entry.storageFields ?? []) files += await deleteStoredFile(ctx, row[field]);
        await ctx.db.delete(row._id);
      }
      await ctx.db.patch(purge._id, {
        tableIndex: rows.length < ROW_BATCH ? purge.tableIndex + 1 : purge.tableIndex,
        rowsDeleted: { ...purge.rowsDeleted, [table]: (purge.rowsDeleted[table] ?? 0) + rows.length },
        filesDeleted: purge.filesDeleted + files,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.workspacePurge.tableStep, args);
      return;
    }

    if (purge.tableIndex === tables.length) {
      // The usage ledger stays for invoicing (D4) without people's names in it.
      const page = await ctx.db
        .query("aiUsageEvents")
        .withIndex("by_clerkOrgId_and_createdAt", (q) => q.eq("clerkOrgId", purge.clerkOrgId))
        .paginate({ numItems: SCRUB_BATCH, cursor: purge.cursor });
      let scrubbed = 0;
      for (const row of page.page) {
        if (row.actorName !== undefined || row.actorUserId !== undefined || row.entityLabel !== undefined) {
          await ctx.db.patch(row._id, { actorName: undefined, actorUserId: undefined, entityLabel: undefined });
          scrubbed++;
        }
      }
      await ctx.db.patch(purge._id, {
        cursor: page.isDone ? null : page.continueCursor,
        tableIndex: page.isDone ? purge.tableIndex + 1 : purge.tableIndex,
        usageRowsScrubbed: purge.usageRowsScrubbed + scrubbed,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.workspacePurge.tableStep, args);
      return;
    }

    // The tenant row becomes a tombstone: name, address, dates and the
    // closure note stay; the logo and the first invitee's email go.
    const tenant = await ctx.db.get(purge.tenantId);
    let files = 0;
    if (tenant) {
      files += await deleteStoredFile(ctx, tenant.logoStorageId);
      await ctx.db.patch(tenant._id, {
        logoUrl: undefined,
        logoStorageId: undefined,
        allowedEmailDomains: [],
        provisioningErrors: undefined,
        firstInviteEmail: undefined,
        firstInviteRole: undefined,
        updatedAt: now,
      });
    }
    // A re-sweep has nothing left outside Fabric to do.
    const nextPhase = purge.sweepRound === 0 ? ("vendors" as const) : ("verify" as const);
    await ctx.db.patch(purge._id, { phase: nextPhase, filesDeleted: purge.filesDeleted + files, updatedAt: now });
    await ctx.scheduler.runAfter(
      0,
      nextPhase === "vendors" ? internal.workspacePurge.vendorStep : internal.workspacePurge.verifyStep,
      args,
    );
  },
});

// ---- Vendors ------------------------------------------------------------------------

export const vendorStateInternal = internalQuery({
  args: { purgeId: v.id("tenantPurges") },
  handler: async (ctx, args) => {
    const purge = await ctx.db.get(args.purgeId);
    if (!purge || purge.status !== "running" || purge.phase !== "vendors") return null;
    const items = await ctx.db
      .query("tenantPurgeItems")
      .withIndex("by_clerkOrgId_and_purgeId_and_status", (q) =>
        q.eq("clerkOrgId", purge.clerkOrgId).eq("purgeId", purge._id).eq("status", "pending"),
      )
      .take(VENDOR_BATCH);
    return { clerkOrgId: purge.clerkOrgId, clerkOrg: purge.clerkOrg, items };
  },
});

export type PersonVerdict =
  | { kind: "alreadyErased" }
  | { kind: "keptStaff" }
  | { kind: "keptOtherWorkspace" }
  | { kind: "erase"; clerkUserId: string | null };

/** D5: erase only people in no other workspace, and never Biz Group staff. */
export const personVerdictInternal = internalQuery({
  args: { userId: v.string(), clerkOrgId: v.string() },
  handler: async (ctx, args): Promise<PersonVerdict> => {
    const userId = ctx.db.normalizeId("users", args.userId);
    const user = userId ? await ctx.db.get(userId) : null;
    if (!user || user.deletedAt !== undefined) return { kind: "alreadyErased" };
    if (user.platformRole === "superAdmin") return { kind: "keptStaff" };
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .take(100);
    if (memberships.some((m) => m.clerkOrgId !== args.clerkOrgId)) {
      return { kind: "keptOtherWorkspace" };
    }
    const clerkUserId = user.clerkUserId ?? clerkUserIdFromTokenIdentifier(user.tokenIdentifier);
    return { kind: "erase", clerkUserId: isClerkId(clerkUserId, "user") ? clerkUserId : null };
  },
});

export const recordVendorResults = internalMutation({
  args: {
    purgeId: v.id("tenantPurges"),
    clerkOrg: v.optional(
      v.union(v.literal("deleted"), v.literal("alreadyGone"), v.literal("failed")),
    ),
    clerkOrgError: v.optional(v.string()),
    items: v.array(
      v.object({
        itemId: v.id("tenantPurgeItems"),
        status: v.union(v.literal("done"), v.literal("skipped"), v.literal("failed")),
        outcome: v.string(),
        error: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const purge = await loadRunning(ctx, args.purgeId, "vendors");
    if (!purge) return;
    const elevenlabs = { ...purge.elevenlabs };
    const people = { ...purge.people };
    for (const result of args.items) {
      const item = await ctx.db.get(result.itemId);
      if (!item || item.purgeId !== purge._id || item.status !== "pending") continue;
      await ctx.db.patch(item._id, { status: result.status, outcome: result.outcome, error: result.error });
      if (item.kind === "elevenlabsConversation") {
        const key = result.outcome as keyof typeof elevenlabs;
        if (key in elevenlabs) elevenlabs[key]++;
      } else {
        const key = result.outcome as keyof typeof people;
        if (key in people) people[key]++;
      }
    }
    await ctx.db.patch(purge._id, {
      elevenlabs,
      people,
      ...(args.clerkOrg ? { clerkOrg: args.clerkOrg } : {}),
      ...(args.clerkOrgError ? { lastError: args.clerkOrgError } : {}),
      updatedAt: Date.now(),
    });
  },
});

/** Removes a person's name and email from Fabric once their account is deleted. */
export const erasePersonProfile = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    // Idempotent, so a profile deleted before blanking existed gets blanked too.
    if (!user || user.platformRole === "superAdmin") return;
    await blankUserProfile(ctx, user);
  },
});

export const finishVendors = internalMutation({
  args: { purgeId: v.id("tenantPurges") },
  handler: async (ctx, args) => {
    const purge = await loadRunning(ctx, args.purgeId, "vendors");
    if (!purge) return;
    const failed = await ctx.db
      .query("tenantPurgeItems")
      .withIndex("by_clerkOrgId_and_purgeId_and_status", (q) =>
        q.eq("clerkOrgId", purge.clerkOrgId).eq("purgeId", purge._id).eq("status", "failed"),
      )
      .first();
    if (failed || purge.clerkOrg === "failed") {
      await ctx.db.patch(purge._id, {
        status: "needsRetry",
        lastError:
          purge.clerkOrg === "failed"
            ? (purge.lastError ?? "The Clerk organization could not be deleted.")
            : `Some deletions outside Fabric failed (${failed?.error ?? "see items"}).`,
        updatedAt: Date.now(),
      });
      return;
    }
    await ctx.db.patch(purge._id, { phase: "verify", updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.workspacePurge.verifyStep, args);
  },
});

function message(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

async function deleteClerkOrg(clerkOrgId: string): Promise<{ result: "deleted" | "alreadyGone" | "failed"; error?: string }> {
  try {
    assertClerkId(clerkOrgId, "org");
    await clerkFetch(`/organizations/${clerkOrgId}`, { method: "DELETE" });
    return { result: "deleted" };
  } catch (error) {
    if (error instanceof ClerkApiError && error.status === 404) return { result: "alreadyGone" };
    return { result: "failed", error: `Clerk organization: ${message(error)}` };
  }
}

export async function deleteElevenLabsConversation(id: string) {
  // The agent is shared with production, so only production deletes there.
  if (env.USAGE_DEPLOYMENT_LABEL !== "prod") {
    return { status: "skipped" as const, outcome: "skipped" };
  }
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { status: "failed" as const, outcome: "failed", error: "ELEVENLABS_API_KEY is not set" };
  if (!isElevenLabsConversationId(id)) {
    return { status: "failed" as const, outcome: "failed", error: "Invalid ElevenLabs id" };
  }
  try {
    const response = await fetch(buildElevenLabsConversationUrl(id), {
      method: "DELETE",
      headers: { "xi-api-key": apiKey },
    });
    if (response.ok) return { status: "done" as const, outcome: "deleted" };
    if (response.status === 404) return { status: "done" as const, outcome: "alreadyGone" };
    return { status: "failed" as const, outcome: "failed", error: `ElevenLabs returned ${response.status}` };
  } catch (error) {
    return { status: "failed" as const, outcome: "failed", error: message(error) };
  }
}

export async function erasePerson(ctx: ActionCtx, userId: string, clerkOrgId: string) {
  const verdict: PersonVerdict = await ctx.runQuery(internal.workspacePurge.personVerdictInternal, {
    userId,
    clerkOrgId,
  });
  if (verdict.kind === "alreadyErased") {
    await ctx.runMutation(internal.workspacePurge.erasePersonProfile, { userId: userId as Id<"users"> }).catch(
      () => undefined,
    );
  }
  if (verdict.kind !== "erase") return { status: "skipped" as const, outcome: verdict.kind };
  try {
    if (verdict.clerkUserId) {
      // Clerk is the source of truth for membership: someone in another
      // organization (one Fabric may not know of) keeps their account.
      const memberships = (await clerkFetch(`/users/${verdict.clerkUserId}/organization_memberships`, {
        query: { limit: "100" },
      }).catch((error: unknown) => {
        if (error instanceof ClerkApiError && error.status === 404) return { data: [] };
        throw error;
      })) as { data?: { organization?: { id?: string } }[] } | null;
      const elsewhere = (memberships?.data ?? []).some(
        (m) => m.organization?.id !== undefined && m.organization.id !== clerkOrgId,
      );
      if (elsewhere) return { status: "skipped" as const, outcome: "keptOtherWorkspace" };
      try {
        await clerkFetch(`/users/${verdict.clerkUserId}`, { method: "DELETE" });
      } catch (error) {
        if (!(error instanceof ClerkApiError && error.status === 404)) throw error;
      }
    }
    await ctx.runMutation(internal.workspacePurge.erasePersonProfile, { userId: userId as Id<"users"> });
    return { status: "done" as const, outcome: "erased" };
  } catch (error) {
    return { status: "failed" as const, outcome: "failed", error: `Person ${userId}: ${message(error)}` };
  }
}

export const vendorStep = internalAction({
  args: { purgeId: v.id("tenantPurges") },
  handler: async (ctx, args): Promise<void> => {
    const state: {
      clerkOrgId: string;
      clerkOrg: Doc<"tenantPurges">["clerkOrg"];
      items: Doc<"tenantPurgeItems">[];
    } | null = await ctx.runQuery(internal.workspacePurge.vendorStateInternal, args);
    if (!state) return;

    // The org first: it ends every remaining Clerk membership and invitation.
    let clerkOrg: { result: "deleted" | "alreadyGone" | "failed"; error?: string } | undefined;
    if (state.clerkOrg === "pending") clerkOrg = await deleteClerkOrg(state.clerkOrgId);

    const results = [];
    for (const item of state.items) {
      const result =
        item.kind === "elevenlabsConversation"
          ? await deleteElevenLabsConversation(item.externalId)
          : await erasePerson(ctx, item.externalId, state.clerkOrgId);
      results.push({ itemId: item._id, ...result });
    }
    await ctx.runMutation(internal.workspacePurge.recordVendorResults, {
      purgeId: args.purgeId,
      ...(clerkOrg ? { clerkOrg: clerkOrg.result, clerkOrgError: clerkOrg.error } : {}),
      items: results,
    });
    if (state.items.length === VENDOR_BATCH) {
      await ctx.scheduler.runAfter(0, internal.workspacePurge.vendorStep, args);
    } else {
      await ctx.runMutation(internal.workspacePurge.finishVendors, args);
    }
  },
});

// ---- Verify and finish ----------------------------------------------------------------

export const verifyStep = internalMutation({
  args: { purgeId: v.id("tenantPurges") },
  handler: async (ctx, args) => {
    const purge = await loadRunning(ctx, args.purgeId, "verify");
    if (!purge) return;
    const now = Date.now();
    const remaining: string[] = [];
    for (const { table, entry } of purgeTables()) {
      if (await orgRows(ctx, table, entry, purge.clerkOrgId).first()) remaining.push(table);
    }

    if (remaining.length > 0) {
      // A background job that was mid-flight at suspension wrote after the
      // sweep. Give it time to finish, then sweep again.
      if (purge.sweepRound < MAX_SWEEP_ROUNDS) {
        await ctx.db.patch(purge._id, {
          phase: "tables",
          tableIndex: 0,
          cursor: null,
          sweepRound: purge.sweepRound + 1,
          updatedAt: now,
        });
        await ctx.scheduler.runAfter(SWEEP_RETRY_MS, internal.workspacePurge.tableStep, args);
        return;
      }
      await ctx.db.patch(purge._id, {
        status: "needsRetry",
        lastError: `Rows kept reappearing in: ${remaining.join(", ")}`,
        updatedAt: now,
      });
      return;
    }

    await ctx.db.patch(purge._id, {
      status: "complete",
      phase: "done",
      lastError: undefined,
      completedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(purge.tenantId, { status: "purged", updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.workspacePurge.deleteItems, args);
  },
});

/** The work list holds vendor ids; once the certificate is written it goes. */
export const deleteItems = internalMutation({
  args: { purgeId: v.id("tenantPurges") },
  handler: async (ctx, args) => {
    const purge = await ctx.db.get(args.purgeId);
    if (!purge || purge.status !== "complete") return;
    const items = await ctx.db
      .query("tenantPurgeItems")
      .withIndex("by_clerkOrgId_and_purgeId_and_status", (q) =>
        q.eq("clerkOrgId", purge.clerkOrgId).eq("purgeId", purge._id),
      )
      .take(200);
    for (const item of items) await ctx.db.delete(item._id);
    if (items.length === 200) await ctx.scheduler.runAfter(0, internal.workspacePurge.deleteItems, args);
  },
});

// ---- Console ------------------------------------------------------------------------

/** Re-runs what failed: vendor deletions, or a sweep that kept finding rows. */
export const retryPurge = mutation({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) throw userError("NOT_FOUND", "That workspace doesn't exist.");
    const purge = await ctx.db
      .query("tenantPurges")
      .withIndex("by_clerkOrgId_and_startedAt", (q) => q.eq("clerkOrgId", tenant.clerkOrgId))
      .order("desc")
      .first();
    if (!purge || purge.status !== "needsRetry") {
      throw userError("NOTHING_TO_RETRY", "There's nothing to retry.");
    }
    const failed = await ctx.db
      .query("tenantPurgeItems")
      .withIndex("by_clerkOrgId_and_purgeId_and_status", (q) =>
        q.eq("clerkOrgId", purge.clerkOrgId).eq("purgeId", purge._id).eq("status", "failed"),
      )
      .take(1000);
    for (const item of failed) {
      await ctx.db.patch(item._id, { status: "pending", error: undefined, outcome: undefined });
    }
    const elevenlabsFailed = failed.filter((i) => i.kind === "elevenlabsConversation").length;
    const peopleFailed = failed.length - elevenlabsFailed;
    const vendorsPending = failed.length > 0 || purge.clerkOrg === "failed";
    const phase = vendorsPending ? ("vendors" as const) : ("tables" as const);
    await ctx.db.patch(purge._id, {
      status: "running",
      phase,
      lastError: undefined,
      clerkOrg: purge.clerkOrg === "failed" ? "pending" : purge.clerkOrg,
      elevenlabs: { ...purge.elevenlabs, failed: Math.max(0, purge.elevenlabs.failed - elevenlabsFailed) },
      people: { ...purge.people, failed: Math.max(0, purge.people.failed - peopleFailed) },
      ...(phase === "tables" ? { tableIndex: 0, cursor: null, sweepRound: 0 } : {}),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      phase === "vendors" ? internal.workspacePurge.vendorStep : internal.workspacePurge.tableStep,
      { purgeId: purge._id },
    );
    return null;
  },
});

/** The latest purge of a workspace: progress while running, the certificate after. */
export const getPurge = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) return null;
    const purge = await ctx.db
      .query("tenantPurges")
      .withIndex("by_clerkOrgId_and_startedAt", (q) => q.eq("clerkOrgId", tenant.clerkOrgId))
      .order("desc")
      .first();
    if (!purge) return null;
    const rowsDeleted = Object.values(purge.rowsDeleted).reduce((sum, n) => sum + n, 0);
    return {
      status: purge.status,
      phase: purge.phase,
      trigger: purge.trigger,
      requestedByName: purge.requestedByName ?? null,
      startedAt: purge.startedAt,
      completedAt: purge.completedAt ?? null,
      rowsDeleted,
      rowsByTable: purge.rowsDeleted,
      filesDeleted: purge.filesDeleted,
      usageRowsScrubbed: purge.usageRowsScrubbed,
      elevenlabs: purge.elevenlabs,
      clerkOrg: purge.clerkOrg,
      people: purge.people,
      sweepRound: purge.sweepRound,
      lastError: purge.lastError ?? null,
      stale: purge.status === "running" && Date.now() - purge.updatedAt > STALE_MS,
    };
  },
});

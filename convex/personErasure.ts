import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { requireSuperAdmin } from "./lib/orgAuth";
import { userError } from "./lib/userError";
import { FORMER_MEMBER } from "./lib/profileErasure";
import { TENANT_DATA } from "./lib/tenantData";
import { isClosedStatus } from "./lib/workspaceStatus";
import { invalidateProcessAfterEvidenceLeft } from "./lib/processEvidenceInvalidation";
import { purgeAskFabricForMember, clearCitedTextFor } from "./askLifecycle";
import {
  assertClerkId,
  ClerkApiError,
  clerkFetch,
  clerkUserIdFromTokenIdentifier,
} from "./lib/clerkApi";
import { deleteElevenLabsConversation, erasePerson } from "./workspacePurge";

// ---------------------------------------------------------------------------
// Erasing one person from a workspace, phase 4 (docs/client-offboarding-plan.md).
// Platform staff only (D1/D8); a client asks by emailing hi@bizgroup.ae.
//
//   membership     – they lose access at once; then their Clerk membership in
//                    the org is removed
//   contributions  – interviews they gave (as subject, or recorded themselves)
//                    are deleted with their audio; interviews they recorded for
//                    someone else stay, without their name
//   records        – every other row that names them is scrubbed or deleted, per
//                    ERASURE in lib/tenantData.ts (one handler per scan table)
//   reprocess      – D7: each process that lost an interview has its overview
//                    and process map cleared, and rebuilt if any interviews remain
//   vendors        – their ElevenLabs conversations (production only: the agent
//                    is shared with dev), then their account if they're in no
//                    other workspace (D5)
//
// AskFabric content goes at the start, through the member-removal purge.
// ---------------------------------------------------------------------------

const BATCH = 25;
const SCAN_BATCH = 200;
const STALE_MS = 15 * 60 * 1000;


type Erasure = Doc<"personErasures">;

// ---- Starting -----------------------------------------------------------------

async function eraseTarget(ctx: QueryCtx | MutationCtx, membershipId: Id<"memberships">, tenantId: Id<"tenants">) {
  const tenant = await ctx.db.get(tenantId);
  if (!tenant) throw userError("NOT_FOUND", "That workspace doesn't exist.");
  const membership = await ctx.db.get(membershipId);
  if (!membership || membership.clerkOrgId !== tenant.clerkOrgId) {
    throw userError("NOT_FOUND", "That person isn't a member of this workspace.");
  }
  const user = await ctx.db.get(membership.userId);
  if (!user) throw userError("NOT_FOUND", "That person's profile is missing.");
  return { tenant, membership, user };
}

/** What erasing someone would do, for the confirmation dialog. */
export const preview = query({
  args: { tenantId: v.id("tenants"), membershipId: v.id("memberships") },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const { tenant, membership, user } = await eraseTarget(ctx, args.membershipId, args.tenantId);
    const asSubject = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_subjectUserId", (q) =>
        q.eq("clerkOrgId", tenant.clerkOrgId).eq("subjectUserId", user._id),
      )
      .take(2000);
    const submitted = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_userId", (q) =>
        q.eq("clerkOrgId", tenant.clerkOrgId).eq("userId", user._id),
      )
      .take(2000);
    const own = submitted.filter((c) => c.subjectUserId === undefined || c.subjectUserId === user._id);
    const deleted = new Set([...asSubject, ...own].map((c) => c._id));
    const others = await ctx.db
      .query("memberships")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .take(100);
    return {
      name: membership.name ?? user.name,
      email: membership.email ?? user.email,
      isStaff: user.platformRole === "superAdmin",
      contributionsDeleted: deleted.size,
      contributionsDenamed: submitted.length - own.length,
      otherWorkspaces: others.filter((m) => m.clerkOrgId !== tenant.clerkOrgId).length,
    };
  },
});

export const eraseMember = mutation({
  args: {
    tenantId: v.id("tenants"),
    membershipId: v.id("memberships"),
    confirmEmail: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"personErasures">> => {
    const actor = await requireSuperAdmin(ctx);
    const { tenant, membership, user } = await eraseTarget(ctx, args.membershipId, args.tenantId);
    if (tenant.status === "purging" || tenant.status === "purged") {
      throw userError("PURGED", "This workspace's data is already being deleted.");
    }
    if (user.platformRole === "superAdmin") {
      throw userError("STAFF", "Biz Group staff can't be erased from a client workspace.");
    }
    const email = (membership.email ?? user.email).trim().toLowerCase();
    if (!email || args.confirmEmail.trim().toLowerCase() !== email) {
      throw userError("CONFIRMATION_MISMATCH", `Type ${email || "their email"} to confirm.`);
    }
    const running = await ctx.db
      .query("personErasures")
      .withIndex("by_clerkOrgId_and_startedAt", (q) => q.eq("clerkOrgId", tenant.clerkOrgId))
      .order("desc")
      .take(50);
    if (running.some((e) => e.userId === user._id && e.status !== "complete")) {
      throw userError("ERASURE_RUNNING", "This person is already being erased.");
    }

    const now = Date.now();
    // Access ends now: a tombstoned membership fails every check, and
    // automatic provisioning never revives it.
    await ctx.db.patch(membership._id, { status: "removed", removedAt: now, updatedAt: now });
    await purgeAskFabricForMember(ctx, tenant.clerkOrgId, user._id);
    await ctx.db.insert("authAuditEvents", {
      clerkOrgId: tenant.clerkOrgId,
      actorUserId: actor._id,
      action: "memberRemoved",
      detail: "A member was erased at the client's request.",
      createdAt: now,
    });

    const erasureId = await ctx.db.insert("personErasures", {
      clerkOrgId: tenant.clerkOrgId,
      tenantId: tenant._id,
      userId: user._id,
      membershipId: membership._id,
      emailLower: email,
      name: membership.name ?? user.name,
      requestedByUserId: actor._id,
      requestedByName: actor.name || "A platform admin",
      status: "running",
      phase: "membership",
      step: 0,
      cursor: null,
      clerkMembership: "pending",
      account: "pending",
      counts: {
        contributionsDeleted: 0,
        contributionsDenamed: 0,
        recordsUpdated: 0,
        recordsDeleted: 0,
        filesDeleted: 0,
        processesRebuilt: 0,
        processesCleared: 0,
        elevenlabsDeleted: 0,
        elevenlabsSkipped: 0,
        elevenlabsFailed: 0,
      },
      startedAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.personErasure.membershipStep, { erasureId });
    return erasureId;
  },
});

async function loadRunning(ctx: MutationCtx, erasureId: Id<"personErasures">, phase: Erasure["phase"]) {
  const erasure = await ctx.db.get(erasureId);
  return erasure && erasure.status === "running" && erasure.phase === phase ? erasure : null;
}

function bump(erasure: Erasure, delta: Partial<Erasure["counts"]>): Erasure["counts"] {
  const counts = { ...erasure.counts };
  for (const [key, value] of Object.entries(delta) as [keyof Erasure["counts"], number][]) {
    counts[key] += value;
  }
  return counts;
}

// ---- Membership ---------------------------------------------------------------------

export const membershipState = internalQuery({
  args: { erasureId: v.id("personErasures") },
  handler: async (ctx, args) => {
    const erasure = await ctx.db.get(args.erasureId);
    if (!erasure || erasure.status !== "running" || erasure.phase !== "membership") return null;
    const user = await ctx.db.get(erasure.userId);
    return {
      clerkOrgId: erasure.clerkOrgId,
      clerkUserId: user ? (user.clerkUserId ?? clerkUserIdFromTokenIdentifier(user.tokenIdentifier)) : null,
    };
  },
});

export const membershipStep = internalAction({
  args: { erasureId: v.id("personErasures") },
  handler: async (ctx, args): Promise<void> => {
    const state: { clerkOrgId: string; clerkUserId: string | null } | null = await ctx.runQuery(
      internal.personErasure.membershipState,
      args,
    );
    if (!state) return;
    let result: "removed" | "alreadyGone" | "failed" = "alreadyGone";
    let error: string | undefined;
    if (state.clerkUserId) {
      try {
        assertClerkId(state.clerkOrgId, "org");
        assertClerkId(state.clerkUserId, "user");
        await clerkFetch(`/organizations/${state.clerkOrgId}/memberships/${state.clerkUserId}`, {
          method: "DELETE",
        });
        result = "removed";
      } catch (err) {
        if (err instanceof ClerkApiError && err.status === 404) {
          result = "alreadyGone";
        } else {
          result = "failed";
          error = `Clerk membership: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
        }
      }
    }
    await ctx.runMutation(internal.personErasure.finishMembership, { ...args, result, error });
  },
});

export const finishMembership = internalMutation({
  args: {
    erasureId: v.id("personErasures"),
    result: v.union(v.literal("removed"), v.literal("alreadyGone"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const erasure = await loadRunning(ctx, args.erasureId, "membership");
    if (!erasure) return;
    if (args.result === "failed") {
      // Fabric access is already gone; only Clerk's side is left to retry.
      await ctx.db.patch(erasure._id, {
        clerkMembership: "failed",
        status: "needsRetry",
        lastError: args.error,
        updatedAt: Date.now(),
      });
      return;
    }
    if (erasure.membershipId) {
      const membership = await ctx.db.get(erasure.membershipId);
      if (membership) await ctx.db.delete(membership._id);
    }
    await ctx.scheduler.runAfter(0, internal.users.rebuildOrgMembershipStats, {
      clerkOrgId: erasure.clerkOrgId,
    });
    await ctx.db.patch(erasure._id, {
      clerkMembership: args.result,
      lastError: undefined,
      phase: "contributions",
      step: 0,
      cursor: null,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.personErasure.contributionsStep, { erasureId: erasure._id });
  },
});

// ---- Contributions --------------------------------------------------------------------

async function addItem(ctx: MutationCtx, erasure: Erasure, kind: Doc<"personErasureItems">["kind"], externalId: string) {
  const existing = await ctx.db
    .query("personErasureItems")
    .withIndex("by_erasureId_and_kind_and_externalId", (q) =>
      q.eq("erasureId", erasure._id).eq("kind", kind).eq("externalId", externalId),
    )
    .first();
  if (existing) return;
  await ctx.db.insert("personErasureItems", {
    clerkOrgId: erasure.clerkOrgId,
    erasureId: erasure._id,
    kind,
    externalId,
    status: "pending",
  });
}

async function deleteConversation(ctx: MutationCtx, erasure: Erasure, conv: Doc<"conversations">) {
  let files = 0;
  if (conv.audioStorageId) {
    try {
      await ctx.storage.delete(conv.audioStorageId);
      files = 1;
    } catch {
      // Already gone.
    }
  }
  if (conv.elevenlabsConversationId) {
    await addItem(ctx, erasure, "elevenlabsConversation", conv.elevenlabsConversationId);
  }
  if (conv.status === "done") await addItem(ctx, erasure, "process", conv.processId);
  const moves = await ctx.db
    .query("conversationMoves")
    .withIndex("by_clerkOrgId_and_conversationId_and_createdAt", (q) =>
      q.eq("clerkOrgId", erasure.clerkOrgId).eq("conversationId", conv._id),
    )
    .take(100);
  for (const move of moves) await ctx.db.delete(move._id);
  await ctx.db.delete(conv._id);
  await clearCitedTextFor(ctx, erasure.clerkOrgId, "conversation", conv._id);
  return files;
}

export const contributionsStep = internalMutation({
  args: { erasureId: v.id("personErasures") },
  handler: async (ctx, args) => {
    const erasure = await loadRunning(ctx, args.erasureId, "contributions");
    if (!erasure) return;
    const org = erasure.clerkOrgId;
    // Step 0: interviews about them. Step 1: interviews they submitted.
    const rows =
      erasure.step === 0
        ? await ctx.db
            .query("conversations")
            .withIndex("by_clerkOrgId_and_subjectUserId", (q) =>
              q.eq("clerkOrgId", org).eq("subjectUserId", erasure.userId),
            )
            .take(BATCH)
        : await ctx.db
            .query("conversations")
            .withIndex("by_clerkOrgId_and_userId", (q) => q.eq("clerkOrgId", org).eq("userId", erasure.userId))
            .take(BATCH);

    let deleted = 0;
    let denamed = 0;
    let files = 0;
    for (const conv of rows) {
      const theirs =
        conv.subjectUserId === erasure.userId ||
        (conv.userId === erasure.userId && conv.subjectUserId === undefined);
      if (theirs) {
        files += await deleteConversation(ctx, erasure, conv);
        deleted++;
      } else {
        // Recorded on someone else's behalf: the interview is the subject's.
        // `userId` is cleared, which also takes it out of this index.
        await ctx.db.patch(conv._id, { userId: undefined, submittedByName: FORMER_MEMBER });
        denamed++;
      }
    }
    const done = rows.length < BATCH;
    await ctx.db.patch(erasure._id, {
      counts: bump(erasure, { contributionsDeleted: deleted, contributionsDenamed: denamed, filesDeleted: files }),
      ...(done && erasure.step === 1
        ? { phase: "records" as const, step: 0, cursor: null }
        : done
          ? { step: 1 }
          : {}),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      done && erasure.step === 1 ? internal.personErasure.recordsStep : internal.personErasure.contributionsStep,
      args,
    );
  },
});

// ---- Records ---------------------------------------------------------------------------

type Outcome = "unchanged" | "updated" | "deleted";
type Who = { userId: Id<"users">; emailLower: string | null; name: string | null };
type Handler = (ctx: MutationCtx, row: Record<string, unknown> & { _id: Id<TableNames> }, who: Who) => Promise<Outcome>;

async function patchRow(ctx: MutationCtx, id: Id<TableNames>, fields: Record<string, unknown>): Promise<Outcome> {
  await ctx.db.patch(id, fields as never);
  return "updated";
}

/**
 * One handler per table ERASURE marks "scan" (the registry test checks the
 * two lists match). Each gets every row of the org and changes only those
 * about the person.
 */
export const SCAN_HANDLERS: Partial<Record<TableNames, Handler>> = {
  orgThemes: async (ctx, row, who) =>
    row.approvedByUserId === who.userId ? patchRow(ctx, row._id, { approvedByUserId: undefined }) : "unchanged",

  memberships: async (ctx, row, who) =>
    row.invitedBy === who.userId ? patchRow(ctx, row._id, { invitedBy: undefined }) : "unchanged",

  membershipIntents: async (ctx, row, who) => {
    if (row.acceptedUserId === who.userId || (who.emailLower !== null && row.emailLower === who.emailLower)) {
      await ctx.db.delete(row._id);
      return "deleted";
    }
    return row.invitedBy === who.userId ? patchRow(ctx, row._id, { invitedBy: undefined }) : "unchanged";
  },

  authAuditEvents: async (ctx, row, who) => {
    const about =
      row.actorUserId === who.userId ||
      row.targetUserId === who.userId ||
      (who.emailLower !== null && row.targetEmailLower === who.emailLower);
    if (!about) return "unchanged";
    return patchRow(ctx, row._id, {
      ...(row.actorUserId === who.userId ? { actorUserId: undefined } : {}),
      ...(row.targetUserId === who.userId ? { targetUserId: undefined, targetEmailLower: undefined } : {}),
      ...(who.emailLower !== null && row.targetEmailLower === who.emailLower ? { targetEmailLower: undefined } : {}),
      // Details are free text and may name them.
      detail: undefined,
    });
  },

  // Someone else's recording in which they spoke: they stop being named;
  // the words stay, as the recording is the other contributor's.
  conversations: async (ctx, row, who) => {
    const labels = (row.speakerLabels as Doc<"conversations">["speakerLabels"]) ?? [];
    const theirs = new Set(labels.filter((l) => l.userId === who.userId).map((l) => l.speakerId));
    if (theirs.size === 0) return "unchanged";
    const transcript = (row.transcript as Doc<"conversations">["transcript"]) ?? [];
    return patchRow(ctx, row._id, {
      speakerLabels: labels.map((l) => (theirs.has(l.speakerId) ? { speakerId: l.speakerId, displayName: FORMER_MEMBER } : l)),
      transcript: transcript.map((m) =>
        m.speakerId && theirs.has(m.speakerId) && m.speakerName ? { ...m, speakerName: FORMER_MEMBER } : m,
      ),
    });
  },

  conversationMoves: async (ctx, row, who) =>
    row.actorUserId === who.userId ? patchRow(ctx, row._id, { actorName: FORMER_MEMBER }) : "unchanged",

  conversationDeletions: async (ctx, row, who) => {
    const actor = row.actorUserId === who.userId;
    const named = who.name !== null && row.contributorName === who.name;
    if (!actor && !named) return "unchanged";
    return patchRow(ctx, row._id, {
      ...(actor ? { actorName: FORMER_MEMBER } : {}),
      ...(named ? { contributorName: FORMER_MEMBER } : {}),
    });
  },

  voiceUploadGrants: async (ctx, row, who) => {
    if (row.userId !== who.userId) return "unchanged";
    await ctx.db.delete(row._id);
    return "deleted";
  },

  // The decision stays (it's the workspace's), without their note.
  recommendationDecisions: async (ctx, row, who) =>
    row.actorUserId === who.userId && row.note !== undefined ? patchRow(ctx, row._id, { note: undefined }) : "unchanged",

  recommendationReviews: async (ctx, row, who) => {
    if (row.reviewerUserId !== who.userId) return "unchanged";
    await ctx.db.delete(row._id);
    return "deleted";
  },

  summaryRuns: async (ctx, row, who) =>
    row.actorUserId === who.userId ? patchRow(ctx, row._id, { actorUserId: undefined }) : "unchanged",

  aiUsageEvents: async (ctx, row, who) =>
    row.actorUserId === who.userId
      ? patchRow(ctx, row._id, { actorUserId: undefined, actorName: undefined })
      : "unchanged",
};

type ScanQuery = {
  withIndex(
    index: string,
    range: (q: { eq(field: "clerkOrgId", value: string): unknown }) => unknown,
  ): {
    paginate(opts: { numItems: number; cursor: string | null }): Promise<{
      page: (Record<string, unknown> & { _id: Id<TableNames> })[];
      continueCursor: string;
      isDone: boolean;
    }>;
  };
};

export function scanTables(): TableNames[] {
  return Object.keys(SCAN_HANDLERS) as TableNames[];
}

export const recordsStep = internalMutation({
  args: { erasureId: v.id("personErasures") },
  handler: async (ctx, args) => {
    const erasure = await loadRunning(ctx, args.erasureId, "records");
    if (!erasure) return;
    const tables = scanTables();
    if (erasure.step >= tables.length) {
      await ctx.db.patch(erasure._id, { phase: "reprocess", step: 0, cursor: null, updatedAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.personErasure.reprocessStep, args);
      return;
    }
    const table = tables[erasure.step];
    const entry = TENANT_DATA[table];
    if (entry.scope !== "org") throw new Error(`${table} is not org-scoped`);
    const page = await (ctx.db.query(table) as unknown as ScanQuery)
      .withIndex(entry.orgIndex, (q) => q.eq("clerkOrgId", erasure.clerkOrgId))
      .paginate({ numItems: SCAN_BATCH, cursor: erasure.cursor });
    const who: Who = { userId: erasure.userId, emailLower: erasure.emailLower ?? null, name: erasure.name ?? null };
    let updated = 0;
    let deleted = 0;
    for (const row of page.page) {
      const outcome = await SCAN_HANDLERS[table]!(ctx, row, who);
      if (outcome === "updated") updated++;
      if (outcome === "deleted") deleted++;
    }
    await ctx.db.patch(erasure._id, {
      counts: bump(erasure, { recordsUpdated: updated, recordsDeleted: deleted }),
      ...(page.isDone ? { step: erasure.step + 1, cursor: null } : { cursor: page.continueCursor }),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.personErasure.recordsStep, args);
  },
});

// ---- Reprocess (D7) ------------------------------------------------------------------------

export const reprocessStep = internalMutation({
  args: { erasureId: v.id("personErasures") },
  handler: async (ctx, args) => {
    const erasure = await loadRunning(ctx, args.erasureId, "reprocess");
    if (!erasure) return;
    const items = await ctx.db
      .query("personErasureItems")
      .withIndex("by_clerkOrgId_and_erasureId_and_kind_and_status", (q) =>
        q.eq("clerkOrgId", erasure.clerkOrgId).eq("erasureId", erasure._id).eq("kind", "process").eq("status", "pending"),
      )
      .take(5);
    const tenant = await ctx.db.get(erasure.tenantId);
    // A closed workspace is on its way to deletion: clear, don't spend on a rebuild.
    const rebuild = tenant !== null && !isClosedStatus(tenant.status);
    let rebuilt = 0;
    let cleared = 0;
    for (const item of items) {
      const processId = ctx.db.normalizeId("processes", item.externalId);
      const process = processId ? await ctx.db.get(processId) : null;
      if (!process || process.clerkOrgId !== erasure.clerkOrgId) {
        await ctx.db.patch(item._id, { status: "skipped", outcome: "processGone" });
        continue;
      }
      // Clears everything when no interviews remain; otherwise marks the
      // department and function overviews stale.
      await invalidateProcessAfterEvidenceLeft(ctx, erasure.clerkOrgId, process._id);
      const remaining = await ctx.db
        .query("conversations")
        .withIndex("by_clerkOrgId_and_processId_and_status", (q) =>
          q.eq("clerkOrgId", erasure.clerkOrgId).eq("processId", process._id).eq("status", "done"),
        )
        .first();
      if (remaining) {
        // D7: what was built partly from their interviews doesn't stay on show.
        const fresh = await ctx.db.get(process._id);
        if (fresh) {
          await ctx.db.patch(process._id, {
            rollingSummary: undefined,
            summaryV2: undefined,
            summaryUpdatedAt: undefined,
            summaryEvidenceRevision: (fresh.summaryEvidenceRevision ?? 0) + 1,
            ...(fresh.summaryV2GenerationId ? { summaryRegenRequestedAgain: true } : {}),
          });
        }
        await ctx.runMutation(internal.processFlows.deleteForProcess, {
          processId: process._id,
          clerkOrgId: erasure.clerkOrgId,
        });
        if (rebuild) {
          await ctx.scheduler.runAfter(0, internal.summaryEvidence.requestProcessSummaryRebuild, {
            processId: process._id,
            clerkOrgId: erasure.clerkOrgId,
          });
          await ctx.scheduler.runAfter(0, internal.processFlows.requestFlowGeneration, {
            processId: process._id,
            clerkOrgId: erasure.clerkOrgId,
          });
          rebuilt++;
        } else {
          cleared++;
        }
      } else {
        cleared++;
      }
      await ctx.db.patch(item._id, { status: "done", outcome: remaining && rebuild ? "rebuilt" : "cleared" });
    }
    const done = items.length < 5;
    await ctx.db.patch(erasure._id, {
      counts: bump(erasure, { processesRebuilt: rebuilt, processesCleared: cleared }),
      ...(done ? { phase: "vendors" as const } : {}),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      done ? internal.personErasure.vendorStep : internal.personErasure.reprocessStep,
      args,
    );
  },
});

// ---- Vendors -----------------------------------------------------------------------------

export const vendorState = internalQuery({
  args: { erasureId: v.id("personErasures") },
  handler: async (ctx, args) => {
    const erasure = await ctx.db.get(args.erasureId);
    if (!erasure || erasure.status !== "running" || erasure.phase !== "vendors") return null;
    const items = await ctx.db
      .query("personErasureItems")
      .withIndex("by_clerkOrgId_and_erasureId_and_kind_and_status", (q) =>
        q
          .eq("clerkOrgId", erasure.clerkOrgId)
          .eq("erasureId", erasure._id)
          .eq("kind", "elevenlabsConversation")
          .eq("status", "pending"),
      )
      .take(BATCH);
    return { clerkOrgId: erasure.clerkOrgId, userId: erasure.userId, account: erasure.account, items };
  },
});

export const recordVendorResults = internalMutation({
  args: {
    erasureId: v.id("personErasures"),
    items: v.array(
      v.object({
        itemId: v.id("personErasureItems"),
        status: v.union(v.literal("done"), v.literal("skipped"), v.literal("failed")),
        outcome: v.string(),
        error: v.optional(v.string()),
      }),
    ),
    account: v.optional(
      v.union(
        v.literal("erased"),
        v.literal("keptOtherWorkspace"),
        v.literal("keptStaff"),
        v.literal("alreadyErased"),
        v.literal("failed"),
      ),
    ),
    accountError: v.optional(v.string()),
    finished: v.boolean(),
  },
  handler: async (ctx, args) => {
    const erasure = await loadRunning(ctx, args.erasureId, "vendors");
    if (!erasure) return;
    let deleted = 0;
    let skipped = 0;
    let failed = 0;
    let firstError: string | undefined;
    for (const result of args.items) {
      const item = await ctx.db.get(result.itemId);
      if (!item || item.erasureId !== erasure._id || item.status !== "pending") continue;
      await ctx.db.patch(item._id, { status: result.status, outcome: result.outcome, error: result.error });
      if (result.status === "done") deleted++;
      else if (result.status === "skipped") skipped++;
      else {
        failed++;
        firstError ??= result.error;
      }
    }
    const counts = bump(erasure, { elevenlabsDeleted: deleted, elevenlabsSkipped: skipped, elevenlabsFailed: failed });
    const account = args.account ?? erasure.account;
    if (!args.finished) {
      await ctx.db.patch(erasure._id, { counts, account, updatedAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.personErasure.vendorStep, { erasureId: erasure._id });
      return;
    }
    const anyFailed = await ctx.db
      .query("personErasureItems")
      .withIndex("by_clerkOrgId_and_erasureId_and_kind_and_status", (q) =>
        q
          .eq("clerkOrgId", erasure.clerkOrgId)
          .eq("erasureId", erasure._id)
          .eq("kind", "elevenlabsConversation")
          .eq("status", "failed"),
      )
      .first();
    const now = Date.now();
    if (anyFailed || account === "failed") {
      await ctx.db.patch(erasure._id, {
        counts,
        account,
        status: "needsRetry",
        lastError: args.accountError ?? firstError ?? anyFailed?.error ?? "A deletion outside Fabric failed.",
        updatedAt: now,
      });
      return;
    }
    // Done: the record keeps counts and an opaque id, nothing that names them.
    await ctx.db.patch(erasure._id, {
      counts,
      account,
      status: "complete",
      phase: "done",
      emailLower: undefined,
      name: undefined,
      lastError: undefined,
      completedAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.personErasure.deleteItems, { erasureId: erasure._id });
  },
});

export const vendorStep = internalAction({
  args: { erasureId: v.id("personErasures") },
  handler: async (ctx, args): Promise<void> => {
    const state: {
      clerkOrgId: string;
      userId: Id<"users">;
      account: Erasure["account"];
      items: Doc<"personErasureItems">[];
    } | null = await ctx.runQuery(internal.personErasure.vendorState, args);
    if (!state) return;
    const items = [];
    for (const item of state.items) {
      items.push({ itemId: item._id, ...(await deleteElevenLabsConversation(item.externalId)) });
    }
    const finished = state.items.length < BATCH;
    let account: Erasure["account"] | undefined;
    let accountError: string | undefined;
    if (finished && (state.account === "pending" || state.account === "failed")) {
      // D5, exactly as a workspace purge decides it.
      const result = await erasePerson(ctx, state.userId, state.clerkOrgId);
      account = result.outcome as Erasure["account"];
      accountError = "error" in result ? result.error : undefined;
    }
    await ctx.runMutation(internal.personErasure.recordVendorResults, {
      erasureId: args.erasureId,
      items,
      ...(account && account !== "pending" ? { account } : {}),
      ...(accountError ? { accountError } : {}),
      finished,
    });
  },
});

export const deleteItems = internalMutation({
  args: { erasureId: v.id("personErasures") },
  handler: async (ctx, args) => {
    const erasure = await ctx.db.get(args.erasureId);
    if (!erasure || erasure.status !== "complete") return;
    const items = await ctx.db
      .query("personErasureItems")
      .withIndex("by_clerkOrgId_and_erasureId_and_kind_and_status", (q) =>
        q.eq("clerkOrgId", erasure.clerkOrgId).eq("erasureId", erasure._id),
      )
      .take(200);
    for (const item of items) await ctx.db.delete(item._id);
    if (items.length === 200) await ctx.scheduler.runAfter(0, internal.personErasure.deleteItems, args);
  },
});

// ---- Console and upkeep -----------------------------------------------------------------------

export const retryErasure = mutation({
  args: { erasureId: v.id("personErasures") },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const erasure = await ctx.db.get(args.erasureId);
    if (!erasure || erasure.status !== "needsRetry") {
      throw userError("NOTHING_TO_RETRY", "There's nothing to retry.");
    }
    const now = Date.now();
    if (erasure.clerkMembership === "failed") {
      await ctx.db.patch(erasure._id, { status: "running", phase: "membership", clerkMembership: "pending", lastError: undefined, updatedAt: now });
      await ctx.scheduler.runAfter(0, internal.personErasure.membershipStep, args);
      return null;
    }
    const failed = await ctx.db
      .query("personErasureItems")
      .withIndex("by_clerkOrgId_and_erasureId_and_kind_and_status", (q) =>
        q
          .eq("clerkOrgId", erasure.clerkOrgId)
          .eq("erasureId", erasure._id)
          .eq("kind", "elevenlabsConversation")
          .eq("status", "failed"),
      )
      .take(1000);
    for (const item of failed) await ctx.db.patch(item._id, { status: "pending", error: undefined, outcome: undefined });
    await ctx.db.patch(erasure._id, {
      status: "running",
      phase: "vendors",
      lastError: undefined,
      counts: { ...erasure.counts, elevenlabsFailed: Math.max(0, erasure.counts.elevenlabsFailed - failed.length) },
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.personErasure.vendorStep, args);
    return null;
  },
});

/** Hourly, with the purge cron: resumes an erasure not heard from in 15 minutes. */
export const resumeStalled = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stalled = await ctx.db
      .query("personErasures")
      .withIndex("by_status_and_updatedAt", (q) => q.eq("status", "running").lt("updatedAt", now - STALE_MS))
      .take(20);
    for (const erasure of stalled) {
      await ctx.db.patch(erasure._id, { updatedAt: now });
      const next = {
        membership: internal.personErasure.membershipStep,
        contributions: internal.personErasure.contributionsStep,
        records: internal.personErasure.recordsStep,
        reprocess: internal.personErasure.reprocessStep,
        vendors: internal.personErasure.vendorStep,
        done: null,
      }[erasure.phase];
      if (next) await ctx.scheduler.runAfter(0, next, { erasureId: erasure._id });
    }
    return stalled.length;
  },
});

/** The workspace's recent erasures for the console. No names: those are gone. */
export const listErasures = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) return [];
    const rows = await ctx.db
      .query("personErasures")
      .withIndex("by_clerkOrgId_and_startedAt", (q) => q.eq("clerkOrgId", tenant.clerkOrgId))
      .order("desc")
      .take(10);
    return rows.map((row) => ({
      erasureId: row._id,
      status: row.status,
      phase: row.phase,
      requestedByName: row.requestedByName,
      startedAt: row.startedAt,
      completedAt: row.completedAt ?? null,
      counts: row.counts,
      account: row.account,
      lastError: row.lastError ?? null,
      stale: row.status === "running" && Date.now() - row.updatedAt > STALE_MS,
    }));
  },
});

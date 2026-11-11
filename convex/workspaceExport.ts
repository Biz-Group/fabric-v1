import { paginationOptsValidator, type PaginationResult } from "convex/server";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { requireSuperAdmin } from "./lib/orgAuth";
import { EXPORT_POLICY, TENANT_DATA } from "./lib/tenantData";
import { userError } from "./lib/userError";
import type {
  FlowNodeInput,
  InterviewInput,
  OverviewInput,
  ProcessDocInput,
} from "./lib/exportRender";
import type { SummaryArtifactV2 } from "./summaryV2";

// ---------------------------------------------------------------------------
// Workspace export, phase 2 (docs/client-offboarding-plan.md, D3).
//
// A platform admin starts an export from the tenants console. The build runs
// in the background in workspaceExportBuild.ts (Node, for memory): the audio
// pass zips recordings into parts of about 50 MB, then the data pass writes
// one zip of readable Markdown/CSV plus JSON. The files are offered in the
// console for 7 days and then deleted. AskFabric chats are never exported
// (Saish 2026-11-11; they are private to each member, D12).
// ---------------------------------------------------------------------------

export const EXPORT_LINK_DAYS = 7;
const EXPORT_LINK_MS = EXPORT_LINK_DAYS * 24 * 60 * 60 * 1000;
/** A running export not heard from in this long is treated as dead. */
export const EXPORT_STALE_MS = 30 * 60 * 1000;
/** Bytes a single page of table rows may read, well inside function limits. */
const PAGE_BYTES = 4 * 1024 * 1024;
const DELETE_BATCH = 100;

// ---- Console ---------------------------------------------------------------

export const startExport = mutation({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args): Promise<Id<"tenantExports">> => {
    const actor = await requireSuperAdmin(ctx);
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) throw userError("NOT_FOUND", "That workspace doesn't exist.");
    if (tenant.status === "purging" || tenant.status === "purged") {
      throw userError(
        "PURGED",
        "This workspace's data is being or has been deleted, so there's nothing to export.",
      );
    }

    const now = Date.now();
    const latest = await ctx.db
      .query("tenantExports")
      .withIndex("by_clerkOrgId_and_createdAt", (q) =>
        q.eq("clerkOrgId", tenant.clerkOrgId),
      )
      .order("desc")
      .first();
    if (latest?.status === "running") {
      if (now - latest.updatedAt < EXPORT_STALE_MS) {
        throw userError(
          "EXPORT_RUNNING",
          "An export of this workspace is already being prepared.",
        );
      }
      await ctx.db.patch(latest._id, {
        status: "failed",
        error: "Stopped responding; a new export was started.",
        updatedAt: now,
      });
    }

    const exportId = await ctx.db.insert("tenantExports", {
      clerkOrgId: tenant.clerkOrgId,
      tenantId: tenant._id,
      status: "running",
      phase: "audio",
      requestedByUserId: actor._id,
      requestedByName: actor.name || "A platform admin",
      audioCursor: null,
      audioIncluded: 0,
      audioMissing: 0,
      audioBytes: 0,
      partCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("authAuditEvents", {
      clerkOrgId: tenant.clerkOrgId,
      actorUserId: actor._id,
      action: "workspaceExported",
      detail: `Export ${exportId} started`,
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.workspaceExportBuild.buildAudioPart, {
      exportId,
    });
    return exportId;
  },
});

/** The workspace's recent exports, with download links while they last. */
export const listExports = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) return [];
    const exports = await ctx.db
      .query("tenantExports")
      .withIndex("by_clerkOrgId_and_createdAt", (q) =>
        q.eq("clerkOrgId", tenant.clerkOrgId),
      )
      .order("desc")
      .take(5);
    return await Promise.all(
      exports.map(async (row) => {
        const files =
          row.status === "ready"
            ? await ctx.db
                .query("tenantExportFiles")
                .withIndex("by_clerkOrgId_and_exportId", (q) =>
                  q.eq("clerkOrgId", tenant.clerkOrgId).eq("exportId", row._id),
                )
                .take(200)
            : [];
        return {
          exportId: row._id,
          status: row.status,
          phase: row.phase,
          requestedByName: row.requestedByName,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          completedAt: row.completedAt ?? null,
          expiresAt: row.expiresAt ?? null,
          audioIncluded: row.audioIncluded,
          audioMissing: row.audioMissing,
          partCount: row.partCount,
          error: row.error ?? null,
          stale:
            row.status === "running" && Date.now() - row.updatedAt > EXPORT_STALE_MS,
          files: await Promise.all(
            files
              // The data zip first: it holds the README.
              .sort((a, b) =>
                a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "data" ? -1 : 1,
              )
              .map(async (file) => ({
                name: file.name,
                kind: file.kind,
                sizeBytes: file.sizeBytes,
                url: await ctx.storage.getUrl(file.storageId),
              })),
          ),
        };
      }),
    );
  },
});

/** Deletes an export's files before the link would expire. */
export const discardExport = mutation({
  args: { exportId: v.id("tenantExports") },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const row = await ctx.db.get(args.exportId);
    if (!row || row.status === "expired") return null;
    await retireExport(ctx, row, row.status === "running" ? "failed" : "expired");
    return null;
  },
});

// ---- Build bookkeeping ----------------------------------------------------------

export const getExportInternal = internalQuery({
  args: { exportId: v.id("tenantExports") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.exportId);
    if (!row) return null;
    const tenant = await ctx.db.get(row.tenantId);
    return {
      ...row,
      workspaceName: tenant?.name ?? row.clerkOrgId,
      workspaceSlug: tenant?.slug ?? "workspace",
    };
  },
});

const audioEntryValidator = v.object({
  conversationId: v.id("conversations"),
  status: v.union(v.literal("included"), v.literal("missing")),
  path: v.optional(v.string()),
  sizeBytes: v.optional(v.number()),
  reason: v.optional(v.string()),
});

/**
 * Records one audio pass: its zip part (if any recording made it in), where
 * each recording went, and where the next pass resumes. Returns false when
 * the export was cancelled meanwhile, after discarding the part.
 */
export const recordAudioProgress = internalMutation({
  args: {
    exportId: v.id("tenantExports"),
    cursor: v.union(v.string(), v.null()),
    done: v.boolean(),
    part: v.optional(
      v.object({ name: v.string(), storageId: v.id("_storage"), sizeBytes: v.number() }),
    ),
    entries: v.array(audioEntryValidator),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const row = await ctx.db.get(args.exportId);
    if (!row || row.status !== "running" || row.phase !== "audio") {
      if (args.part) await ctx.storage.delete(args.part.storageId);
      return false;
    }
    const now = Date.now();
    if (args.part) {
      await ctx.db.insert("tenantExportFiles", {
        clerkOrgId: row.clerkOrgId,
        exportId: row._id,
        name: args.part.name,
        kind: "audio",
        storageId: args.part.storageId,
        sizeBytes: args.part.sizeBytes,
        createdAt: now,
      });
    }
    let included = 0;
    let bytes = 0;
    for (const entry of args.entries) {
      await ctx.db.insert("tenantExportAudioEntries", {
        clerkOrgId: row.clerkOrgId,
        exportId: row._id,
        ...entry,
        ...(entry.status === "included" && args.part ? { partName: args.part.name } : {}),
      });
      if (entry.status === "included") {
        included++;
        bytes += entry.sizeBytes ?? 0;
      }
    }
    await ctx.db.patch(row._id, {
      audioCursor: args.cursor,
      audioIncluded: row.audioIncluded + included,
      audioMissing: row.audioMissing + (args.entries.length - included),
      audioBytes: row.audioBytes + bytes,
      partCount: row.partCount + (args.part ? 1 : 0),
      phase: args.done ? "data" : "audio",
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      args.done
        ? internal.workspaceExportBuild.buildDataArchive
        : internal.workspaceExportBuild.buildAudioPart,
      { exportId: row._id },
    );
    return true;
  },
});

export const completeExport = internalMutation({
  args: {
    exportId: v.id("tenantExports"),
    file: v.object({ name: v.string(), storageId: v.id("_storage"), sizeBytes: v.number() }),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const row = await ctx.db.get(args.exportId);
    if (!row || row.status !== "running" || row.phase !== "data") {
      await ctx.storage.delete(args.file.storageId);
      return false;
    }
    const now = Date.now();
    await ctx.db.insert("tenantExportFiles", {
      clerkOrgId: row.clerkOrgId,
      exportId: row._id,
      name: args.file.name,
      kind: "data",
      storageId: args.file.storageId,
      sizeBytes: args.file.sizeBytes,
      createdAt: now,
    });
    const expiresAt = now + EXPORT_LINK_MS;
    await ctx.db.patch(row._id, {
      status: "ready",
      phase: "done",
      completedAt: now,
      expiresAt,
      updatedAt: now,
    });
    await ctx.scheduler.runAt(expiresAt, internal.workspaceExport.expireExport, {
      exportId: row._id,
    });
    return true;
  },
});

export const failExport = internalMutation({
  args: { exportId: v.id("tenantExports"), error: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.exportId);
    if (!row || row.status !== "running") return;
    await retireExport(ctx, row, "failed", args.error.slice(0, 500));
  },
});

/** Marks the export finished with and deletes its files, in batches. */
async function retireExport(
  ctx: MutationCtx,
  row: Doc<"tenantExports">,
  status: "failed" | "expired",
  error?: string,
) {
  await ctx.db.patch(row._id, {
    status,
    ...(error ? { error } : {}),
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.workspaceExport.deleteExportFiles, {
    exportId: row._id,
  });
}

export const expireExport = internalMutation({
  args: { exportId: v.id("tenantExports") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.exportId);
    if (!row || row.status !== "ready") return;
    await retireExport(ctx, row, "expired");
  },
});

export const deleteExportFiles = internalMutation({
  args: { exportId: v.id("tenantExports") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.exportId);
    if (!row || row.status === "running" || row.status === "ready") return;
    const files = await ctx.db
      .query("tenantExportFiles")
      .withIndex("by_clerkOrgId_and_exportId", (q) =>
        q.eq("clerkOrgId", row.clerkOrgId).eq("exportId", row._id),
      )
      .take(DELETE_BATCH);
    for (const file of files) {
      try {
        await ctx.storage.delete(file.storageId);
      } catch {
        // Already gone: the row is what's left to remove.
      }
      await ctx.db.delete(file._id);
    }
    const entries = await ctx.db
      .query("tenantExportAudioEntries")
      .withIndex("by_clerkOrgId_and_exportId", (q) =>
        q.eq("clerkOrgId", row.clerkOrgId).eq("exportId", row._id),
      )
      .take(DELETE_BATCH);
    for (const entry of entries) await ctx.db.delete(entry._id);
    if (files.length + entries.length > 0) {
      await ctx.scheduler.runAfter(0, internal.workspaceExport.deleteExportFiles, args);
    }
  },
});

// ---- Reads for the build --------------------------------------------------------

/** One recording to fetch, or why there is none. */
export type AudioCandidate = {
  conversationId: Id<"conversations">;
  processId: Id<"processes">;
  contributorName: string;
  createdAt: number;
  source:
    | { kind: "storage"; storageId: Id<"_storage">; mimeType: string }
    | { kind: "elevenlabs"; elevenlabsConversationId: string }
    | { kind: "none" };
};

export const audioCandidatesPage = internalQuery({
  args: { clerkOrgId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (
    ctx,
    args,
  ): Promise<{ page: AudioCandidate[]; continueCursor: string; isDone: boolean }> => {
    const result = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .paginate(args.paginationOpts);
    return {
      continueCursor: result.continueCursor,
      isDone: result.isDone,
      page: result.page.map((conv) => {
        const mode = conv.inputMode ?? "agent";
        const source: AudioCandidate["source"] =
          mode !== "agent" && conv.audioStorageId
            ? {
                kind: "storage",
                storageId: conv.audioStorageId,
                mimeType: conv.audioMimeType ?? "audio/webm",
              }
            : mode === "agent" && conv.elevenlabsConversationId
              ? { kind: "elevenlabs", elevenlabsConversationId: conv.elevenlabsConversationId }
              : { kind: "none" };
        return {
          conversationId: conv._id,
          processId: conv.processId,
          contributorName: conv.contributorName,
          createdAt: conv._creationTime,
          source,
        };
      }),
    };
  },
});

export type HierarchyRows = {
  functions: { id: string; name: string; overview: OverviewInput }[];
  departments: { id: string; name: string; functionId: string; overview: OverviewInput }[];
  processes: { id: string; name: string; departmentId: string }[];
};

/** The org's tree: names for paths, plus function and department overviews. */
export const hierarchyInternal = internalQuery({
  args: { clerkOrgId: v.string() },
  handler: async (ctx, args): Promise<HierarchyRows> => {
    const functions = await ctx.db
      .query("functions")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .take(1000);
    const departments = await ctx.db
      .query("departments")
      .withIndex("by_clerkOrgId_and_functionId", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .take(2000);
    const processes = await ctx.db
      .query("processes")
      .withIndex("by_clerkOrgId_and_departmentId", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .take(5000);
    const overview = (row: Doc<"functions"> | Doc<"departments">): OverviewInput => ({
      name: row.name,
      summaryV2: (row.summaryV2 as SummaryArtifactV2 | undefined) ?? null,
      legacySummary: row.summary ?? null,
      updatedAt: row.summaryUpdatedAt ?? null,
    });
    return {
      functions: functions.map((f) => ({ id: f._id, name: f.name, overview: overview(f) })),
      departments: departments.map((d) => ({
        id: d._id,
        name: d.name,
        functionId: d.functionId,
        overview: overview(d),
      })),
      processes: processes.map((p) => ({ id: p._id, name: p.name, departmentId: p.departmentId })),
    };
  },
});

/** Interview fields for the Markdown files, a few at a time. */
export const interviewsPage = internalQuery({
  args: { clerkOrgId: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ page: InterviewInput[]; continueCursor: string; isDone: boolean }> => {
    const result = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .paginate({ numItems: 100, cursor: args.cursor, maximumBytesRead: PAGE_BYTES });
    return {
      continueCursor: result.continueCursor,
      isDone: result.isDone,
      page: result.page.map((conv) => ({
        conversationId: conv._id,
        processId: conv.processId,
        createdAt: conv._creationTime,
        title: conv.title ?? null,
        contributorName: conv.contributorName,
        submittedByName: conv.submittedByName ?? null,
        inputMode: conv.inputMode ?? "agent",
        status: conv.status,
        durationSeconds: conv.durationSeconds ?? null,
        summary: conv.summary ?? null,
        transcript: conv.transcript ?? [],
        speakerLabels: (conv.speakerLabels ?? []).map((l) => ({
          speakerId: l.speakerId,
          displayName: l.displayName,
        })),
      })),
    };
  },
});

/** Everything one process's Markdown file shows, a few processes at a time. */
export const processDocsPage = internalQuery({
  args: { clerkOrgId: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ page: ProcessDocInput[]; continueCursor: string; isDone: boolean }> => {
    const result = await ctx.db
      .query("processes")
      .withIndex("by_clerkOrgId_and_departmentId", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .paginate({ numItems: 5, cursor: args.cursor, maximumBytesRead: PAGE_BYTES });

    const page: ProcessDocInput[] = [];
    for (const process of result.page) {
      const interviews = await ctx.db
        .query("conversations")
        .withIndex("by_clerkOrgId_and_processId", (q) =>
          q.eq("clerkOrgId", args.clerkOrgId).eq("processId", process._id),
        )
        .take(2000);
      const flow = await ctx.db
        .query("processFlows")
        .withIndex("by_clerkOrgId_and_processId", (q) =>
          q.eq("clerkOrgId", args.clerkOrgId).eq("processId", process._id),
        )
        .order("desc")
        .first();

      let nodes: FlowNodeInput[] = [];
      if (flow) {
        // Staged (v3) flows keep node detail in child rows of the current run.
        const details = new Map<string, Doc<"processFlowNodeDetails">>();
        if (flow.generationVersion === "v3" && flow.generationId) {
          const rows = await ctx.db
            .query("processFlowNodeDetails")
            .withIndex("by_clerkOrgId_and_processFlowId_and_generationId_and_nodeId", (q) =>
              q
                .eq("clerkOrgId", args.clerkOrgId)
                .eq("processFlowId", flow._id)
                .eq("generationId", flow.generationId!),
            )
            .take(500);
          for (const row of rows) details.set(row.nodeId, row);
        }
        nodes = flow.nodes.map((node) => {
          const detail = details.get(node.id)?.detail ?? node;
          return {
            id: node.id,
            label: node.label,
            category: node.category,
            description: detail.description || null,
            actors: detail.actors,
            tools: detail.tools,
            painPoints: detail.painPoints,
          };
        });
      }

      const recommendations: ProcessDocInput["recommendations"] = [];
      for (const source of ["v2", "legacy"] as const) {
        const rows = await ctx.db
          .query("processRecommendations")
          .withIndex("by_clerkOrgId_and_processId_and_source_and_lifecycle", (q) =>
            q
              .eq("clerkOrgId", args.clerkOrgId)
              .eq("processId", process._id)
              .eq("source", source)
              .eq("lifecycle", "active"),
          )
          .take(200);
        for (const rec of rows) {
          recommendations.push({
            title: rec.title,
            decisionStatus: rec.decisionStatus,
            problem: rec.content?.problem ?? rec.legacy?.rationale ?? null,
            proposedChange: rec.content?.proposedChange ?? rec.legacy?.expectedBenefit ?? null,
            pilot: rec.content ? `${rec.content.pilot.what} Measure: ${rec.content.pilot.measure}` : null,
          });
        }
        // Legacy rows are only shown where nothing newer exists.
        if (recommendations.length > 0) break;
      }

      page.push({
        processId: process._id,
        description: process.description ?? null,
        overview: {
          name: process.name,
          summaryV2: (process.summaryV2 as SummaryArtifactV2 | undefined) ?? null,
          legacySummary: process.rollingSummary ?? null,
          updatedAt: process.summaryUpdatedAt ?? null,
        },
        interviewCount: interviews.length,
        flow: flow
          ? {
              generatedAt: flow.generatedAt,
              stale: flow.stale,
              nodes,
              edges: flow.edges.map((e) => ({
                source: e.source,
                target: e.target,
                label: e.label ?? null,
                type: e.type,
              })),
              bottlenecks: flow.insights.topBottlenecks,
            }
          : null,
        recommendations,
      });
    }
    return { page, continueCursor: result.continueCursor, isDone: result.isDone };
  },
});

type OrgIndexedTable = {
  withIndex(
    index: string,
    range: (q: { eq(field: "clerkOrgId", value: string): unknown }) => unknown,
  ): {
    paginate(opts: {
      numItems: number;
      cursor: string | null;
      maximumBytesRead?: number;
    }): Promise<PaginationResult<Record<string, unknown>>>;
  };
};

/** Raw rows of one exported table, for `data/<table>.json`. */
export const tablePage = internalQuery({
  args: {
    table: v.string(),
    clerkOrgId: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ page: Record<string, unknown>[]; continueCursor: string; isDone: boolean }> => {
    const table = args.table as TableNames;
    const entry = TENANT_DATA[table];
    if (!entry || entry.scope !== "org" || EXPORT_POLICY[table] !== true) {
      throw new Error(`${args.table} is not an exported table`);
    }
    // The registry test guarantees `orgIndex` exists and leads with clerkOrgId.
    const rows = ctx.db.query(table) as unknown as OrgIndexedTable;
    const result = await rows
      .withIndex(entry.orgIndex, (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .paginate({ numItems: 500, cursor: args.cursor, maximumBytesRead: PAGE_BYTES });
    return {
      page: result.page,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const audioEntriesPage = internalQuery({
  args: {
    clerkOrgId: v.string(),
    exportId: v.id("tenantExports"),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tenantExportAudioEntries")
      .withIndex("by_clerkOrgId_and_exportId", (q) =>
        q.eq("clerkOrgId", args.clerkOrgId).eq("exportId", args.exportId),
      )
      .paginate({ numItems: 1000, cursor: args.cursor });
  },
});

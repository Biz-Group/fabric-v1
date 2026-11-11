"use node";

import { v } from "convex/values";
import { strToU8, zipSync, type Zippable } from "fflate";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import {
  audioExtension,
  groupExclusions,
  interviewStem,
  isoDate,
  placeProcesses,
  renderInterview,
  renderOverview,
  renderProcess,
  renderReadme,
  safeSegment,
  toCsv,
  UNKNOWN_PROCESS,
  type AudioPlacement,
  type ProcessPlace,
} from "./lib/exportRender";
import {
  buildElevenLabsConversationUrl,
  isElevenLabsConversationId,
} from "./lib/elevenLabsConversation";
import { EXPORT_POLICY } from "./lib/tenantData";
import type { AudioCandidate, HierarchyRows } from "./workspaceExport";

// ---------------------------------------------------------------------------
// Builds a workspace export (see workspaceExport.ts). Node runtime, for its
// larger memory: one interview's audio can be 100 MB and the default runtime
// has 64 MB. Each audio pass zips recordings until the part passes
// AUDIO_PART_BYTES or the pass runs out of time, then hands over to the next
// pass; one oversized recording simply gets a part to itself.
// ---------------------------------------------------------------------------

const AUDIO_PART_BYTES = 50 * 1024 * 1024;
/** Leaves headroom under the action time limit for zipping and storing. */
const AUDIO_PASS_MS = 4 * 60 * 1000;

type ExportRow = Doc<"tenantExports"> & { workspaceName: string; workspaceSlug: string };

function stamp(row: ExportRow) {
  return `${safeSegment(row.workspaceSlug, "workspace")}-export-${isoDate(row.createdAt)}`;
}

async function loadRunning(
  ctx: ActionCtx,
  exportId: Id<"tenantExports">,
  phase: "audio" | "data",
): Promise<ExportRow | null> {
  const row: ExportRow | null = await ctx.runQuery(
    internal.workspaceExport.getExportInternal,
    { exportId },
  );
  return row && row.status === "running" && row.phase === phase ? row : null;
}

async function placesFor(ctx: ActionCtx, clerkOrgId: string) {
  const hierarchy: HierarchyRows = await ctx.runQuery(
    internal.workspaceExport.hierarchyInternal,
    { clerkOrgId },
  );
  return { hierarchy, places: placeProcesses(hierarchy) };
}

function audioPath(candidate: AudioCandidate, place: ProcessPlace, mimeType: string | undefined) {
  return `audio/${place.segments.join("/")}/${interviewStem({
    createdAt: candidate.createdAt,
    contributorName: candidate.contributorName,
    conversationId: candidate.conversationId,
  })}.${audioExtension(mimeType)}`;
}

type Fetched =
  | { ok: true; bytes: Uint8Array; mimeType: string | undefined }
  | { ok: false; reason: string };

async function fetchRecording(ctx: ActionCtx, source: AudioCandidate["source"]): Promise<Fetched> {
  if (source.kind === "none") return { ok: false, reason: "no recording was kept" };
  if (source.kind === "storage") {
    const blob = await ctx.storage.get(source.storageId);
    if (!blob) return { ok: false, reason: "the file is no longer stored" };
    return { ok: true, bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: source.mimeType };
  }
  // Agent interviews: ElevenLabs holds the only copy of the audio.
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { ok: false, reason: "ElevenLabs is not configured on this deployment" };
  if (!isElevenLabsConversationId(source.elevenlabsConversationId)) {
    return { ok: false, reason: "the ElevenLabs id is not valid" };
  }
  const response = await fetch(
    buildElevenLabsConversationUrl(source.elevenlabsConversationId, "audio"),
    { headers: { "xi-api-key": apiKey } },
  );
  if (response.status === 404) {
    return { ok: false, reason: "ElevenLabs no longer holds this recording" };
  }
  if (!response.ok) {
    return { ok: false, reason: `ElevenLabs returned an error (${response.status}); export again to retry` };
  }
  const mimeType = response.headers.get("content-type") ?? "audio/mpeg";
  return { ok: true, bytes: new Uint8Array(await response.arrayBuffer()), mimeType };
}

async function fail(ctx: ActionCtx, exportId: Id<"tenantExports">, error: unknown) {
  console.error(`Workspace export ${exportId} failed`, error);
  await ctx.runMutation(internal.workspaceExport.failExport, {
    exportId,
    error: error instanceof Error ? error.message : String(error),
  });
}

export const buildAudioPart = internalAction({
  args: { exportId: v.id("tenantExports") },
  handler: async (ctx, args): Promise<void> => {
    const row = await loadRunning(ctx, args.exportId, "audio");
    if (!row) return;
    try {
      const started = Date.now();
      const { places } = await placesFor(ctx, row.clerkOrgId);
      const files: Zippable = {};
      const entries: {
        conversationId: Id<"conversations">;
        status: "included" | "missing";
        path?: string;
        sizeBytes?: number;
        reason?: string;
      }[] = [];
      let size = 0;
      let cursor = row.audioCursor;
      let done = false;

      while (size < AUDIO_PART_BYTES && Date.now() - started < AUDIO_PASS_MS) {
        const page: { page: AudioCandidate[]; continueCursor: string; isDone: boolean } =
          await ctx.runQuery(internal.workspaceExport.audioCandidatesPage, {
            clerkOrgId: row.clerkOrgId,
            paginationOpts: { numItems: 1, cursor },
          });
        for (const candidate of page.page) {
          const fetched = await fetchRecording(ctx, candidate.source);
          if (!fetched.ok) {
            entries.push({
              conversationId: candidate.conversationId,
              status: "missing",
              reason: fetched.reason,
            });
            continue;
          }
          const place = places.get(candidate.processId) ?? UNKNOWN_PROCESS;
          const path = audioPath(candidate, place, fetched.mimeType);
          // Under the same top folder as the data zip, so unzipping every part
          // in one place merges them. Recordings are already compressed, so
          // they are stored rather than deflated.
          files[`${stamp(row)}/${path}`] = [fetched.bytes, { level: 0 }];
          size += fetched.bytes.byteLength;
          entries.push({
            conversationId: candidate.conversationId,
            status: "included",
            path,
            sizeBytes: fetched.bytes.byteLength,
          });
        }
        cursor = page.continueCursor;
        if (page.isDone) {
          done = true;
          break;
        }
      }

      let part: { name: string; storageId: Id<"_storage">; sizeBytes: number } | undefined;
      if (Object.keys(files).length > 0) {
        const zipped = zipSync(files);
        const name = `${stamp(row)}-audio-${row.partCount + 1}.zip`;
        const storageId = await ctx.storage.store(
          new Blob([zipped], { type: "application/zip" }),
        );
        part = { name, storageId, sizeBytes: zipped.byteLength };
      }
      await ctx.runMutation(internal.workspaceExport.recordAudioProgress, {
        exportId: row._id,
        cursor,
        done,
        part,
        entries,
      });
    } catch (error) {
      await fail(ctx, row._id, error);
    }
  },
});

async function readTable(
  ctx: ActionCtx,
  table: TableNames,
  clerkOrgId: string,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { page: Record<string, unknown>[]; continueCursor: string; isDone: boolean } =
      await ctx.runQuery(internal.workspaceExport.tablePage, { table, clerkOrgId, cursor });
    rows.push(...page.page);
    if (page.isDone) return rows;
    cursor = page.continueCursor;
  }
}

export const buildDataArchive = internalAction({
  args: { exportId: v.id("tenantExports") },
  handler: async (ctx, args): Promise<void> => {
    const row = await loadRunning(ctx, args.exportId, "data");
    if (!row) return;
    try {
      const clerkOrgId = row.clerkOrgId;
      const root = stamp(row);
      const files: Zippable = {};
      const put = (path: string, text: string) => {
        files[`${root}/${path}`] = strToU8(text);
      };
      const { hierarchy, places } = await placesFor(ctx, clerkOrgId);

      // Raw records, one JSON file per exported table.
      const tables: { name: string; rows: number }[] = [];
      const loaded = new Map<string, Record<string, unknown>[]>();
      for (const [table, policy] of Object.entries(EXPORT_POLICY)) {
        if (policy !== true) continue;
        const rows = await readTable(ctx, table as TableNames, clerkOrgId);
        loaded.set(table, rows);
        tables.push({ name: table, rows: rows.length });
        put(`data/${table}.json`, JSON.stringify(rows, null, 2));
      }

      // Where each recording went in the audio pass.
      const audio = new Map<string, AudioPlacement>();
      const audioRows: unknown[][] = [];
      let entryCursor: string | null = null;
      for (;;) {
        const page: {
          page: Doc<"tenantExportAudioEntries">[];
          continueCursor: string;
          isDone: boolean;
        } = await ctx.runQuery(internal.workspaceExport.audioEntriesPage, {
          clerkOrgId,
          exportId: row._id,
          cursor: entryCursor,
        });
        for (const entry of page.page) {
          audio.set(
            entry.conversationId,
            entry.status === "included" && entry.path && entry.partName
              ? { status: "included", path: entry.path, partName: entry.partName }
              : { status: "missing", reason: entry.reason ?? "not available" },
          );
        }
        if (page.isDone) break;
        entryCursor = page.continueCursor;
      }

      // One Markdown file per interview.
      let interviewCount = 0;
      let interviewCursor: string | null = null;
      for (;;) {
        const page: {
          page: Parameters<typeof renderInterview>[0][];
          continueCursor: string;
          isDone: boolean;
        } = await ctx.runQuery(internal.workspaceExport.interviewsPage, {
          clerkOrgId,
          cursor: interviewCursor,
        });
        for (const interview of page.page) {
          const place = places.get(interview.processId) ?? UNKNOWN_PROCESS;
          const placement = audio.get(interview.conversationId) ?? null;
          const stem = interviewStem(interview);
          put(
            `interviews/${place.segments.join("/")}/${stem}.md`,
            renderInterview(interview, place, placement),
          );
          audioRows.push([
            interview.conversationId,
            `interviews/${place.segments.join("/")}/${stem}.md`,
            placement?.status ?? "missing",
            placement?.status === "included" ? placement.path : "",
            placement?.status === "included" ? placement.partName : "",
            placement?.status === "missing" ? placement.reason : placement ? "" : "not available",
          ]);
          interviewCount++;
        }
        if (page.isDone) break;
        interviewCursor = page.continueCursor;
      }
      put(
        "audio-index.csv",
        toCsv(["interview_id", "interview_file", "recording", "audio_path", "audio_zip", "reason"], audioRows),
      );

      // One Markdown file per process, and the function/department overviews.
      let processCount = 0;
      let processCursor: string | null = null;
      for (;;) {
        const page: {
          page: Parameters<typeof renderProcess>[0][];
          continueCursor: string;
          isDone: boolean;
        } = await ctx.runQuery(internal.workspaceExport.processDocsPage, {
          clerkOrgId,
          cursor: processCursor,
        });
        for (const doc of page.page) {
          const place = places.get(doc.processId) ?? UNKNOWN_PROCESS;
          put(`processes/${place.segments.join("/")}.md`, renderProcess(doc, place));
          processCount++;
        }
        if (page.isDone) break;
        processCursor = page.continueCursor;
      }
      const functionNames = new Map(hierarchy.functions.map((f) => [f.id, f.name]));
      for (const fn of hierarchy.functions) {
        put(`overviews/${safeSegment(fn.name)}.md`, renderOverview("Function", fn.name, fn.overview));
      }
      for (const dept of hierarchy.departments) {
        const fnName = functionNames.get(dept.functionId) ?? "Unfiled";
        put(
          `overviews/${safeSegment(fnName)}/${safeSegment(dept.name)}.md`,
          renderOverview("Department", `${fnName} › ${dept.name}`, dept.overview),
        );
      }

      // Members and invitations.
      const departmentLabel = new Map(
        hierarchy.departments.map((d) => [
          d.id,
          `${functionNames.get(d.functionId) ?? "Unfiled"} › ${d.name}`,
        ]),
      );
      const memberRows = (loaded.get("memberships") ?? []).map((m) => [
        m.name ?? "",
        m.email ?? "",
        m.role ?? "",
        m.jobTitle ?? "",
        typeof m.departmentId === "string" ? (departmentLabel.get(m.departmentId) ?? "") : "",
        m.status === "removed" || m.removedAt !== undefined ? "removing" : "member",
        typeof m.createdAt === "number" ? isoDate(m.createdAt) : "",
      ]);
      const inviteRows = (loaded.get("membershipIntents") ?? [])
        .filter((i) => i.status === "pending")
        .map((i) => [
          "",
          i.email ?? "",
          i.requestedRole ?? "",
          "",
          "",
          "invited",
          typeof i.createdAt === "number" ? isoDate(i.createdAt) : "",
        ]);
      put(
        "members.csv",
        toCsv(
          ["name", "email", "role", "job_title", "department", "status", "since"],
          [...memberRows, ...inviteRows],
        ),
      );

      const latest: ExportRow | null = await loadRunning(ctx, row._id, "data");
      if (!latest) return;
      const audioParts: string[] = [];
      for (let n = 1; n <= latest.partCount; n++) audioParts.push(`${root}-audio-${n}.zip`);
      const exportedAt = Date.now();
      const excluded = groupExclusions(EXPORT_POLICY);
      put(
        "README.md",
        renderReadme({
          workspaceName: row.workspaceName,
          exportedAt,
          interviewCount,
          processCount,
          memberCount: memberRows.length,
          audioIncluded: latest.audioIncluded,
          audioMissing: latest.audioMissing,
          audioParts,
          tables,
          excluded,
        }),
      );
      put(
        "manifest.json",
        JSON.stringify(
          {
            workspace: row.workspaceName,
            exportedAt: new Date(exportedAt).toISOString(),
            interviews: interviewCount,
            processes: processCount,
            members: memberRows.length,
            audio: {
              included: latest.audioIncluded,
              missing: latest.audioMissing,
              bytes: latest.audioBytes,
              parts: audioParts,
            },
            tables: Object.fromEntries(tables.map((t) => [t.name, t.rows])),
            notIncluded: excluded,
          },
          null,
          2,
        ),
      );

      const zipped = zipSync(files, { level: 6 });
      const storageId = await ctx.storage.store(new Blob([zipped], { type: "application/zip" }));
      await ctx.runMutation(internal.workspaceExport.completeExport, {
        exportId: row._id,
        file: { name: `${root}-data.zip`, storageId, sizeBytes: zipped.byteLength },
      });
    } catch (error) {
      await fail(ctx, row._id, error);
    }
  },
});

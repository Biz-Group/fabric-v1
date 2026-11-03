import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { conversationTitle } from "../lib/conversationTitle";
import { askToolQuery } from "./executor";
import { getOrgConversation, getOrgEntity, loadHierarchy, processesInScope } from "./scope";
import {
  DEFAULT_BUDGET_TOKENS,
  FULL_TRANSCRIPT_BUDGET_TOKENS,
  MAX_LIST_ITEMS,
  NOT_FOUND,
  ResultBuilder,
  clipText,
  cursorForOffset,
  isoDate,
  offsetFromCursor,
  parseSince,
  searchResult,
  sources,
} from "./results";

/**
 * Completed contributions read per list call. Lists are sorted newest first,
 * so the cap drops only the oldest, and the result says when it was reached.
 */
const MAX_CONVERSATION_SCAN = 1000;

/** Lines in a default transcript window (FR-1.6). */
export const TRANSCRIPT_WINDOW_LINES = 20;

const INPUT_MODE_LABELS = {
  agent: "AI interview",
  voiceRecord: "voice note",
  audioUpload: "uploaded file",
} as const;

function describeConversation(
  conversation: Doc<"conversations">,
  processName: string,
): string {
  const title = conversationTitle(conversation) ?? "Untitled contribution";
  const minutes = conversation.durationSeconds
    ? `${Math.max(1, Math.round(conversation.durationSeconds / 60))} min`
    : null;
  return [
    `${title}.`,
    `Process: ${processName}.`,
    `Contributor: ${conversation.contributorName}.`,
    `Type: ${INPUT_MODE_LABELS[conversation.inputMode ?? "agent"]}.`,
    `Recorded ${isoDate(conversation._creationTime)}${minutes ? `, ${minutes}` : ""}.`,
    `id: ${conversation._id}.`,
  ].join(" ");
}

async function processName(
  ctx: QueryCtx,
  cache: Map<Id<"processes">, string>,
  processId: Id<"processes">,
): Promise<string> {
  const cached = cache.get(processId);
  if (cached) return cached;
  const process = await ctx.db.get(processId);
  const name = process?.name ?? "Unknown process";
  cache.set(processId, name);
  return name;
}

// ---- T5 listConversations ----------------------------------------------------

export const listConversationsInput = {
  // "" means unset: see `scopeInput` in scope.ts on why these aren't nullable.
  processId: v.string(),
  departmentId: v.string(),
  functionId: v.string(),
  since: v.string(),
  cursor: v.string(),
};

/**
 * T5. Completed contributions, newest first, in the org or under one entity,
 * as the Contributions tab lists them (`conversations.listPageByProcess`).
 * `since` filters on the recorded date: contributions carry no completion
 * timestamp, and processing finishes minutes to hours after recording.
 */
export const listConversations = askToolQuery({
  input: listConversationsInput,
  handler: async (ctx, viewer, input) => {
    let scope: ReadonlySet<Id<"processes">> | null = null;
    let scopeSource = sources.org();
    if (input.processId || input.departmentId || input.functionId) {
      const hierarchy = await loadHierarchy(ctx, viewer.orgId);
      if (input.processId) {
        const process = await getOrgEntity(ctx, viewer.orgId, "process", input.processId);
        if (!process) return NOT_FOUND;
        scope = new Set([process._id]);
        scopeSource = sources.entity("process", process._id);
      } else if (input.departmentId) {
        const department = await getOrgEntity(ctx, viewer.orgId, "department", input.departmentId);
        if (!department) return NOT_FOUND;
        scope = new Set(processesInScope(hierarchy, { kind: "department", id: department._id }).map((p) => p._id));
        scopeSource = sources.entity("department", department._id);
      } else {
        const fn = await getOrgEntity(ctx, viewer.orgId, "function", input.functionId!);
        if (!fn) return NOT_FOUND;
        scope = new Set(processesInScope(hierarchy, { kind: "function", id: fn._id }).map((p) => p._id));
        scopeSource = sources.entity("function", fn._id);
      }
    }

    const since = parseSince(input.since);
    const scanned = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_status", (q) => {
        const base = q.eq("clerkOrgId", viewer.orgId).eq("status", "done");
        return since === null ? base : base.gte("_creationTime", since);
      })
      .order("desc")
      .take(MAX_CONVERSATION_SCAN);
    const rows = scope ? scanned.filter((row) => scope.has(row.processId)) : scanned;

    const offset = offsetFromCursor(input.cursor);
    const names = new Map<Id<"processes">, string>();
    const builder = new ResultBuilder(DEFAULT_BUDGET_TOKENS);
    for (const row of rows.slice(offset, offset + MAX_LIST_ITEMS)) {
      const block = searchResult(
        sources.conversation(row.processId, row._id),
        conversationTitle(row) ?? `Contribution by ${row.contributorName}`,
        describeConversation(row, await processName(ctx, names, row.processId)),
      );
      if (!builder.add(block)) break;
    }
    const next = offset + builder.count;
    return builder.finish(
      {
        scope: scopeSource,
        ...(since !== null ? { recordedSince: isoDate(since) } : {}),
        totalCompleted: rows.length,
        ...(scanned.length === MAX_CONVERSATION_SCAN ? { oldestOmitted: true } : {}),
      },
      next < rows.length ? cursorForOffset(next) : null,
    );
  },
});

// ---- T6 getConversationEvidence ----------------------------------------------

export const getConversationEvidenceInput = { conversationId: v.string() };

/** A completed contribution in the viewer's org, or null (FR-1.4). */
async function getCompletedConversation(
  ctx: QueryCtx,
  orgId: string,
  rawId: string,
): Promise<Doc<"conversations"> | null> {
  const conversation = await getOrgConversation(ctx, orgId, rawId);
  return conversation?.status === "done" ? conversation : null;
}

/**
 * T6. What one contribution established, as the pipeline extracted it
 * (`processSummaryEvidenceV2`): steps, actors, tools, handoffs, variations,
 * friction points and open questions, plus its summary.
 */
export const getConversationEvidence = askToolQuery({
  input: getConversationEvidenceInput,
  handler: async (ctx, viewer, input) => {
    const conversation = await getCompletedConversation(ctx, viewer.orgId, input.conversationId);
    if (!conversation) return NOT_FOUND;
    const source = sources.conversation(conversation.processId, conversation._id);
    const title = conversationTitle(conversation) ?? `Contribution by ${conversation.contributorName}`;
    const name = await processName(ctx, new Map(), conversation.processId);
    const builder = new ResultBuilder(DEFAULT_BUDGET_TOKENS);

    builder.add(
      searchResult(
        source,
        title,
        `${describeConversation(conversation, name)}${conversation.summary ? `\n\nSummary: ${clipText(conversation.summary, 350)}` : ""}`,
      ),
    );

    const evidence = conversation.processSummaryEvidenceV2;
    if (evidence) {
      const sections: Array<[string, string[]]> = [
        ["Steps", evidence.steps.map((step) => `${step.title}: ${step.body}`)],
        ["Friction points", evidence.frictionPoints],
        ["Handoffs and dependencies", evidence.handoffsAndDependencies],
        ["Tools", evidence.tools],
        ["Actors", evidence.actors],
        ["Reported variations", evidence.reportedVariations],
        ["Open questions", evidence.uncertainties],
      ];
      for (const [label, items] of sections) {
        if (items.length === 0) continue;
        const text = clipText(`${label}:\n- ${items.join("\n- ")}`, 400);
        if (!builder.add(searchResult(source, `${title}: ${label.toLowerCase()}`, text))) break;
      }
    }
    return builder.finish({
      evidence: evidence ? "extracted" : "not extracted yet",
    });
  },
});

// ---- T7 getTranscript --------------------------------------------------------

export const getTranscriptInput = {
  conversationId: v.string(),
  /** -1 means unset. */
  atSeconds: v.number(),
  query: v.string(),
  full: v.boolean(),
};

export type TranscriptLine = {
  /** 1-based position in the stored transcript; the citation anchor. */
  line: number;
  timeSecs: number;
  speaker: string;
  text: string;
};

export function transcriptLines(conversation: Doc<"conversations">): TranscriptLine[] {
  return (conversation.transcript ?? []).map((entry, index) => ({
    line: index + 1,
    timeSecs: entry.time_in_call_secs,
    // Same fallback as the transcript view in the Contributions tab.
    speaker: entry.speakerName ?? (entry.role === "ai" ? "Fabric" : conversation.contributorName),
    text: entry.content,
  }));
}

/**
 * The index a window centres on (FR-1.6): the line at `atSeconds`; otherwise
 * the first line holding every query term, or failing that the most terms;
 * otherwise the opening line.
 */
export function windowCentre(
  lines: TranscriptLine[],
  atSeconds: number | null,
  query: string | null,
): number {
  if (lines.length === 0) return 0;
  if (atSeconds !== null) {
    const index = lines.findIndex((line) => line.timeSecs >= atSeconds);
    return index === -1 ? lines.length - 1 : index;
  }
  const terms = (query ?? "").toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length > 0) {
    let best = -1;
    let bestHits = 0;
    for (const [index, line] of lines.entries()) {
      const text = line.text.toLocaleLowerCase();
      const hits = terms.filter((term) => text.includes(term)).length;
      if (hits === terms.length) return index;
      if (hits > bestHits) {
        best = index;
        bestHits = hits;
      }
    }
    if (best !== -1) return best;
  }
  return 0;
}

export function transcriptWindow(
  lines: TranscriptLine[],
  centre: number,
  size = TRANSCRIPT_WINDOW_LINES,
): TranscriptLine[] {
  const start = Math.max(0, Math.min(centre - Math.floor(size / 2) + 1, lines.length - size));
  return lines.slice(start, start + size);
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * T7. Transcript lines from one completed contribution, about 20 at a time by
 * default (D26). `full` reads the whole transcript, up to 40K tokens; the
 * system prompt allows it only when the user asks about one whole conversation.
 */
export const getTranscript = askToolQuery({
  input: getTranscriptInput,
  handler: async (ctx, viewer, input) => {
    const conversation = await getCompletedConversation(ctx, viewer.orgId, input.conversationId);
    if (!conversation) return NOT_FOUND;
    const lines = transcriptLines(conversation);
    const full = input.full === true;
    const selected = full
      ? lines
      : transcriptWindow(lines, windowCentre(lines, input.atSeconds >= 0 ? input.atSeconds : null, input.query.trim() || null));

    const builder = new ResultBuilder(full ? FULL_TRANSCRIPT_BUDGET_TOKENS : DEFAULT_BUDGET_TOKENS);
    for (const line of selected) {
      const block = searchResult(
        sources.transcriptLine(conversation.processId, conversation._id, line.timeSecs, line.line),
        `${line.speaker} at ${clock(line.timeSecs)}`,
        `[line ${line.line}, ${clock(line.timeSecs)}] ${line.speaker}: ${line.text}`,
      );
      if (!builder.add(block)) break;
    }
    return builder.finish({
      contribution: conversationTitle(conversation) ?? null,
      contributor: conversation.contributorName,
      totalLines: lines.length,
      mode: full ? "full" : "window",
      ...(selected.length > 0
        ? { fromLine: selected[0].line, toLine: selected[Math.min(selected.length, builder.count) - 1]?.line ?? null }
        : {}),
    });
  },
});

// ---- T12 searchConversations -------------------------------------------------

/** Hits read per full-text index before merging. */
const MAX_SEARCH_HITS = 50;

export const searchConversationsInput = {
  query: v.string(),
  processId: v.string(),
  since: v.string(),
  cursor: v.string(),
};

/**
 * T12. Completed contributions whose title, contributor or summary match the
 * query (FR-1.17, D34), through the existing full-text indexes, filtered to the
 * viewer's org and to completed contributions on the index itself. Merged in
 * index order (title, contributor, summary) and de-duplicated. Transcript text
 * is not searched (Phase 2).
 */
export const searchConversations = askToolQuery({
  input: searchConversationsInput,
  handler: async (ctx, viewer, input) => {
    const query = input.query.trim();
    const builder = new ResultBuilder(DEFAULT_BUDGET_TOKENS);
    if (!query) return builder.finish({ error: "query is empty" });

    let processId: Id<"processes"> | null = null;
    if (input.processId) {
      const process = await getOrgEntity(ctx, viewer.orgId, "process", input.processId);
      if (!process) return NOT_FOUND;
      processId = process._id;
    }

    const indexes = [
      ["search_title", "title"],
      ["search_contributor", "contributorName"],
      ["search_summary", "summary"],
    ] as const;
    const seen = new Set<Id<"conversations">>();
    const hits: Doc<"conversations">[] = [];
    for (const [index, field] of indexes) {
      const rows = await ctx.db
        .query("conversations")
        .withSearchIndex(index, (q) => {
          const base = q.search(field, query).eq("clerkOrgId", viewer.orgId).eq("status", "done");
          return processId ? base.eq("processId", processId) : base;
        })
        .take(MAX_SEARCH_HITS);
      for (const row of rows) {
        if (seen.has(row._id)) continue;
        seen.add(row._id);
        hits.push(row);
      }
    }
    const since = parseSince(input.since);
    const matches = since === null ? hits : hits.filter((row) => row._creationTime >= since);

    const offset = offsetFromCursor(input.cursor);
    const names = new Map<Id<"processes">, string>();
    for (const row of matches.slice(offset, offset + MAX_LIST_ITEMS)) {
      const block = searchResult(
        sources.conversation(row.processId, row._id),
        conversationTitle(row) ?? `Contribution by ${row.contributorName}`,
        `${describeConversation(row, await processName(ctx, names, row.processId))}${row.summary ? ` Summary: ${clipText(row.summary, 80)}` : ""}`,
      );
      if (!builder.add(block)) break;
    }
    const next = offset + builder.count;
    return builder.finish(
      {
        query,
        matches: matches.length,
        ...(since !== null ? { recordedSince: isoDate(since) } : {}),
        searched: "contribution titles, contributor names and summaries (not transcripts)",
      },
      next < matches.length ? cursorForOffset(next) : null,
    );
  },
});

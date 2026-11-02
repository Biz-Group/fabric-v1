import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { readOverviewSnapshot } from "../summaries";
import type { SummaryArtifactV2, SummaryEntityRef } from "../summaryV2";
import { askToolQuery } from "./executor";
import {
  getOrgEntity,
  loadHierarchy,
  loadPendingRows,
  pendingWorkIn,
  processesInScope,
  type PendingWork,
} from "./scope";
import {
  MAX_BUDGET_TOKENS,
  NOT_FOUND,
  ResultBuilder,
  blockTokens,
  clipText,
  isoDate,
  searchResult,
  sources,
  type HierarchyKind,
  type SearchResultBlock,
} from "./results";

/** At most this many entities per call, so all functions fit in one read. */
export const MAX_OVERVIEW_IDS = 10;

/** Finding sections per kind, in reading order (FR-1.14). */
export const OVERVIEW_SECTIONS = {
  process: ["scope", "consensus", "variations", "gaps", "notable"],
  department: [
    "crossProcessDependencies",
    "sharedPatterns",
    "variationsAndTensions",
    "gaps",
    "notable",
  ],
  function: [
    "crossDepartmentDependencies",
    "strategicPatterns",
    "variationsAndTensions",
    "gaps",
    "notable",
  ],
} as const satisfies Record<HierarchyKind, readonly string[]>;

type Finding = SummaryArtifactV2["gaps"][number];

export const getOverviewInput = {
  kind: v.union(v.literal("function"), v.literal("department"), v.literal("process")),
  ids: v.array(v.string()),
  sections: v.union(v.array(v.string()), v.null()),
};

function entityRef(kind: HierarchyKind, id: string): SummaryEntityRef {
  if (kind === "process") return { kind, processId: id as Id<"processes"> };
  if (kind === "department") return { kind, departmentId: id as Id<"departments"> };
  return { kind, functionId: id as Id<"functions"> };
}

function pendingPhrase(work: PendingWork): string {
  const parts = [
    work.processing ? `${work.processing} still processing` : null,
    work.needsLabels ? `${work.needsLabels} awaiting speaker labels` : null,
    work.failed ? `${work.failed} failed` : null,
  ].filter(Boolean);
  return parts.length
    ? `Pending contributions not yet in this overview: ${parts.join(", ")}.`
    : "";
}

function evidencePhrase(finding: Finding): string {
  return `evidence: ${finding.evidenceLevel}, ${finding.supportCount} supporting contribution${finding.supportCount === 1 ? "" : "s"}`;
}

/**
 * T3. AI overviews for 1–10 entities of one kind, read exactly as the overview
 * page reads them (`summaries.getOverview`): the `SUMMARY_V2` gate applies, so
 * an org with V2 off gets the Markdown projection and no V2 findings (FR-1.5).
 * Every result carries freshness and pending work (FR-1.7). With several
 * entities, findings are compacted to title and evidence.
 */
export const getOverview = askToolQuery({
  input: getOverviewInput,
  handler: async (ctx, viewer, input) => {
    const requested = [...new Set(input.ids)];
    if (requested.length === 0) return NOT_FOUND;
    const ids = requested.slice(0, MAX_OVERVIEW_IDS);

    const docs: Array<Doc<"functions"> | Doc<"departments"> | Doc<"processes">> = [];
    for (const id of ids) {
      const doc = await getOrgEntity(ctx, viewer.orgId, input.kind, id);
      if (doc) docs.push(doc);
    }
    if (docs.length === 0) return NOT_FOUND;

    const allowed: readonly string[] = OVERVIEW_SECTIONS[input.kind];
    const sections = input.sections?.length
      ? allowed.filter((section) => input.sections!.includes(section))
      : allowed;
    const compact = docs.length > 1;
    const hierarchy = await loadHierarchy(ctx, viewer.orgId);
    const pendingRows = await loadPendingRows(ctx, viewer.orgId);
    const builder = new ResultBuilder(MAX_BUDGET_TOKENS);

    // Pass 1: every entity's headline and state, so a long overview can never
    // crowd another entity out entirely.
    const findingsByEntity: Array<{ entityId: string; blocks: SearchResultBlock[] }> = [];
    const states: Record<string, string> = {};
    for (const doc of docs) {
      const snapshot = await readOverviewSnapshot(ctx, viewer.orgId, entityRef(input.kind, doc._id));
      const { content, state } = snapshot;
      states[doc._id] = state;
      const scope = processesInScope(
        hierarchy,
        input.kind === "process"
          ? { kind: "process", id: doc._id as Id<"processes"> }
          : input.kind === "department"
            ? { kind: "department", id: doc._id as Id<"departments"> }
            : { kind: "function", id: doc._id as Id<"functions"> },
      );
      const pending = pendingPhrase(pendingWorkIn(pendingRows, new Set(scope.map((p) => p._id))));
      const generatedAt =
        content.format === "v2"
          ? content.artifact.provenance.generatedAt
          : content.format === "legacy"
            ? ((doc as { summaryUpdatedAt?: number; }).summaryUpdatedAt ?? null)
            : null;
      const freshness = [
        `State: ${state}${generatedAt ? `, last generated ${isoDate(generatedAt)}` : ""}.`,
        state === "refreshing" ? "A refresh is running; this is the last successful version." : "",
        content.format === "v2"
          ? `Coverage: ${content.artifact.coverage.includedSources} of ${content.artifact.coverage.totalEligibleSources} sources${content.artifact.coverage.complete ? "" : " (partial)"}.`
          : "",
        pending,
        `id: ${doc._id}.`,
      ]
        .filter(Boolean)
        .join(" ");

      let body: string;
      if (content.format === "v2") {
        body = compact
          ? content.artifact.headline
          : `${content.artifact.headline}\n\n${content.artifact.executiveBrief}`;
      } else if (content.format === "legacy") {
        body = clipText(content.markdown, compact ? 250 : 1_500);
      } else {
        body = "No overview has been generated yet.";
      }
      builder.add(
        searchResult(
          sources.overview(input.kind, doc._id),
          `${doc.name} — ${input.kind} overview`,
          `${body}\n\n${freshness}`,
        ),
      );

      const blocks: SearchResultBlock[] = [];
      if (content.format === "v2") {
        const artifact = content.artifact as unknown as Record<string, Finding[] | undefined>;
        for (const section of sections) {
          for (const finding of artifact[section] ?? []) {
            const sourceLabels = finding.sources.map((s) => s.label).slice(0, 5);
            blocks.push(
              searchResult(
                sources.finding(input.kind, doc._id, finding.id),
                `${doc.name}: ${finding.title}`,
                compact
                  ? `[${section}] ${finding.title} (${evidencePhrase(finding)})`
                  : `[${section}] ${finding.title}. ${finding.body} (${evidencePhrase(finding)}${sourceLabels.length ? `; from: ${sourceLabels.join(", ")}` : ""})`,
              ),
            );
          }
        }
      }
      findingsByEntity.push({ entityId: doc._id, blocks });
    }

    // Pass 2: findings, each entity getting an even share of what is left.
    for (const [index, entity] of findingsByEntity.entries()) {
      const share = Math.floor(builder.remaining / (findingsByEntity.length - index));
      let spent = 0;
      for (const block of entity.blocks) {
        const cost = blockTokens(block);
        if (spent + cost > share || !builder.add(block)) {
          builder.markTruncated();
          break;
        }
        spent += cost;
      }
    }

    return builder.finish({
      kind: input.kind,
      sections,
      states,
      ...(requested.length > ids.length ? { idsIgnored: requested.length - ids.length } : {}),
      ...(docs.length < ids.length ? { notFound: ids.length - docs.length } : {}),
    });
  },
});

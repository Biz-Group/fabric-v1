import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { readableSummaryV2 } from "../lib/summaryV2Feature";
import { deriveHandoffs, type FlowNode } from "../lib/insightsDerivations";
import { isManualRework, normalizeKey } from "../lib/askNormalize";
import type { SummaryArtifactV2 } from "../summaryV2";
import { askToolQuery } from "./executor";
import {
  conversationContributor,
  loadScopeEvidence,
  nodeContributors,
  type ScopeEvidence,
} from "./evidence";
import { getOrgEntity, loadHierarchy, processesInScope, scopeInput, scopeOf, type OrgHierarchy } from "./scope";
import {
  MAX_BUDGET_TOKENS,
  MAX_LIST_ITEMS,
  NOT_FOUND,
  ResultBuilder,
  blockTokens,
  clipText,
  searchResult,
  shortTitle,
  sources,
  type HierarchyKind,
  type SearchResultBlock,
} from "./results";

export const SIGNALS = [
  "bottleneck",
  "friction",
  "gap",
  "handoff",
  "tribalKnowledge",
  "automationOpportunity",
  "manualRework",
] as const;
export type Signal = (typeof SIGNALS)[number];

/** Sources cited per aggregate item (FR-1.8). */
export const MAX_ITEM_SOURCES = 5;
const DEFAULT_ITEMS_PER_SIGNAL = 8;

export const EVIDENCE_WEIGHT = { corroborated: 3, single_source: 2, inferred_gap: 1 } as const;
const CONFIDENCE_WEIGHT = { high: 3, medium: 2, low: 1 } as const;

export type SignalRef = {
  source: string;
  processName: string;
  text: string;
};

export type SignalItem = {
  signal: Signal;
  text: string;
  processes: Set<string>;
  contributors: Set<string>;
  evidenceWeight: number;
  refs: SignalRef[];
  heuristic: boolean;
};

export function scoreOf(item: SignalItem): number {
  return 3 * item.processes.size + 2 * item.contributors.size + item.evidenceWeight;
}

/** Findings from overviews in scope, gated by `SUMMARY_V2` (FR-1.5). */
export type GapSource = {
  kind: HierarchyKind;
  doc: Doc<"functions"> | Doc<"departments"> | Doc<"processes">;
  /** Processes the overview covers. */
  processIds: string[];
  /** Each covered department's processes, to resolve a finding's sources. */
  departmentProcessIds: ReadonlyMap<string, string[]>;
};

type Collector = {
  add: (
    signal: Signal,
    text: string,
    ref: SignalRef,
    detail: { processIds: string[]; contributors: string[]; weight: number; heuristic?: boolean },
  ) => void;
  items: () => SignalItem[];
};

function collector(): Collector {
  const byKey = new Map<string, SignalItem>();
  return {
    add(signal, text, ref, detail) {
      const key = `${signal}:${normalizeKey(text)}`;
      if (!normalizeKey(text)) return;
      let item = byKey.get(key);
      if (!item) {
        item = {
          signal,
          text: text.trim(),
          processes: new Set(),
          contributors: new Set(),
          evidenceWeight: 0,
          refs: [],
          heuristic: detail.heuristic ?? false,
        };
        byKey.set(key, item);
      }
      for (const processId of detail.processIds) item.processes.add(processId);
      for (const contributor of detail.contributors) item.contributors.add(contributor);
      item.evidenceWeight = Math.max(item.evidenceWeight, detail.weight);
      if (!item.refs.some((existing) => existing.source === ref.source)) item.refs.push(ref);
    },
    items: () => [...byKey.values()],
  };
}

function nodeRef(processId: string, processName: string, node: FlowNode, text: string): SignalRef {
  return { source: sources.flowNode(processId, node.id), processName, text };
}

/**
 * The deterministic signal pass (FR-1.14): merges items by exact normalised
 * text, then ranks by `3 × processes + 2 × contributors + evidence weight`,
 * ties broken by name.
 */
export function collectSignals(
  wanted: ReadonlySet<Signal>,
  evidence: ScopeEvidence,
  gapSources: GapSource[],
): Map<Signal, SignalItem[]> {
  const c = collector();

  for (const { process, flow, nodes } of evidence.flows) {
    const pid = process._id;
    const nodeWeight = (node: FlowNode) => CONFIDENCE_WEIGHT[node.confidence];
    for (const node of nodes) {
      const who = nodeContributors(node);
      if (wanted.has("bottleneck") && node.isBottleneck) {
        c.add("bottleneck", node.label, nodeRef(pid, process.name, node, `${node.label}${node.painPoints[0] ? `: ${node.painPoints[0]}` : ""}`), {
          processIds: [pid],
          contributors: who,
          weight: nodeWeight(node),
        });
      }
      if (wanted.has("tribalKnowledge") && node.isTribalKnowledge) {
        c.add("tribalKnowledge", node.label, nodeRef(pid, process.name, node, `${node.label}${node.riskIndicators[0] ? `: ${node.riskIndicators[0]}` : ""}`), {
          processIds: [pid],
          contributors: who,
          weight: nodeWeight(node),
        });
      }
      if (wanted.has("automationOpportunity") && (node.automationPotential === "high" || node.automationPotential === "medium")) {
        c.add("automationOpportunity", node.label, nodeRef(pid, process.name, node, `${node.label} (automation potential ${node.automationPotential})`), {
          processIds: [pid],
          contributors: who,
          weight: nodeWeight(node),
        });
      }
      for (const pain of node.painPoints) {
        if (wanted.has("friction")) {
          c.add("friction", pain, nodeRef(pid, process.name, node, `${pain} (step: ${node.label})`), {
            processIds: [pid],
            contributors: who,
            weight: nodeWeight(node),
          });
        }
        if (wanted.has("manualRework") && isManualRework(pain)) {
          c.add("manualRework", pain, nodeRef(pid, process.name, node, `${pain} (step: ${node.label})`), {
            processIds: [pid],
            contributors: who,
            weight: nodeWeight(node),
            heuristic: true,
          });
        }
      }
    }

    if (wanted.has("bottleneck")) {
      const labelled = new Set(nodes.filter((n) => n.isBottleneck).map((n) => normalizeKey(n.label)));
      for (const named of flow.insights.topBottlenecks) {
        const node = flow.nodes.find((n) => n.id === named || normalizeKey(n.label) === normalizeKey(named));
        if (node && labelled.has(normalizeKey(node.label))) continue;
        c.add(
          "bottleneck",
          node?.label ?? named,
          node
            ? nodeRef(pid, process.name, node, node.label)
            : { source: sources.entity("process", pid), processName: process.name, text: named },
          { processIds: [pid], contributors: node ? nodeContributors(node) : [], weight: 2 },
        );
      }
    }

    if (wanted.has("handoff")) {
      for (const handoff of deriveHandoffs(flow.nodes, flow.edges)) {
        const from = handoff.source.actors.join(", ") || handoff.source.label;
        const to = handoff.target.actors.join(", ") || handoff.target.label;
        if (normalizeKey(from) === normalizeKey(to)) continue;
        c.add("handoff", `${from} → ${to}`, nodeRef(pid, process.name, handoff.target, `${from} → ${to} (${handoff.source.label} → ${handoff.target.label})`), {
          processIds: [pid],
          contributors: [...nodeContributors(handoff.source), ...nodeContributors(handoff.target)],
          weight: CONFIDENCE_WEIGHT[handoff.target.confidence],
        });
      }
    }

    if (wanted.has("automationOpportunity") && flow.insights.automationOpportunitiesSource !== "derived") {
      for (const opportunity of flow.insights.automationOpportunityDetails ?? []) {
        const node = flow.nodes.find((n) => n.id === opportunity.nodeIds[0]);
        c.add(
          "automationOpportunity",
          opportunity.title,
          node
            ? nodeRef(pid, process.name, node, `${opportunity.title}: ${opportunity.rationale}`)
            : { source: sources.entity("process", pid), processName: process.name, text: opportunity.title },
          { processIds: [pid], contributors: [], weight: CONFIDENCE_WEIGHT[opportunity.confidence] },
        );
      }
    }
  }

  for (const { conversation, evidence: found } of evidence.contributions) {
    const pid = conversation.processId;
    const processName = evidence.processById.get(pid)?.name ?? "Unknown process";
    const ref = (text: string): SignalRef => ({
      source: sources.conversation(pid, conversation._id),
      processName,
      text: `${text} (${conversation.contributorName})`,
    });
    const who = [conversationContributor(conversation)];
    for (const friction of found.frictionPoints) {
      if (wanted.has("friction")) c.add("friction", friction, ref(friction), { processIds: [pid], contributors: who, weight: 2 });
      if (wanted.has("manualRework") && isManualRework(friction)) {
        c.add("manualRework", friction, ref(friction), { processIds: [pid], contributors: who, weight: 2, heuristic: true });
      }
    }
    if (wanted.has("handoff")) {
      for (const handoff of found.handoffsAndDependencies) {
        c.add("handoff", handoff, ref(handoff), { processIds: [pid], contributors: who, weight: 2 });
      }
    }
  }

  if (wanted.has("gap")) {
    for (const { kind, doc, processIds, departmentProcessIds } of gapSources) {
      const artifact = readableSummaryV2(doc.clerkOrgId, doc.summaryV2) as SummaryArtifactV2 | undefined;
      for (const finding of artifact?.gaps ?? []) {
        const contributors = finding.sources
          .filter((s) => s.kind === "conversation")
          .map((s) => normalizeKey(s.label));
        c.add(
          "gap",
          finding.title,
          { source: sources.finding(kind, doc._id, finding.id), processName: doc.name, text: `${finding.title}. ${finding.body}` },
          {
            processIds: affectedProcesses(finding.sources, processIds, departmentProcessIds),
            // Findings name their source contributions; without names, the
            // support count is the best measure of how many people said it.
            contributors: contributors.length
              ? contributors
              : Array.from({ length: finding.supportCount }, (_, i) => `${doc._id}:${i}`),
            weight: EVIDENCE_WEIGHT[finding.evidenceLevel],
          },
        );
      }
    }
  }

  // Evidence-only items heard from two or more people count as corroborated.
  const ranked = new Map<Signal, SignalItem[]>();
  for (const item of c.items()) {
    if (item.contributors.size >= 2) item.evidenceWeight = Math.max(item.evidenceWeight, EVIDENCE_WEIGHT.corroborated);
    const list = ranked.get(item.signal) ?? [];
    list.push(item);
    ranked.set(item.signal, list);
  }
  for (const list of ranked.values()) {
    list.sort((a, b) => scoreOf(b) - scoreOf(a) || a.text.localeCompare(b.text));
  }
  return ranked;
}

/**
 * The processes a finding affects: the ones it cites, or the processes of the
 * departments it cites, and only failing both every process under the
 * overview. A function-level gap drawn from one department shouldn't count
 * the whole function as affected.
 */
export function affectedProcesses(
  findingSources: SummaryArtifactV2["gaps"][number]["sources"],
  covered: string[],
  departmentProcessIds: ReadonlyMap<string, string[]>,
): string[] {
  const inScope = new Set(covered);
  const cited = new Set<string>();
  for (const source of findingSources) {
    if (source.kind === "process" && inScope.has(source.processId)) cited.add(source.processId);
    if (source.kind === "department") {
      for (const id of departmentProcessIds.get(source.departmentId) ?? []) cited.add(id);
    }
  }
  return cited.size > 0 ? [...cited] : covered;
}

/**
 * The overviews whose `gaps` feed the gap signal: every overview at or under
 * the scope. A function's gaps count for the org and for that function; a
 * department's for the org, its function and itself.
 */
export function gapSourcesFor(
  hierarchy: OrgHierarchy,
  processes: Doc<"processes">[],
  scopeKind: HierarchyKind | "org",
): GapSource[] {
  const departments = hierarchy.departments.filter((d) =>
    processes.some((p) => p.departmentId === d._id),
  );
  const functions = hierarchy.functions.filter((f) =>
    departments.some((d) => d.functionId === f._id),
  );
  const idsUnder = (match: (p: Doc<"processes">) => boolean) =>
    processes.filter(match).map((p) => p._id as string);
  const departmentProcessIds = new Map(
    departments.map((d) => [d._id as string, idsUnder((p) => p.departmentId === d._id)]),
  );
  return [
    ...(scopeKind === "org" || scopeKind === "function" ? functions : []).map((doc) => ({
      kind: "function" as const,
      doc,
      processIds: idsUnder((p) => hierarchy.departmentById.get(p.departmentId)?.functionId === doc._id),
      departmentProcessIds,
    })),
    ...(scopeKind === "process" ? [] : departments).map((doc) => ({
      kind: "department" as const,
      doc,
      processIds: idsUnder((p) => p.departmentId === doc._id),
      departmentProcessIds,
    })),
    ...processes.map((doc) => ({
      kind: "process" as const,
      doc,
      processIds: [doc._id as string],
      departmentProcessIds,
    })),
  ];
}

/** Resolves an optional scope to its processes; null when the entity isn't the viewer's. */
export async function scopedProcesses(
  ctx: Parameters<typeof getOrgEntity>[0],
  orgId: string,
  hierarchy: OrgHierarchy,
  kind: HierarchyKind | null,
  id: string | null,
): Promise<{ processes: Doc<"processes">[]; source: string; kind: HierarchyKind | "org"; id: string | null } | null> {
  if (kind === null) return { processes: hierarchy.processes, source: sources.org(), kind: "org", id: null };
  if (!id) return null;
  const doc = await getOrgEntity(ctx, orgId, kind, id);
  if (!doc) return null;
  const processes =
    kind === "process"
      ? [doc as Doc<"processes">]
      : processesInScope(
          hierarchy,
          kind === "department"
            ? { kind, id: doc._id as Id<"departments"> }
            : { kind, id: doc._id as Id<"functions"> },
        );
  return { processes, source: sources.entity(kind, doc._id), kind, id: doc._id };
}

/**
 * One full block for the item, then a short block per further source. The
 * evidence leads and the ranking follows in brackets, so the span Claude quotes
 * in a citation (and readers see in its hover card) is the finding itself.
 */
export function itemBlocks(item: SignalItem, rank: number): SearchResultBlock[] {
  const ranking = `(${item.signal} #${rank}${item.heuristic ? ", heuristic keyword match" : ""}; score ${scoreOf(item)} = 3 × ${item.processes.size} processes + 2 × ${item.contributors.size} contributors + evidence weight ${item.evidenceWeight}; seen in ${[...new Set(item.refs.map((r) => r.processName))].slice(0, 5).join(", ")})`;
  const [first, ...rest] = item.refs.slice(0, MAX_ITEM_SOURCES);
  return [
    searchResult(first.source, shortTitle(`${item.signal}: ${item.text}`), `${clipText(first.text, 80)}\n${ranking}`),
    ...rest.map((ref) =>
      searchResult(ref.source, shortTitle(`${item.signal}: ${ref.processName}`), `Also (${clipText(item.text, 15)}): ${clipText(ref.text, 50)} (${ref.processName})`),
    ),
  ];
}

export const rankSignalsInput = {
  signals: v.array(v.union(...SIGNALS.map((s) => v.literal(s)))),
  ...scopeInput,
  limit: v.number(),
};

/**
 * T15. Signals ranked across every process in scope, grouped by signal, in
 * one call (FR-1.14), from stored pipeline outputs only.
 */
export const rankSignals = askToolQuery({
  input: rankSignalsInput,
  handler: async (ctx, viewer, input) => {
    const wanted = new Set(input.signals.length ? input.signals : SIGNALS);
    const hierarchy = await loadHierarchy(ctx, viewer.orgId);
    const { kind, id } = scopeOf(input);
    const scope = await scopedProcesses(ctx, viewer.orgId, hierarchy, kind, id);
    if (!scope) return NOT_FOUND;
    const evidence = await loadScopeEvidence(ctx, viewer.orgId, scope.processes);
    const ranked = collectSignals(
      wanted,
      evidence,
      wanted.has("gap") ? gapSourcesFor(hierarchy, scope.processes, scope.kind) : [],
    );
    const limit = Math.min(Math.max(Math.floor(input.limit > 0 ? input.limit : DEFAULT_ITEMS_PER_SIGNAL), 1), MAX_LIST_ITEMS);

    const builder = new ResultBuilder(MAX_BUDGET_TOKENS, 300);
    const order = SIGNALS.filter((signal) => wanted.has(signal));
    const counts: Record<string, number> = {};
    for (const signal of order) counts[signal] = ranked.get(signal)?.length ?? 0;
    // Round-robin by rank, so every signal gets its strongest items before any
    // signal gets its weaker ones. An item that doesn't fit is skipped, not
    // the rest of the list: a later, shorter item may still fit.
    for (let rank = 0; rank < limit; rank++) {
      for (const signal of order) {
        const item = ranked.get(signal)?.[rank];
        if (!item) continue;
        const blocks = itemBlocks(item, rank + 1);
        const cost = blocks.reduce((sum, block) => sum + blockTokens(block), 0);
        if (cost > builder.remaining) {
          builder.markTruncated();
          continue;
        }
        for (const block of blocks) builder.add(block);
      }
    }
    return builder.finish(
      {
        scope: scope.source,
        itemsPerSignal: counts,
        processesInScope: scope.processes.length,
        flowsRead: evidence.flows.length,
        contributionsRead: evidence.contributions.length,
        ...(evidence.capped ? { readCapped: true } : {}),
        ranking: "score = 3 × processes affected + 2 × distinct contributors + evidence weight (corroborated 3, single source 2, inferred 1)",
      },
      null,
      {
        summary: {
          source: scope.source,
          title: "Signal ranking: scope and method",
          text: `Ranked across ${scope.processes.length} processes in scope, reading ${evidence.flows.length} process flows and ${evidence.contributions.length} contributions with extracted evidence. Score = 3 × processes affected + 2 × distinct contributors + evidence weight (corroborated 3, single source 2, inferred 1).`,
        },
        whenEmpty: {
          source: scope.source,
          title: "Signal scan: nothing found",
          text: `No ${order.join(", ")} signals found across ${scope.processes.length} processes in scope.`,
        },
      },
    );
  },
});

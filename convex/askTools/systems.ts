import type { Doc } from "../_generated/dataModel";
import { deriveHandoffs, type FlowNode } from "../lib/insightsDerivations";
import { isManualRework, normalizeKey, termOverlap } from "../lib/askNormalize";
import { askToolQuery } from "./executor";
import { loadScopeEvidence, type ScopeEvidence } from "./evidence";
import { loadHierarchy, scopeInput, scopeOf } from "./scope";
import { scopedProcesses, MAX_ITEM_SOURCES } from "./signals";
import {
  MAX_BUDGET_TOKENS,
  MAX_LIST_ITEMS,
  NOT_FOUND,
  ResultBuilder,
  clipText,
  searchResult,
  sources,
  type SearchResultBlock,
} from "./results";

const AUTOMATION_RANK = { none: 0, low: 1, medium: 2, high: 3 } as const;
type Potential = keyof typeof AUTOMATION_RANK;

type Place = { source: string; processId: string; processName: string; label: string };

function addPlace(places: Place[], place: Place) {
  if (!places.some((p) => p.source === place.source)) places.push(place);
}

function placeBlocks(title: string, text: string, places: Place[]): SearchResultBlock[] {
  const [first, ...rest] = places.slice(0, MAX_ITEM_SOURCES);
  return [
    searchResult(first.source, title, text),
    ...rest.map((place) =>
      searchResult(place.source, `${title} — ${place.processName}`, `Also: ${clipText(place.label, 40)} (${place.processName})`),
    ),
  ];
}

// ---- T16 listSystems ---------------------------------------------------------

export type SystemSummary = {
  name: string;
  processes: Set<string>;
  processNames: Set<string>;
  steps: number;
  mentions: number;
  painPoints: string[];
  rekeying: string[];
  automation: Potential;
  places: Place[];
};

/** Systems and tools across the scope, ranked by evidenced friction (FR-1.14). */
export function summarizeSystems(evidence: ScopeEvidence): SystemSummary[] {
  const byKey = new Map<string, SystemSummary>();
  const system = (name: string) => {
    const key = normalizeKey(name);
    if (!key) return null;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        name: name.trim(),
        processes: new Set(),
        processNames: new Set(),
        steps: 0,
        mentions: 0,
        painPoints: [],
        rekeying: [],
        automation: "none",
        places: [],
      };
      byKey.set(key, entry);
    }
    return entry;
  };
  const addUnique = (list: string[], text: string) => {
    if (!list.some((t) => normalizeKey(t) === normalizeKey(text))) list.push(text);
  };

  for (const { process, nodes } of evidence.flows) {
    for (const node of nodes) {
      for (const tool of new Set(node.tools)) {
        const entry = system(tool);
        if (!entry) continue;
        entry.processes.add(process._id);
        entry.processNames.add(process.name);
        entry.steps += 1;
        entry.mentions += 1;
        for (const pain of node.painPoints) {
          addUnique(entry.painPoints, pain);
          if (isManualRework(pain)) addUnique(entry.rekeying, pain);
        }
        if (AUTOMATION_RANK[node.automationPotential] > AUTOMATION_RANK[entry.automation]) {
          entry.automation = node.automationPotential;
        }
        addPlace(entry.places, {
          source: sources.flowNode(process._id, node.id),
          processId: process._id,
          processName: process.name,
          label: node.label,
        });
      }
    }
  }
  for (const { conversation, evidence: found } of evidence.contributions) {
    const processName = evidence.processById.get(conversation.processId)?.name ?? "Unknown process";
    for (const tool of new Set(found.tools)) {
      const entry = system(tool);
      if (!entry) continue;
      entry.processes.add(conversation.processId);
      entry.processNames.add(processName);
      entry.mentions += 1;
      for (const friction of found.frictionPoints) {
        if (!normalizeKey(friction).includes(normalizeKey(tool))) continue;
        addUnique(entry.painPoints, friction);
        if (isManualRework(friction)) addUnique(entry.rekeying, friction);
      }
      addPlace(entry.places, {
        source: sources.conversation(conversation.processId, conversation._id),
        processId: conversation.processId,
        processName,
        label: `${conversation.contributorName}'s contribution`,
      });
    }
  }

  return [...byKey.values()].sort(
    (a, b) =>
      b.painPoints.length + 2 * b.rekeying.length - (a.painPoints.length + 2 * a.rekeying.length) ||
      b.processes.size - a.processes.size ||
      b.mentions - a.mentions ||
      a.name.localeCompare(b.name),
  );
}

/**
 * T16. Systems and tools mentioned across the scope, with the processes and
 * steps that use each, pain points, manual re-keying and automation potential.
 * Evidence only: the agent never names replacement products (D31).
 */
export const listSystems = askToolQuery({
  input: scopeInput,
  handler: async (ctx, viewer, input) => {
    const hierarchy = await loadHierarchy(ctx, viewer.orgId);
    const { kind, id } = scopeOf(input);
    const scope = await scopedProcesses(ctx, viewer.orgId, hierarchy, kind, id);
    if (!scope) return NOT_FOUND;
    const evidence = await loadScopeEvidence(ctx, viewer.orgId, scope.processes);
    const systems = summarizeSystems(evidence);

    const builder = new ResultBuilder(MAX_BUDGET_TOKENS, 250);
    for (const [index, entry] of systems.slice(0, MAX_LIST_ITEMS).entries()) {
      const text = [
        `#${index + 1} System: ${entry.name}.`,
        `Used in ${entry.processes.size} process${entry.processes.size === 1 ? "" : "es"} (${clipText([...entry.processNames].join(", "), 40)}), ${entry.steps} flow steps, ${entry.mentions} mentions.`,
        entry.painPoints.length ? `Pain points: ${clipText(entry.painPoints.join("; "), 90)}.` : "No pain points recorded.",
        entry.rekeying.length ? `Manual re-keying (heuristic): ${clipText(entry.rekeying.join("; "), 50)}.` : "",
        `Highest automation potential: ${entry.automation}.`,
      ]
        .filter(Boolean)
        .join(" ");
      const blocks = placeBlocks(`System: ${entry.name}`, text, entry.places);
      if (!blocks.every((block) => builder.add(block))) break;
    }
    return builder.finish({
      scope: scope.source,
      systems: systems.length,
      ...(evidence.capped ? { readCapped: true } : {}),
      note: "Evidence about systems in use only. Do not recommend vendors or products.",
    });
  },
});

// ---- T17 findSimilarWork -----------------------------------------------------

export type DuplicationCandidate = {
  pattern: "sameSystemSimilarStep" | "sameHandoff" | "sameFriction";
  text: string;
  processes: Set<string>;
  places: Place[];
};

/** Labels this similar count as the same step (FR-1.19, first pass). */
export const SIMILAR_LABEL_OVERLAP = 0.5;

function similarSteps(a: FlowNode, b: FlowNode): boolean {
  if (normalizeKey(a.label) === normalizeKey(b.label)) return true;
  return a.category === b.category && termOverlap(a.label, b.label) >= SIMILAR_LABEL_OVERLAP;
}

/**
 * The deterministic duplication pass (FR-1.19): the same system on a similar
 * step, the same handoff pair, or the same friction text, in two or more
 * processes. Candidates to confirm, never conclusions.
 */
export function findDuplicationCandidates(evidence: ScopeEvidence): DuplicationCandidate[] {
  const candidates: DuplicationCandidate[] = [];

  // 1. Same system plus a similar step, in different processes.
  type Use = { process: Doc<"processes">; node: FlowNode };
  const usesByTool = new Map<string, { name: string; uses: Use[] }>();
  for (const { process, nodes } of evidence.flows) {
    for (const node of nodes) {
      for (const tool of new Set(node.tools)) {
        const key = normalizeKey(tool);
        if (!key) continue;
        const entry = usesByTool.get(key) ?? { name: tool.trim(), uses: [] };
        entry.uses.push({ process, node });
        usesByTool.set(key, entry);
      }
    }
  }
  for (const { name, uses } of [...usesByTool.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const sorted = [...uses].sort(
      (a, b) => a.node.label.localeCompare(b.node.label) || a.process._id.localeCompare(b.process._id),
    );
    const claimed = new Set<number>();
    for (let i = 0; i < sorted.length; i++) {
      if (claimed.has(i)) continue;
      const group = [sorted[i]];
      for (let j = i + 1; j < sorted.length; j++) {
        if (claimed.has(j)) continue;
        if (similarSteps(sorted[i].node, sorted[j].node)) {
          group.push(sorted[j]);
          claimed.add(j);
        }
      }
      const processes = new Set(group.map((use) => use.process._id as string));
      if (processes.size < 2) continue;
      candidates.push({
        pattern: "sameSystemSimilarStep",
        text: `${name} is used for a similar step in ${processes.size} processes: ${[...new Set(group.map((u) => `"${u.node.label}" (${u.process.name})`))].join(", ")}`,
        processes,
        places: group.map((use) => ({
          source: sources.flowNode(use.process._id, use.node.id),
          processId: use.process._id,
          processName: use.process.name,
          label: use.node.label,
        })),
      });
    }
  }

  // 2. The same handoff pair in several processes.
  const handoffs = new Map<string, DuplicationCandidate>();
  for (const { process, flow } of evidence.flows) {
    for (const handoff of deriveHandoffs(flow.nodes, flow.edges)) {
      const from = handoff.source.actors.join(", ");
      const to = handoff.target.actors.join(", ");
      if (!from || !to || normalizeKey(from) === normalizeKey(to)) continue;
      const key = `${normalizeKey(from)}→${normalizeKey(to)}`;
      const entry = handoffs.get(key) ?? {
        pattern: "sameHandoff" as const,
        text: `${from} hands work to ${to}`,
        processes: new Set<string>(),
        places: [],
      };
      entry.processes.add(process._id);
      addPlace(entry.places, {
        source: sources.flowNode(process._id, handoff.target.id),
        processId: process._id,
        processName: process.name,
        label: `${handoff.source.label} → ${handoff.target.label}`,
      });
      handoffs.set(key, entry);
    }
  }

  // 3. The same friction text in several processes.
  const frictions = new Map<string, DuplicationCandidate>();
  const addFriction = (text: string, place: Place) => {
    const key = normalizeKey(text);
    if (!key) return;
    const entry = frictions.get(key) ?? {
      pattern: "sameFriction" as const,
      text: `The same friction is reported in several processes: "${text.trim()}"`,
      processes: new Set<string>(),
      places: [],
    };
    entry.processes.add(place.processId);
    addPlace(entry.places, place);
    frictions.set(key, entry);
  };
  for (const { process, nodes } of evidence.flows) {
    for (const node of nodes) {
      for (const pain of node.painPoints) {
        addFriction(pain, {
          source: sources.flowNode(process._id, node.id),
          processId: process._id,
          processName: process.name,
          label: node.label,
        });
      }
    }
  }
  for (const { conversation, evidence: found } of evidence.contributions) {
    const processName = evidence.processById.get(conversation.processId)?.name ?? "Unknown process";
    for (const friction of found.frictionPoints) {
      addFriction(friction, {
        source: sources.conversation(conversation.processId, conversation._id),
        processId: conversation.processId,
        processName,
        label: `${conversation.contributorName}'s contribution`,
      });
    }
  }

  candidates.push(
    ...[...handoffs.values(), ...frictions.values()].filter((c) => c.processes.size >= 2),
  );
  return candidates.sort(
    (a, b) =>
      b.processes.size - a.processes.size ||
      b.places.length - a.places.length ||
      a.text.localeCompare(b.text),
  );
}

const PATTERN_LABELS = {
  sameSystemSimilarStep: "same system, similar step",
  sameHandoff: "same handoff",
  sameFriction: "same friction",
} as const;

/**
 * T17, first pass. Duplication candidates across processes in scope, each
 * citing where it occurs, framed as candidates to confirm. The semantic pass
 * ("different words, same work") is Phase 2.
 */
export const findSimilarWork = askToolQuery({
  input: scopeInput,
  handler: async (ctx, viewer, input) => {
    const hierarchy = await loadHierarchy(ctx, viewer.orgId);
    const { kind, id } = scopeOf(input);
    const scope = await scopedProcesses(ctx, viewer.orgId, hierarchy, kind, id);
    if (!scope) return NOT_FOUND;
    const evidence = await loadScopeEvidence(ctx, viewer.orgId, scope.processes);
    const candidates = findDuplicationCandidates(evidence);

    const builder = new ResultBuilder(MAX_BUDGET_TOKENS, 250);
    for (const [index, candidate] of candidates.slice(0, MAX_LIST_ITEMS).entries()) {
      const blocks = placeBlocks(
        `Duplication candidate: ${PATTERN_LABELS[candidate.pattern]}`,
        `#${index + 1} Candidate to confirm (${PATTERN_LABELS[candidate.pattern]}, ${candidate.processes.size} processes): ${clipText(candidate.text, 120)}.`,
        candidate.places,
      );
      if (!blocks.every((block) => builder.add(block))) break;
    }
    return builder.finish(
      {
        scope: scope.source,
        candidates: candidates.length,
        processesInScope: scope.processes.length,
        ...(evidence.capped ? { readCapped: true } : {}),
        note: "Deterministic first pass: exact or near-exact wording only. Work described in different words is not detected. Present these as candidates to confirm.",
      },
      null,
      {
        source: scope.source,
        title: "Duplication scan: no candidates",
        text: `No duplication candidates found across ${scope.processes.length} processes in scope (${evidence.flows.length} flows and ${evidence.contributions.length} contributions read). This first pass detects only exact or near-exact wording: the same system on a similar step, the same handoff, or the same friction text. Work described in different words is not detected.`,
      },
    );
  },
});

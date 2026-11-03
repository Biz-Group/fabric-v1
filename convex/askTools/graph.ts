import { v } from "convex/values";
import { deriveHandoffs } from "../lib/insightsDerivations";
import { mentions, normalizeKey } from "../lib/askNormalize";
import { askToolQuery } from "./executor";
import { loadScopeEvidence, type ScopeEvidence } from "./evidence";
import { loadHierarchy } from "./scope";
import { MAX_ITEM_SOURCES } from "./signals";
import {
  MAX_BUDGET_TOKENS,
  MAX_LIST_ITEMS,
  ResultBuilder,
  clipText,
  searchResult,
  sources,
  type SearchResultBlock,
} from "./results";

type Match = { source: string; text: string };

type ProcessMatches = {
  processId: string;
  processName: string;
  matches: Match[];
};

function group(matches: Array<Match & { processId: string; processName: string }>): ProcessMatches[] {
  const byProcess = new Map<string, ProcessMatches>();
  for (const match of matches) {
    const entry = byProcess.get(match.processId) ?? {
      processId: match.processId,
      processName: match.processName,
      matches: [],
    };
    if (!entry.matches.some((m) => m.source === match.source && m.text === match.text)) {
      entry.matches.push({ source: match.source, text: match.text });
    }
    byProcess.set(match.processId, entry);
  }
  return [...byProcess.values()].sort(
    (a, b) => b.matches.length - a.matches.length || a.processName.localeCompare(b.processName),
  );
}

function processBlocks(entry: ProcessMatches, heading: string): SearchResultBlock[] {
  return entry.matches.slice(0, MAX_ITEM_SOURCES).map((match, index) =>
    searchResult(
      match.source,
      `${heading} — ${entry.processName}`,
      index === 0
        ? `${entry.processName} (${entry.matches.length} match${entry.matches.length === 1 ? "" : "es"}, process id: ${entry.processId}): ${clipText(match.text, 70)}`
        : `Also in ${entry.processName}: ${clipText(match.text, 50)}`,
    ),
  );
}

// ---- T11a findHandoffs -------------------------------------------------------

/**
 * Handoffs to or from a party (team, role or department), from flow edges
 * between different actors, handoff steps, and contribution evidence
 * (FR-1.16).
 */
export function matchHandoffs(evidence: ScopeEvidence, party: string) {
  const found: Array<Match & { processId: string; processName: string }> = [];
  for (const { process, flow } of evidence.flows) {
    for (const handoff of deriveHandoffs(flow.nodes, flow.edges)) {
      const from = handoff.source.actors.join(", ") || handoff.source.label;
      const to = handoff.target.actors.join(", ") || handoff.target.label;
      const fromParty =
        mentions(from, party) || (handoff.source.category === "handoff" && mentions(handoff.source.label, party));
      const toParty =
        mentions(to, party) || (handoff.target.category === "handoff" && mentions(handoff.target.label, party));
      if (!fromParty && !toParty) continue;
      found.push({
        processId: process._id,
        processName: process.name,
        source: sources.flowNode(process._id, (toParty ? handoff.target : handoff.source).id),
        text: `${from} → ${to} (${handoff.source.label} → ${handoff.target.label})${toParty ? `; hands off to ${party}` : `; ${party} hands off`}`,
      });
    }
  }
  for (const { conversation, evidence: found_ } of evidence.contributions) {
    for (const handoff of found_.handoffsAndDependencies) {
      if (!mentions(handoff, party)) continue;
      found.push({
        processId: conversation.processId,
        processName: evidence.processById.get(conversation.processId)?.name ?? "Unknown process",
        source: sources.conversation(conversation.processId, conversation._id),
        text: `${handoff} (from ${conversation.contributorName}'s contribution)`,
      });
    }
  }
  return group(found);
}

export const findHandoffsInput = { party: v.string() };

export const findHandoffs = askToolQuery({
  input: findHandoffsInput,
  handler: async (ctx, viewer, input) => {
    const hierarchy = await loadHierarchy(ctx, viewer.orgId);
    const evidence = await loadScopeEvidence(ctx, viewer.orgId, hierarchy.processes);
    const processes = matchHandoffs(evidence, input.party);
    const builder = new ResultBuilder(MAX_BUDGET_TOKENS, 200);
    for (const entry of processes.slice(0, MAX_LIST_ITEMS)) {
      if (!processBlocks(entry, `Handoffs involving ${input.party}`).every((b) => builder.add(b))) break;
    }
    return builder.finish({
      party: input.party,
      processesMatched: processes.length,
      ...(evidence.capped ? { readCapped: true } : {}),
      matching: "Whole-word name match on step actors, handoff steps and contribution evidence.",
    });
  },
});

// ---- T11b findProcessesUsing -------------------------------------------------

function nameMatches(value: string, query: string): boolean {
  return normalizeKey(value) === normalizeKey(query) || mentions(value, query);
}

/** Processes and steps that use a tool and/or involve an actor (FR-1.16). */
export function matchUsage(evidence: ScopeEvidence, tool: string | null, actor: string | null) {
  const found: Array<Match & { processId: string; processName: string }> = [];
  for (const { process, nodes } of evidence.flows) {
    for (const node of nodes) {
      const toolHit = tool ? node.tools.find((t) => nameMatches(t, tool)) : undefined;
      const actorHit = actor ? node.actors.find((a) => nameMatches(a, actor)) : undefined;
      if ((tool && !toolHit) || (actor && !actorHit)) continue;
      found.push({
        processId: process._id,
        processName: process.name,
        source: sources.flowNode(process._id, node.id),
        text: `Step "${node.label}"${toolHit ? ` uses ${toolHit}` : ""}${actorHit ? `${toolHit ? "," : ""} done by ${actorHit}` : ""}${node.painPoints[0] ? `. Pain point: ${node.painPoints[0]}` : ""}`,
      });
    }
  }
  for (const { conversation, evidence: found_ } of evidence.contributions) {
    const toolHit = tool ? found_.tools.find((t) => nameMatches(t, tool)) : undefined;
    const actorHit = actor ? found_.actors.find((a) => nameMatches(a, actor)) : undefined;
    if ((tool && !toolHit) || (actor && !actorHit)) continue;
    found.push({
      processId: conversation.processId,
      processName: evidence.processById.get(conversation.processId)?.name ?? "Unknown process",
      source: sources.conversation(conversation.processId, conversation._id),
      text: `${conversation.contributorName}'s contribution mentions ${[toolHit, actorHit].filter(Boolean).join(" and ")}`,
    });
  }
  return group(found);
}

export const findProcessesUsingInput = {
  tool: v.string(),
  actor: v.string(),
};

export const findProcessesUsing = askToolQuery({
  input: findProcessesUsingInput,
  handler: async (ctx, viewer, input) => {
    const builder = new ResultBuilder(MAX_BUDGET_TOKENS, 200);
    if (!input.tool?.trim() && !input.actor?.trim()) {
      return builder.finish({ error: "Pass a tool, an actor, or both." });
    }
    const hierarchy = await loadHierarchy(ctx, viewer.orgId);
    const evidence = await loadScopeEvidence(ctx, viewer.orgId, hierarchy.processes);
    const processes = matchUsage(evidence, input.tool?.trim() || null, input.actor?.trim() || null);
    const heading = [input.tool, input.actor].filter(Boolean).join(" / ");
    for (const entry of processes.slice(0, MAX_LIST_ITEMS)) {
      if (!processBlocks(entry, `Using ${heading}`).every((b) => builder.add(b))) break;
    }
    return builder.finish({
      tool: input.tool,
      actor: input.actor,
      processesMatched: processes.length,
      ...(evidence.capped ? { readCapped: true } : {}),
    });
  },
});

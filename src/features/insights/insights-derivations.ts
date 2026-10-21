import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";

// Pure, presentation-agnostic derivations over a generated process flow.
// Shared by the Insights tab (web cards) and the process PDF export so both
// surfaces compute handoffs, tools, bottlenecks, automation candidates, etc.
// from a single source of truth.

export type ProcessFlow = NonNullable<
  FunctionReturnType<typeof api.processFlows.getProcessFlow>
>;
export type FlowNode = ProcessFlow["nodes"][number];
export type FlowEdge = ProcessFlow["edges"][number];
export type Confidence = FlowNode["confidence"];
export type AutomationPotential = FlowNode["automationPotential"];

export type HandoffItem = {
  id: string;
  source: FlowNode;
  target: FlowNode;
  edge: FlowEdge | null;
  actors: string[];
};

export type ToolUsage = {
  name: string;
  steps: FlowNode[];
};

export type HeavyArea = {
  node: FlowNode;
  toolCount: number;
  handoffSignals: number;
};

/** Sort weight for automation potential (higher = better candidate). */
const AUTOMATION_RANK: Record<AutomationPotential, number> = {
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

function normalizeText(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function uniqueStrings(values: string[]) {
  const byKey = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalizeText(trimmed);
    if (!byKey.has(key)) byKey.set(key, trimmed);
  }
  return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
}

export function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function actorList(node: FlowNode) {
  return uniqueStrings(node.actors).join(", ") || "Actor not specified";
}

export function getNodeMap(nodes: FlowNode[]) {
  return new Map(nodes.map((node) => [node.id, node]));
}

/**
 * Whether this node's step has actually been described.
 *
 * A node awaiting (or failed out of) enrichment carries placeholder values —
 * `automationPotential: "low"`, `confidence: "medium"`, `isBottleneck: false`.
 * Those are indistinguishable from real assessments once they reach a
 * derivation, so anything reading them would report findings nobody made:
 * automation candidates that were never assessed, a confidence breakdown that
 * calls half the process "medium". Absent status means a legacy flow, whose
 * nodes were described inline.
 */
export function isNodeDescribed(node: {
  id: string;
  detailStatus?: string;
}): boolean {
  return (node.detailStatus ?? "ready") === "ready";
}

/**
 * The nodes a detail-derived metric may look at. Graph-level derivations
 * (handoffs, decision branches) use the full set — topology is settled as soon
 * as the graph lands.
 *
 * Structural and generic rather than `FlowNode[]`: the PDF builder reaches these
 * nodes through its own input type, and a legacy flow read from anywhere other
 * than `getProcessFlow` may carry no status at all.
 */
export function describedNodes<T extends { id: string; detailStatus?: string }>(
  nodes: T[],
): T[] {
  return nodes.filter(isNodeDescribed);
}

function actorsChanged(source: FlowNode, target: FlowNode) {
  const sourceActors = uniqueStrings(source.actors).map(normalizeText);
  const targetActors = uniqueStrings(target.actors).map(normalizeText);
  if (sourceActors.length === 0 || targetActors.length === 0) return false;
  if (sourceActors.length !== targetActors.length) return true;
  return sourceActors.some((actor) => !targetActors.includes(actor));
}

export function deriveHandoffs(nodes: FlowNode[], edges: FlowEdge[]) {
  const nodeMap = getNodeMap(nodes);
  const seen = new Set<string>();
  const representedHandoffNodes = new Set<string>();
  const items: HandoffItem[] = [];

  for (const edge of edges) {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) continue;

    const isHandoff =
      source.category === "handoff" ||
      target.category === "handoff" ||
      actorsChanged(source, target);

    if (!isHandoff) continue;

    const id = `edge:${edge.id}`;
    seen.add(id);
    if (source.category === "handoff") representedHandoffNodes.add(source.id);
    if (target.category === "handoff") representedHandoffNodes.add(target.id);
    items.push({
      id,
      source,
      target,
      edge,
      actors: uniqueStrings([...source.actors, ...target.actors]),
    });
  }

  for (const node of nodes) {
    if (node.category !== "handoff") continue;

    const incoming = edges.find((edge) => edge.target === node.id);
    const outgoing = edges.find((edge) => edge.source === node.id);
    const source = incoming ? nodeMap.get(incoming.source) : undefined;
    const target = outgoing ? nodeMap.get(outgoing.target) : undefined;
    const id = `node:${node.id}`;

    if (seen.has(id)) continue;
    if (representedHandoffNodes.has(node.id)) continue;
    items.push({
      id,
      source: source ?? node,
      target: target ?? node,
      edge: outgoing ?? incoming ?? null,
      actors: uniqueStrings([
        ...(source?.actors ?? []),
        ...node.actors,
        ...(target?.actors ?? []),
      ]),
    });
  }

  return items;
}

export function deriveToolUsage(nodes: FlowNode[]) {
  const byTool = new Map<string, ToolUsage>();

  // Tools come from the detail pass, so an un-described node has none and would
  // silently read as a step that uses no tools.
  for (const node of describedNodes(nodes)) {
    for (const tool of uniqueStrings(node.tools)) {
      const key = normalizeText(tool);
      const current = byTool.get(key);
      if (current) {
        current.steps.push(node);
      } else {
        byTool.set(key, { name: tool, steps: [node] });
      }
    }
  }

  return Array.from(byTool.values()).sort(
    (a, b) => b.steps.length - a.steps.length || a.name.localeCompare(b.name),
  );
}

export function deriveHeavyAreas(nodes: FlowNode[], handoffs: HandoffItem[]) {
  const handoffCountByNode = new Map<string, number>();

  for (const item of handoffs) {
    handoffCountByNode.set(
      item.source.id,
      (handoffCountByNode.get(item.source.id) ?? 0) + 1,
    );
    handoffCountByNode.set(
      item.target.id,
      (handoffCountByNode.get(item.target.id) ?? 0) + 1,
    );
  }

  return nodes
    .map((node): HeavyArea => ({
      node,
      toolCount: uniqueStrings(node.tools).length,
      handoffSignals:
        (handoffCountByNode.get(node.id) ?? 0) +
        (node.category === "handoff" ? 1 : 0),
    }))
    .filter((area) => area.toolCount >= 2 || area.handoffSignals > 0)
    .sort(
      (a, b) =>
        b.toolCount + b.handoffSignals - (a.toolCount + a.handoffSignals) ||
        a.node.label.localeCompare(b.node.label),
    );
}

export function deriveBottlenecks(flow: ProcessFlow) {
  const topBottleneckKeys = new Set(
    flow.insights.topBottlenecks.map(normalizeText),
  );

  // `isBottleneck` defaults to false before enrichment, so an un-described step
  // would quietly count as "not a bottleneck" — a conclusion nobody reached.
  return describedNodes(flow.nodes).filter(
    (node) =>
      node.isBottleneck ||
      topBottleneckKeys.has(normalizeText(node.id)) ||
      topBottleneckKeys.has(normalizeText(node.label)),
  );
}

export function deriveAutomationCandidates(nodes: FlowNode[]) {
  return describedNodes(nodes)
    .filter((node) => node.automationPotential !== "none")
    .sort(
      (a, b) =>
        AUTOMATION_RANK[b.automationPotential] -
          AUTOMATION_RANK[a.automationPotential] ||
        a.label.localeCompare(b.label),
    );
}

export function deriveDecisionBranches(node: FlowNode, edges: FlowEdge[]) {
  return edges.filter((edge) => edge.source === node.id);
}

export type KeyFindingKind =
  | "bottleneck"
  | "automation"
  | "knowledge_risk"
  | "weak_evidence"
  | "handoff_hotspot";

export type KeyFinding = {
  kind: KeyFindingKind;
  title: string;
  detail: string;
  /** The step the finding is about, for "Show in flow". */
  nodeId: string | null;
};

export type KeyFindings =
  | { state: "findings"; findings: KeyFinding[] }
  /** Described steps exist, and none carry a reported issue. */
  | { state: "none_reported" }
  /** No step was described, so there is nothing to report on. */
  | { state: "not_described" };

export const MAX_KEY_FINDINGS = 4;

const CONFIDENCE_RANK: Record<Confidence, number> = {
  high: 2,
  medium: 1,
  low: 0,
};

function firstText(values: string[]) {
  return values.map((value) => value.trim()).find(Boolean) ?? null;
}

/** The step with the most supporting text, ties broken by confidence then label. */
function pickStrongest(nodes: FlowNode[], weight: (node: FlowNode) => number) {
  return [...nodes].sort(
    (a, b) =>
      weight(b) - weight(a) ||
      CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
      a.label.localeCompare(b.label),
  )[0];
}

function moreSuffix(count: number, noun: string) {
  return count > 1 ? ` One of ${pluralize(count, noun)}.` : "";
}

/**
 * The few findings Insights leads with, chosen deterministically from what the
 * flow already reports — no new analysis. Every finding cites a step (or an
 * automation opportunity) the reader can open. Ordered by how directly a reader
 * can act on it: a reported bottleneck, the strongest recommended automation,
 * knowledge held by few, steps resting on weak evidence, then a step where work
 * changes hands repeatedly.
 */
export function deriveKeyFindings(
  flow: ProcessFlow,
  handoffs: HandoffItem[],
): KeyFindings {
  const described = describedNodes(flow.nodes);
  if (described.length === 0) return { state: "not_described" };

  const findings: KeyFinding[] = [];

  const bottlenecks = deriveBottlenecks(flow);
  if (bottlenecks.length > 0) {
    const node = pickStrongest(bottlenecks, (n) => n.painPoints.length);
    findings.push({
      kind: "bottleneck",
      title: `Bottleneck: ${node.label}`,
      detail:
        (firstText(node.painPoints) ??
          "Marked as a bottleneck in the generated flow.") +
        moreSuffix(bottlenecks.length, "reported bottleneck"),
      nodeId: node.id,
    });
  }

  // Derived opportunities are automatable-looking steps, not recommendations,
  // so they never lead.
  const opportunities =
    flow.insights.automationOpportunitiesSource === "derived"
      ? []
      : (flow.insights.automationOpportunityDetails ?? []);
  if (opportunities.length > 0) {
    const top = [...opportunities].sort(
      (a, b) =>
        CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
        b.nodeIds.length - a.nodeIds.length ||
        a.title.localeCompare(b.title),
    )[0];
    findings.push({
      kind: "automation",
      title: `Automation: ${top.title}`,
      detail:
        (top.expectedBenefit?.trim() || top.rationale.trim()) +
        moreSuffix(opportunities.length, "recommended automation"),
      nodeId: top.nodeIds[0] ?? null,
    });
  }

  const knowledgeRisks = described.filter((node) => node.isTribalKnowledge);
  if (knowledgeRisks.length > 0) {
    const node = pickStrongest(knowledgeRisks, (n) => n.riskIndicators.length);
    findings.push({
      kind: "knowledge_risk",
      title: `Knowledge risk: ${node.label}`,
      detail:
        (firstText(node.riskIndicators) ??
          "Depends on knowledge only a few people hold.") +
        moreSuffix(knowledgeRisks.length, "step"),
      nodeId: node.id,
    });
  }

  const weak = described.filter((node) => node.confidence === "low");
  if (weak.length > 0) {
    findings.push({
      kind: "weak_evidence",
      title:
        weak.length === 1
          ? `Weak evidence: ${weak[0].label}`
          : `Weak evidence: ${pluralize(weak.length, "step")}`,
      detail:
        weak.length === 1
          ? "This step is inferred or rests on a weak source. Confirm it in a contribution."
          : `${weak[0].label} and ${pluralize(weak.length - 1, "other step")} are inferred or rest on weak sources. Confirm them in a contribution.`,
      nodeId: weak[0].id,
    });
  }

  // Count how often each step sits at either end of a handoff. Only a step in
  // two or more is a hotspot; a single handoff is ordinary.
  const handoffsByNode = new Map<string, { node: FlowNode; count: number }>();
  for (const item of handoffs) {
    for (const node of new Set([item.source, item.target])) {
      const current = handoffsByNode.get(node.id);
      handoffsByNode.set(node.id, {
        node,
        count: (current?.count ?? 0) + 1,
      });
    }
  }
  const hotspot = [...handoffsByNode.values()]
    .filter((entry) => entry.count >= 2)
    .sort(
      (a, b) => b.count - a.count || a.node.label.localeCompare(b.node.label),
    )[0];
  if (hotspot) {
    findings.push({
      kind: "handoff_hotspot",
      title: `Handoff hotspot: ${hotspot.node.label}`,
      detail: `Work changes hands ${hotspot.count} times around this step.`,
      nodeId: hotspot.node.id,
    });
  }

  if (findings.length === 0) return { state: "none_reported" };
  return { state: "findings", findings: findings.slice(0, MAX_KEY_FINDINGS) };
}

/**
 * Confidence breakdown over described steps only. The totals will not add up to
 * the node count on a partial flow — which is correct: a step nobody described
 * has no confidence, and counting it as "medium" (its placeholder) would put a
 * verdict on the process that no analysis produced.
 */
export function deriveConfidenceCounts(nodes: FlowNode[]) {
  const counts: Record<Confidence, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const node of describedNodes(nodes)) counts[node.confidence] += 1;
  return counts;
}

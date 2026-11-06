import type { Doc } from "../_generated/dataModel";

/**
 * One step of a process flow and the steps directly either side of it, for
 * AskFabric's flow snippet (FR-11.3). Topology only: labels and categories
 * come from the flow row itself, so no node detail is read.
 */

/** Steps shown on each side; the rest are counted. */
export const MAX_NEIGHBOURS = 4;

type FlowDoc = Pick<Doc<"processFlows">, "nodes" | "edges">;
type Category = Doc<"processFlows">["nodes"][number]["category"];

export type FlowStep = { id: string; label: string; category: Category };
/** A neighbour, with the label on the edge that joins it (a decision's "Yes"). */
export type FlowNeighbour = FlowStep & { edgeLabel: string | null };

export type FlowNeighbourhood = {
  step: FlowStep;
  before: FlowNeighbour[];
  after: FlowNeighbour[];
  moreBefore: number;
  moreAfter: number;
};

export function flowNeighbourhood(flow: FlowDoc, nodeId: string): FlowNeighbourhood | null {
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const node = byId.get(nodeId);
  if (!node) return null;
  const step = (id: string): FlowStep | null => {
    const found = byId.get(id);
    return found ? { id: found.id, label: found.label, category: found.category } : null;
  };

  const side = (direction: "before" | "after") => {
    const seen = new Set<string>();
    const neighbours: FlowNeighbour[] = [];
    // The happy path first, so a decision's main route leads.
    const edges = flow.edges
      .filter((edge) => (direction === "before" ? edge.target : edge.source) === nodeId)
      .sort((a, b) => Number(b.isHappyPath) - Number(a.isHappyPath));
    for (const edge of edges) {
      const id = direction === "before" ? edge.source : edge.target;
      if (id === nodeId || seen.has(id)) continue;
      const neighbour = step(id);
      if (!neighbour) continue;
      seen.add(id);
      neighbours.push({ ...neighbour, edgeLabel: edge.label?.trim() || null });
    }
    return neighbours;
  };

  const before = side("before");
  const after = side("after");
  return {
    step: { id: node.id, label: node.label, category: node.category },
    before: before.slice(0, MAX_NEIGHBOURS),
    after: after.slice(0, MAX_NEIGHBOURS),
    moreBefore: Math.max(0, before.length - MAX_NEIGHBOURS),
    moreAfter: Math.max(0, after.length - MAX_NEIGHBOURS),
  };
}

import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";

/**
 * Pure view model for the Firm view: turns the `getFirmMap` read model into a
 * nested node tree and directed, aggregated edges at a chosen level of detail.
 *
 * Every link is stored once, from the side of the process that reported it,
 * with one endpoint that may be a process, a department, a whole function, or
 * an outside party. Everything here works off one primitive — an endpoint's
 * ancestor chain — so "does this link leave Finance?" is the same question
 * whether Finance is a node, a container, or an edge's far end.
 */

export type FirmMapData = FunctionReturnType<typeof api.firmMap.getFirmMap>;
export type FirmProcess = FirmMapData["processes"][number];
export type FirmLink = FirmMapData["links"][number];
export type FirmLevel = "department" | "process";
export type FirmNodeKind =
  | "function"
  | "department"
  | "process"
  | "external"
  | "outside";
export type FirmConfidence = FirmLink["confidence"];

export const OUTSIDE_GROUP_ID = "outside";

export const fnNodeId = (id: string) => `fn:${id}`;
export const deptNodeId = (id: string) => `dept:${id}`;
export const procNodeId = (id: string) => `proc:${id}`;
export const extNodeId = (key: string) => `ext:${key}`;

/** One stored link, oriented as work actually flows: from → to. */
export type DirectedLink = {
  link: FirmLink;
  from: string;
  to: string;
};

export type FirmModel = {
  data: FirmMapData;
  processById: Map<string, FirmProcess>;
  departmentById: Map<string, FirmMapData["departments"][number]>;
  functionById: Map<string, FirmMapData["functions"][number]>;
  externals: Map<string, { id: string; name: string }>;
  links: DirectedLink[];
  /** Node id → its ancestor chain, nearest first, including itself. */
  ancestors: (nodeId: string) => string[];
};

export type FirmGraphNode = {
  id: string;
  kind: FirmNodeKind;
  label: string;
  parentId?: string;
  /** Leaves get a card; containers get a frame around their children. */
  container: boolean;
};

export type FirmGraphEdge = {
  id: string;
  source: string;
  target: string;
  links: DirectedLink[];
  labels: string[];
  /** Reported from more than one process — both sides tell the same story. */
  corroborated: boolean;
  confidence: FirmConfidence;
  /** Every link is still an unreviewed AI proposal. */
  proposed: boolean;
  /**
   * Work flows both ways between the two ends. One edge rather than two
   * opposite ones: an exchange is one relationship, and a reverse edge has to
   * run against the layout's direction, looping around the whole map.
   */
  bidirectional: boolean;
};

export type FirmGraph = {
  level: FirmLevel;
  nodes: FirmGraphNode[];
  edges: FirmGraphEdge[];
};

const CONFIDENCE_RANK: Record<FirmConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function counterpartyNodeId(link: FirmLink): string {
  const counterparty = link.counterparty;
  switch (counterparty.kind) {
    case "process":
      return procNodeId(counterparty.processId);
    case "department":
      return deptNodeId(counterparty.departmentId);
    case "function":
      return fnNodeId(counterparty.functionId);
    case "external":
      return extNodeId(link.counterpartyKey);
  }
}

export function buildFirmModel(data: FirmMapData): FirmModel {
  const processById = new Map(data.processes.map((p) => [p._id as string, p]));
  const departmentById = new Map(
    data.departments.map((d) => [d._id as string, d]),
  );
  const functionById = new Map(data.functions.map((f) => [f._id as string, f]));

  // An outside party has no row of its own; its display name is whichever
  // spelling the links use most.
  const spellings = new Map<string, Map<string, number>>();
  for (const link of data.links) {
    if (link.counterparty.kind !== "external") continue;
    const counts = spellings.get(link.counterpartyKey) ?? new Map();
    counts.set(
      link.counterparty.name,
      (counts.get(link.counterparty.name) ?? 0) + 1,
    );
    spellings.set(link.counterpartyKey, counts);
  }
  const externals = new Map<string, { id: string; name: string }>();
  for (const [key, counts] of spellings) {
    const [name] = Array.from(counts.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0];
    externals.set(extNodeId(key), { id: extNodeId(key), name });
  }

  const links: DirectedLink[] = data.links.map((link) => {
    const self = procNodeId(link.sourceProcessId);
    const other = counterpartyNodeId(link);
    return link.direction === "outbound"
      ? { link, from: self, to: other }
      : { link, from: other, to: self };
  });

  const cache = new Map<string, string[]>();
  const ancestors = (nodeId: string): string[] => {
    const cached = cache.get(nodeId);
    if (cached) return cached;
    let chain: string[] = [nodeId];
    const [kind, id] = splitNodeId(nodeId);
    if (kind === "proc") {
      const process = processById.get(id);
      if (process) chain = [nodeId, ...ancestors(deptNodeId(process.departmentId))];
    } else if (kind === "dept") {
      const department = departmentById.get(id);
      if (department) chain = [nodeId, fnNodeId(department.functionId)];
    } else if (kind === "ext") {
      chain = [nodeId, OUTSIDE_GROUP_ID];
    }
    cache.set(nodeId, chain);
    return chain;
  };

  return {
    data,
    processById,
    departmentById,
    functionById,
    externals,
    links,
    ancestors,
  };
}

function splitNodeId(nodeId: string): [string, string] {
  const index = nodeId.indexOf(":");
  return index === -1
    ? [nodeId, ""]
    : [nodeId.slice(0, index), nodeId.slice(index + 1)];
}

/**
 * A link is internal to X when both of its ends sit inside X — e.g. a process
 * handing work to its own department is not a handoff on the department map.
 */
export function isInternalLink(model: FirmModel, link: DirectedLink): boolean {
  return (
    model.ancestors(link.from).includes(link.to) ||
    model.ancestors(link.to).includes(link.from)
  );
}

/** Where an endpoint is drawn at a given level of detail. */
export function projectEndpoint(
  model: FirmModel,
  nodeId: string,
  level: FirmLevel,
): string {
  if (level === "process") return nodeId;
  const [kind, id] = splitNodeId(nodeId);
  if (kind === "proc") {
    const process = model.processById.get(id);
    return process ? deptNodeId(process.departmentId) : nodeId;
  }
  return nodeId;
}

export function buildFirmGraph(model: FirmModel, level: FirmLevel): FirmGraph {
  const { data } = model;
  const nodes: FirmGraphNode[] = [];

  for (const fn of data.functions) {
    nodes.push({
      id: fnNodeId(fn._id),
      kind: "function",
      label: fn.name,
      container: true,
    });
  }
  for (const department of data.departments) {
    nodes.push({
      id: deptNodeId(department._id),
      kind: "department",
      label: department.name,
      parentId: fnNodeId(department.functionId),
      container: level === "process",
    });
  }
  if (level === "process") {
    for (const process of data.processes) {
      nodes.push({
        id: procNodeId(process._id),
        kind: "process",
        label: process.name,
        parentId: deptNodeId(process.departmentId),
        container: false,
      });
    }
  }
  if (model.externals.size > 0) {
    nodes.push({
      id: OUTSIDE_GROUP_ID,
      kind: "outside",
      label: "Outside the organisation",
      container: true,
    });
    for (const external of Array.from(model.externals.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      nodes.push({
        id: external.id,
        kind: "external",
        label: external.name,
        parentId: OUTSIDE_GROUP_ID,
        container: false,
      });
    }
  }

  const edgesByKey = new Map<string, FirmGraphEdge>();
  for (const directed of model.links) {
    if (isInternalLink(model, directed)) continue;
    const source = projectEndpoint(model, directed.from, level);
    const target = projectEndpoint(model, directed.to, level);
    if (source === target) continue;
    const key = `${source}->${target}`;
    const edge = edgesByKey.get(key);
    if (!edge) {
      edgesByKey.set(key, {
        id: key,
        source,
        target,
        links: [directed],
        labels: [directed.link.label],
        corroborated: false,
        confidence: directed.link.confidence,
        proposed: directed.link.review === "proposed",
        bidirectional: false,
      });
      continue;
    }
    edge.links.push(directed);
    if (!edge.labels.includes(directed.link.label)) {
      edge.labels.push(directed.link.label);
    }
    if (
      CONFIDENCE_RANK[directed.link.confidence] >
      CONFIDENCE_RANK[edge.confidence]
    ) {
      edge.confidence = directed.link.confidence;
    }
    edge.proposed = edge.proposed && directed.link.review === "proposed";
  }

  // Fold each A→B / B→A pair into one two-way edge, kept in the direction
  // with more links so the layout follows the dominant flow.
  const edges: FirmGraphEdge[] = [];
  const folded = new Set<string>();
  for (const edge of edgesByKey.values()) {
    if (folded.has(edge.id)) continue;
    const reverse = edgesByKey.get(`${edge.target}->${edge.source}`);
    if (!reverse) {
      edges.push(edge);
      continue;
    }
    folded.add(edge.id);
    folded.add(reverse.id);
    // On a tie, the organisation's side leads: outside parties mostly sit
    // downstream on this map, and an exchange pointing the other way runs
    // against the layout and loops around it.
    const reverseLeads =
      reverse.links.length !== edge.links.length
        ? reverse.links.length > edge.links.length
        : nodeKind(edge.source) === "external" &&
          nodeKind(reverse.source) !== "external";
    const [main, other] = reverseLeads ? [reverse, edge] : [edge, reverse];
    edges.push({
      ...main,
      id: `${main.source}<->${main.target}`,
      links: [...main.links, ...other.links],
      labels: [
        ...main.labels,
        ...other.labels.filter((label) => !main.labels.includes(label)),
      ],
      confidence:
        CONFIDENCE_RANK[other.confidence] > CONFIDENCE_RANK[main.confidence]
          ? other.confidence
          : main.confidence,
      proposed: main.proposed && other.proposed,
      bidirectional: true,
    });
  }
  // Corroborated means the same handoff, in the same direction, reported from
  // more than one process. Two opposite handoffs on a two-way edge are two
  // different claims, not agreement.
  for (const edge of edges) {
    edge.corroborated = [true, false].some(
      (forward) =>
        new Set(
          edge.links
            .filter(
              (l) =>
                (projectEndpoint(model, l.from, level) === edge.source) ===
                forward,
            )
            .map((l) => l.link.sourceProcessId),
        ).size > 1,
    );
  }

  return { level, nodes, edges };
}

/**
 * What to keep lit when a node is focused: everything inside it, every edge
 * that leaves or enters it, and whatever sits at the far end of those edges.
 * Containers are never dimmed — they are the map's frame.
 */
export function focusNeighborhood(
  graph: FirmGraph,
  focusId: string,
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const childrenOf = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (!node.parentId) continue;
    const children = childrenOf.get(node.parentId) ?? [];
    children.push(node.id);
    childrenOf.set(node.parentId, children);
  }
  const inside = new Set<string>();
  const stack = [focusId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (inside.has(id)) continue;
    inside.add(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }

  const nodeIds = new Set(inside);
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    const leaves = inside.has(edge.source);
    const enters = inside.has(edge.target);
    if (!leaves && !enters) continue;
    edgeIds.add(edge.id);
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }
  return { nodeIds, edgeIds };
}

/** The links that cross X's boundary, split by direction. */
export function linksAcross(
  model: FirmModel,
  nodeId: string,
): { outbound: DirectedLink[]; inbound: DirectedLink[] } {
  const outbound: DirectedLink[] = [];
  const inbound: DirectedLink[] = [];
  for (const directed of model.links) {
    const fromInside = model.ancestors(directed.from).includes(nodeId);
    const toInside = model.ancestors(directed.to).includes(nodeId);
    if (fromInside && !toInside) outbound.push(directed);
    else if (toInside && !fromInside) inbound.push(directed);
  }
  return { outbound, inbound };
}

/** A human label for any node id — used for the far end of a link. */
export function nodeLabel(model: FirmModel, nodeId: string): string {
  const [kind, id] = splitNodeId(nodeId);
  if (kind === "proc") return model.processById.get(id)?.name ?? "Unknown process";
  if (kind === "dept") {
    return model.departmentById.get(id)?.name ?? "Unknown department";
  }
  if (kind === "fn") return model.functionById.get(id)?.name ?? "Unknown function";
  if (kind === "ext") return model.externals.get(nodeId)?.name ?? "Outside party";
  return "Outside the organisation";
}

export function nodeKind(nodeId: string): FirmNodeKind {
  const [kind] = splitNodeId(nodeId);
  if (kind === "proc") return "process";
  if (kind === "dept") return "department";
  if (kind === "fn") return "function";
  if (kind === "ext") return "external";
  return "outside";
}

export function entityIdOf(nodeId: string): string {
  return splitNodeId(nodeId)[1];
}

export type DepartmentSummary = {
  processCount: number;
  mappedCount: number;
  unownedCount: number;
  inboundCount: number;
  outboundCount: number;
};

export function summarizeDepartment(
  model: FirmModel,
  departmentId: string,
): DepartmentSummary {
  const processes = model.data.processes.filter(
    (p) => p.departmentId === departmentId,
  );
  const { inbound, outbound } = linksAcross(model, deptNodeId(departmentId));
  return {
    processCount: processes.length,
    mappedCount: processes.filter((p) => p.mapped).length,
    unownedCount: processes.filter((p) => !p.owner).length,
    inboundCount: inbound.length,
    outboundCount: outbound.length,
  };
}

export type FirmGap = {
  departmentId: string;
  name: string;
  inboundCount: number;
  reason: "unmapped" | "empty";
};

export type FirmStats = {
  processCount: number;
  mappedCount: number;
  handoffCount: number;
  crossDepartmentCount: number;
  externalCount: number;
  unownedCount: number;
  /**
   * Departments other teams depend on that have nothing mapped — the work
   * everyone relies on and nobody has described. Most-depended-on first.
   */
  gaps: FirmGap[];
};

export function firmStats(model: FirmModel): FirmStats {
  const processLevel = buildFirmGraph(model, "process");
  const departmentLevel = buildFirmGraph(model, "department");
  const crossDepartmentCount = departmentLevel.edges
    .filter(
      (edge) => nodeKind(edge.source) !== "external" &&
        nodeKind(edge.target) !== "external",
    )
    .reduce((total, edge) => total + edge.links.length, 0);

  const gaps: FirmGap[] = [];
  for (const department of model.data.departments) {
    const summary = summarizeDepartment(model, department._id);
    if (summary.inboundCount === 0 || summary.mappedCount > 0) continue;
    gaps.push({
      departmentId: department._id,
      name: department.name,
      inboundCount: summary.inboundCount,
      reason: summary.processCount === 0 ? "empty" : "unmapped",
    });
  }
  gaps.sort((a, b) => b.inboundCount - a.inboundCount || a.name.localeCompare(b.name));

  return {
    processCount: model.data.processes.length,
    mappedCount: model.data.processes.filter((p) => p.mapped).length,
    handoffCount: processLevel.edges.reduce(
      (total, edge) => total + edge.links.length,
      0,
    ),
    crossDepartmentCount,
    externalCount: model.externals.size,
    unownedCount: model.data.processes.filter((p) => !p.owner).length,
    gaps,
  };
}

import type {
  ELK,
  ElkExtendedEdge,
  ElkLabel,
  ElkNode,
  ElkPoint,
} from "elkjs/lib/elk-api";
import type { FirmGraph, FirmGraphEdge, FirmGraphNode } from "./firm-graph";

/**
 * Nested layout for the Firm view: functions contain departments, departments
 * (at process level) contain processes, and outside parties sit in their own
 * band. ELK rather than the dagre the process flow uses because dagre's
 * compound layout cannot route edges between nested containers; ELK's layered
 * algorithm with INCLUDE_CHILDREN lays out the whole hierarchy in one pass.
 *
 * ELK routes the edges and places their labels too, and the canvas draws
 * exactly those routes. Letting React Flow draw its own curves between handles
 * threw that work away: labels piled up wherever curves happened to cross, sat
 * on top of cards, and a handoff running against the layer order swung off the
 * side of the map and back.
 *
 * Takes the ELK instance as an argument so the ~1.5 MB bundle loads lazily in
 * the app and directly in tests.
 */

export type FirmLayoutBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FirmEdgeRoute = {
  /** Absolute flow coordinates, start to end. */
  points: ElkPoint[];
  /** Absolute flow coordinates of the label's box, when it has one. */
  label?: FirmLayoutBox;
};

export type FirmLayoutResult = {
  /** Position relative to the parent container, as React Flow expects. */
  boxes: Map<string, FirmLayoutBox>;
  routes: Map<string, FirmEdgeRoute>;
  width: number;
  height: number;
};

export const FIRM_LEAF_SIZE: Record<
  "department" | "process" | "external",
  { width: number; height: number }
> = {
  department: { width: 220, height: 92 },
  process: { width: 200, height: 72 },
  external: { width: 176, height: 44 },
};

/** Room at the top of a container for its title. */
export const FIRM_CONTAINER_HEADER = 36;
const CONTAINER_PADDING = `[top=${FIRM_CONTAINER_HEADER + 12},left=16,bottom=16,right=16]`;
const EMPTY_CONTAINER = { width: 200, height: 72 };

/** Edge label text is clipped to this so one long label cannot widen a layer. */
export const FIRM_EDGE_LABEL_MAX_CHARS = 32;
export const FIRM_EDGE_LABEL_HEIGHT = 20;

const ROOT_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.spacing.nodeNodeBetweenLayers": "64",
  "elk.layered.spacing.edgeNodeBetweenLayers": "24",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "14",
  "elk.spacing.nodeNode": "28",
  "elk.spacing.edgeNode": "20",
  "elk.spacing.edgeEdge": "12",
  "elk.spacing.edgeLabel": "4",
  "elk.spacing.componentComponent": "40",
  "elk.edgeLabels.placement": "CENTER",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  // Edge sections and labels in root coordinates, so the canvas can draw them
  // without walking each edge's container chain.
  "elk.json.edgeCoords": "ROOT",
};

/** What an edge's label reads on the map — shared with the canvas. */
export function firmEdgeLabelText(edge: FirmGraphEdge): string | null {
  const first = edge.labels[0];
  if (!first) return null;
  const clipped =
    first.length > FIRM_EDGE_LABEL_MAX_CHARS
      ? `${first.slice(0, FIRM_EDGE_LABEL_MAX_CHARS - 1).trimEnd()}…`
      : first;
  return edge.labels.length > 1
    ? `${clipped} +${edge.labels.length - 1}`
    : clipped;
}

/**
 * Width estimates for text ELK cannot measure. Generous on purpose: a label
 * box slightly wider than its text costs a few pixels, one narrower than its
 * text overlaps whatever ELK put next to it.
 */
function estimateTextWidth(text: string, pxPerChar: number): number {
  return Math.ceil(text.length * pxPerChar);
}

function edgeLabelWidth(text: string, corroborated: boolean): number {
  // 10px medium text plus horizontal padding, and room for the ⇄ marker.
  return estimateTextWidth(text, 6) + 16 + (corroborated ? 14 : 0);
}

/** A container is at least as wide as its own title. */
function containerMinWidth(node: FirmGraphNode): number {
  const uppercase = node.kind !== "department";
  // Icon, gaps, and padding, plus the "Unmapped" badge's room.
  return estimateTextWidth(node.label, uppercase ? 8 : 7) + 56 + 72;
}

function leafSize(node: FirmGraphNode) {
  if (node.kind === "department") return FIRM_LEAF_SIZE.department;
  if (node.kind === "external") return FIRM_LEAF_SIZE.external;
  return FIRM_LEAF_SIZE.process;
}

function toElkTree(
  graph: FirmGraph,
  options: { withEdges: boolean; withLabels: boolean },
): ElkNode {
  const childrenOf = new Map<string | undefined, FirmGraphNode[]>();
  const ids = new Set(graph.nodes.map((node) => node.id));
  for (const node of graph.nodes) {
    // A child whose parent is missing is drawn at the root rather than lost.
    const parent =
      node.parentId && ids.has(node.parentId) ? node.parentId : undefined;
    const siblings = childrenOf.get(parent) ?? [];
    siblings.push(node);
    childrenOf.set(parent, siblings);
  }

  const build = (node: FirmGraphNode): ElkNode => {
    const children = childrenOf.get(node.id) ?? [];
    if (!node.container) return { id: node.id, ...leafSize(node) };
    const minWidth = containerMinWidth(node);
    if (children.length === 0) {
      return {
        id: node.id,
        width: Math.max(EMPTY_CONTAINER.width, minWidth),
        height: EMPTY_CONTAINER.height,
      };
    }
    return {
      id: node.id,
      layoutOptions: {
        "elk.padding": CONTAINER_PADDING,
        "elk.nodeSize.constraints": "MINIMUM_SIZE",
        "elk.nodeSize.minimum": `(${minWidth}, 0)`,
      },
      children: children.map(build),
    };
  };

  const edges: ElkExtendedEdge[] = options.withEdges
    ? graph.edges
        .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
        .map((edge) => {
          const text = options.withLabels ? firmEdgeLabelText(edge) : null;
          const labels: ElkLabel[] = text
            ? [
                {
                  id: `${edge.id}:label`,
                  text,
                  width: edgeLabelWidth(text, edge.corroborated),
                  height: FIRM_EDGE_LABEL_HEIGHT,
                },
              ]
            : [];
          return {
            id: edge.id,
            sources: [edge.source],
            targets: [edge.target],
            labels,
          };
        })
    : [];

  return {
    id: "root",
    layoutOptions: ROOT_OPTIONS,
    children: (childrenOf.get(undefined) ?? []).map(build),
    edges,
  };
}

function collectBoxes(node: ElkNode, boxes: Map<string, FirmLayoutBox>): void {
  for (const child of node.children ?? []) {
    boxes.set(child.id, {
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? 0,
      height: child.height ?? 0,
    });
    collectBoxes(child, boxes);
  }
}

function collectRoutes(root: ElkNode): Map<string, FirmEdgeRoute> {
  const routes = new Map<string, FirmEdgeRoute>();
  const visit = (node: ElkNode) => {
    for (const edge of node.edges ?? []) {
      const section = edge.sections?.[0];
      if (!section) continue;
      const label = edge.labels?.[0];
      routes.set(edge.id, {
        points: [
          section.startPoint,
          ...(section.bendPoints ?? []),
          section.endPoint,
        ],
        label:
          label && label.x !== undefined && label.y !== undefined
            ? {
                x: label.x,
                y: label.y,
                width: label.width ?? 0,
                height: label.height ?? 0,
              }
            : undefined,
      });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return routes;
}

/**
 * The graph split at the top level into pieces no edge connects.
 *
 * ELK cannot separate disconnected components while it lays out a hierarchy
 * (INCLUDE_CHILDREN), so a function nobody hands work to would otherwise sit
 * in the first layer, and every such function queues in one tall column.
 */
export function splitFirmComponents(graph: FirmGraph): FirmGraph[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const topOf = (id: string): string => {
    let current = byId.get(id);
    while (current?.parentId && byId.has(current.parentId)) {
      current = byId.get(current.parentId);
    }
    return current?.id ?? id;
  };

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const next = parent.get(id) ?? id;
    if (next === id) return id;
    const root = find(next);
    parent.set(id, root);
    return root;
  };
  for (const edge of graph.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    const a = find(topOf(edge.source));
    const b = find(topOf(edge.target));
    if (a !== b) parent.set(a, b);
  }

  const components = new Map<string, FirmGraph>();
  const componentOf = (id: string) => {
    const key = find(topOf(id));
    let component = components.get(key);
    if (!component) {
      component = { level: graph.level, nodes: [], edges: [] };
      components.set(key, component);
    }
    return component;
  };
  for (const node of graph.nodes) componentOf(node.id).nodes.push(node);
  for (const edge of graph.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    componentOf(edge.source).edges.push(edge);
  }
  return Array.from(components.values());
}

const PACKING_ASPECT_RATIO = 1.6;
const COMPONENT_GAP = 48;

/** A piece with no edges has no flow to show, so it packs as a compact grid. */
function toPackedElkTree(graph: FirmGraph): ElkNode {
  const tree = toElkTree(graph, { withEdges: false, withLabels: false });
  const packed = (node: ElkNode): ElkNode =>
    node.children
      ? {
          ...node,
          layoutOptions: {
            ...node.layoutOptions,
            "elk.algorithm": "rectpacking",
            "elk.aspectRatio": String(PACKING_ASPECT_RATIO),
            "elk.spacing.nodeNode": "20",
          },
          children: node.children.map(packed),
        }
      : node;
  return packed({
    ...tree,
    layoutOptions: { "elk.hierarchyHandling": "SEPARATE_CHILDREN" },
  });
}

async function layoutComponent(
  graph: FirmGraph,
  elk: Pick<ELK, "layout">,
  withLabels: boolean,
): Promise<FirmLayoutResult> {
  let laidOut: ElkNode;
  if (graph.edges.length === 0) {
    laidOut = await elk.layout(toPackedElkTree(graph));
  } else {
    try {
      laidOut = await elk.layout(
        toElkTree(graph, { withEdges: true, withLabels }),
      );
    } catch (error) {
      // A pathological hierarchy edge should cost the map its routed edges,
      // not the map itself. The canvas falls back to drawing its own curves.
      console.warn("Firm layout failed with edges; retrying without", error);
      laidOut = await elk.layout(
        toElkTree(graph, { withEdges: false, withLabels: false }),
      );
    }
  }
  const boxes = new Map<string, FirmLayoutBox>();
  collectBoxes(laidOut, boxes);
  return {
    boxes,
    routes: collectRoutes(laidOut),
    width: laidOut.width ?? 0,
    height: laidOut.height ?? 0,
  };
}

/**
 * Shelf-packs laid-out components into rows: the connected pieces first, since
 * that is where the handoffs are, then the rest in hierarchy order.
 */
function packComponents(
  components: Array<{ graph: FirmGraph; layout: FirmLayoutResult }>,
): FirmLayoutResult {
  const ordered = [
    ...components
      .filter((c) => c.graph.edges.length > 0)
      .sort(
        (a, b) =>
          b.layout.width * b.layout.height - a.layout.width * a.layout.height,
      ),
    ...components.filter((c) => c.graph.edges.length === 0),
  ];
  const totalArea = ordered.reduce(
    (sum, c) => sum + c.layout.width * c.layout.height,
    0,
  );
  const rowWidth = Math.max(
    ...ordered.map((c) => c.layout.width),
    Math.sqrt(totalArea * PACKING_ASPECT_RATIO),
  );

  const boxes = new Map<string, FirmLayoutBox>();
  const routes = new Map<string, FirmEdgeRoute>();
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;
  for (const { graph, layout } of ordered) {
    if (x > 0 && x + layout.width > rowWidth) {
      x = 0;
      y += rowHeight + COMPONENT_GAP;
      rowHeight = 0;
    }
    const topLevel = new Set(
      graph.nodes
        .filter((n) => !n.parentId || !layout.boxes.has(n.parentId))
        .map((n) => n.id),
    );
    for (const [id, box] of layout.boxes) {
      // Only top-level positions move; children are relative to their parent.
      boxes.set(id, topLevel.has(id) ? { ...box, x: box.x + x, y: box.y + y } : box);
    }
    for (const [id, route] of layout.routes) {
      routes.set(id, {
        points: route.points.map((p) => ({ x: p.x + x, y: p.y + y })),
        label: route.label
          ? { ...route.label, x: route.label.x + x, y: route.label.y + y }
          : undefined,
      });
    }
    width = Math.max(width, x + layout.width);
    rowHeight = Math.max(rowHeight, layout.height);
    x += layout.width + COMPONENT_GAP;
  }
  return { boxes, routes, width, height: y + rowHeight };
}

export async function layoutFirmGraph(
  graph: FirmGraph,
  elk: Pick<ELK, "layout">,
  options: { withLabels: boolean } = { withLabels: true },
): Promise<FirmLayoutResult> {
  const components = splitFirmComponents(graph);
  const laidOut = await Promise.all(
    components.map(async (component) => ({
      graph: component,
      layout: await layoutComponent(component, elk, options.withLabels),
    })),
  );
  return packComponents(laidOut);
}

/**
 * An SVG path through orthogonal bend points with rounded corners. The radius
 * shrinks on short segments so a corner never overshoots into the next bend.
 */
export function roundedOrthogonalPath(points: ElkPoint[], radius = 8): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  let path = `M ${first.x} ${first.y}`;
  for (let i = 0; i < rest.length; i += 1) {
    const current = rest[i];
    const next = rest[i + 1];
    if (!next) {
      path += ` L ${current.x} ${current.y}`;
      break;
    }
    const previous = i === 0 ? first : rest[i - 1];
    const inLength = Math.hypot(current.x - previous.x, current.y - previous.y);
    const outLength = Math.hypot(next.x - current.x, next.y - current.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    if (r <= 0) {
      path += ` L ${current.x} ${current.y}`;
      continue;
    }
    const before = {
      x: current.x - ((current.x - previous.x) / inLength) * r,
      y: current.y - ((current.y - previous.y) / inLength) * r,
    };
    const after = {
      x: current.x + ((next.x - current.x) / outLength) * r,
      y: current.y + ((next.y - current.y) / outLength) * r,
    };
    path += ` L ${before.x} ${before.y} Q ${current.x} ${current.y} ${after.x} ${after.y}`;
  }
  return path;
}

// @vitest-environment node
// ELK's bundled fake worker only exports itself outside worker-like globals;
// edge-runtime defines `self` without `document`, which looks like a worker.
import ELK from "elkjs/lib/elk.bundled.js";
import { describe, expect, it } from "vitest";
import type { FirmGraph, FirmGraphEdge, FirmGraphNode } from "./firm-graph";
import {
  FIRM_CONTAINER_HEADER,
  firmEdgeLabelText,
  layoutFirmGraph,
  roundedOrthogonalPath,
  type FirmLayoutBox,
  type FirmLayoutResult,
} from "./firm-layout";

function edge(
  source: string,
  target: string,
  label = "Work item",
  bidirectional = false,
): FirmGraphEdge {
  return {
    id: `${source}${bidirectional ? "<->" : "->"}${target}`,
    source,
    target,
    links: [],
    labels: [label],
    corroborated: false,
    confidence: "medium",
    proposed: true,
    bidirectional,
  };
}

const NODES: FirmGraphNode[] = [
  { id: "fn:ops", kind: "function", label: "Operations", container: true },
  { id: "fn:shared", kind: "function", label: "Shared", container: true },
  {
    id: "dept:support",
    kind: "department",
    label: "Support",
    parentId: "fn:ops",
    container: true,
  },
  {
    id: "dept:finance",
    kind: "department",
    label: "Finance",
    parentId: "fn:shared",
    container: true,
  },
  {
    id: "dept:legal",
    kind: "department",
    label: "Legal",
    parentId: "fn:shared",
    container: true,
  },
  {
    id: "proc:tickets",
    kind: "process",
    label: "Ticketing",
    parentId: "dept:support",
    container: false,
  },
  {
    id: "proc:billing",
    kind: "process",
    label: "Billing",
    parentId: "dept:finance",
    container: false,
  },
  {
    id: "outside",
    kind: "outside",
    label: "Outside the organisation",
    container: true,
  },
  {
    id: "ext:customer",
    kind: "external",
    label: "Customer",
    parentId: "outside",
    container: false,
  },
];

const GRAPH: FirmGraph = {
  level: "process",
  nodes: NODES,
  edges: [
    edge("ext:customer", "proc:tickets"),
    edge("proc:tickets", "proc:billing"),
    // Into an empty container, and into a whole function.
    edge("proc:billing", "dept:legal"),
    edge("proc:tickets", "fn:shared"),
  ],
};

/**
 * The shape from the first dev screenshot: one department exchanging work with
 * several outside parties, in both directions — the case where labels piled up
 * on top of cards and a back edge swung off the side of the map.
 */
const PROVIDERS = ["registrar", "database", "hosting", "models", "customer", "partner"];
const BUSY_GRAPH: FirmGraph = {
  level: "department",
  nodes: [
    { id: "fn:lt", kind: "function", label: "Learning Technology", container: true },
    { id: "dept:ai", kind: "department", label: "AI Transformation", parentId: "fn:lt", container: false },
    { id: "dept:axonify", kind: "department", label: "Axonify", parentId: "fn:lt", container: false },
    { id: "dept:laas", kind: "department", label: "LaaS", parentId: "fn:lt", container: false },
    { id: "outside", kind: "outside", label: "Outside the organisation", container: true },
    ...PROVIDERS.map((name) => ({
      id: `ext:${name}`,
      kind: "external" as const,
      label: name,
      parentId: "outside",
      container: false,
    })),
  ],
  edges: [
    edge("dept:ai", "ext:registrar", "Domain purchase before deployment"),
    edge("dept:ai", "ext:database", "Database schema to database provider"),
    edge("dept:ai", "ext:hosting", "App stack and logic to hosting provider"),
    edge("dept:ai", "ext:models", "AI model selection to model provider"),
    // Two-way exchanges, folded into one edge each by buildFirmGraph.
    edge("dept:axonify", "ext:customer", "Ticket redirected to manager or admin", true),
    edge("dept:axonify", "ext:partner", "Investigation findings and solution", true),
  ],
};

/** Functions nobody hands work to, alongside the busy part of the map. */
const ISOLATED = ["Teambuilding", "Shared Services", "Learning"];
const SPRAWLING_GRAPH: FirmGraph = {
  ...BUSY_GRAPH,
  nodes: [
    ...BUSY_GRAPH.nodes,
    ...ISOLATED.flatMap((name, i): FirmGraphNode[] => [
      { id: `fn:iso${i}`, kind: "function", label: name, container: true },
      ...[0, 1, 2].map((d) => ({
        id: `dept:iso${i}-${d}`,
        kind: "department" as const,
        label: `${name} team ${d}`,
        parentId: `fn:iso${i}`,
        container: false,
      })),
    ]),
  ],
};

function absoluteBoxes(graph: FirmGraph, result: FirmLayoutResult) {
  const parentOf = new Map(graph.nodes.map((n) => [n.id, n.parentId]));
  const absolute = new Map<string, FirmLayoutBox>();
  const resolve = (id: string): FirmLayoutBox => {
    const cached = absolute.get(id);
    if (cached) return cached;
    const box = result.boxes.get(id)!;
    const parent = parentOf.get(id);
    const origin = parent ? resolve(parent) : { x: 0, y: 0 };
    const value = { ...box, x: box.x + origin.x, y: box.y + origin.y };
    absolute.set(id, value);
    return value;
  };
  for (const node of graph.nodes) resolve(node.id);
  return absolute;
}

function overlaps(a: FirmLayoutBox, b: FirmLayoutBox): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function near(point: { x: number; y: number }, box: FirmLayoutBox, slack = 2) {
  return (
    point.x >= box.x - slack &&
    point.x <= box.x + box.width + slack &&
    point.y >= box.y - slack &&
    point.y <= box.y + box.height + slack
  );
}

describe("layoutFirmGraph", () => {
  it("lays out nested containers with cross-container edges", async () => {
    const result = await layoutFirmGraph(GRAPH, new ELK());
    for (const node of GRAPH.nodes) {
      expect(result.boxes.has(node.id)).toBe(true);
    }
    const finance = result.boxes.get("dept:finance")!;
    const billing = result.boxes.get("proc:billing")!;
    // Children are positioned relative to, and inside, their parent's frame.
    expect(billing.x + billing.width).toBeLessThanOrEqual(finance.width);
    expect(billing.y).toBeGreaterThanOrEqual(FIRM_CONTAINER_HEADER);
    // An empty department still gets a visible frame.
    expect(result.boxes.get("dept:legal")!.width).toBeGreaterThan(0);
    expect(result.width).toBeGreaterThan(0);
  });

  it("flows left to right along the handoffs", async () => {
    const result = await layoutFirmGraph(
      { ...GRAPH, edges: [edge("ext:customer", "proc:tickets")] },
      new ELK(),
    );
    expect(result.boxes.get("outside")!.x).toBeLessThan(
      result.boxes.get("fn:ops")!.x,
    );
  });

  it("routes every edge from its source to its target", async () => {
    for (const graph of [GRAPH, BUSY_GRAPH]) {
      const result = await layoutFirmGraph(graph, new ELK());
      const absolute = absoluteBoxes(graph, result);
      for (const e of graph.edges) {
        const route = result.routes.get(e.id);
        expect(route, e.id).toBeDefined();
        expect(route!.points.length).toBeGreaterThanOrEqual(2);
        expect(near(route!.points[0], absolute.get(e.source)!), e.id).toBe(true);
        expect(
          near(route!.points[route!.points.length - 1], absolute.get(e.target)!),
          e.id,
        ).toBe(true);
      }
    }
  });

  it("places labels clear of each other and of every card", async () => {
    const result = await layoutFirmGraph(BUSY_GRAPH, new ELK());
    const absolute = absoluteBoxes(BUSY_GRAPH, result);
    const labels = BUSY_GRAPH.edges.map((e) => result.routes.get(e.id)?.label);
    expect(labels.every(Boolean)).toBe(true);

    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        expect(overlaps(labels[i]!, labels[j]!), `labels ${i} and ${j}`).toBe(false);
      }
      for (const node of BUSY_GRAPH.nodes.filter((n) => !n.container)) {
        expect(overlaps(labels[i]!, absolute.get(node.id)!), `label ${i} on ${node.id}`).toBe(false);
      }
    }
  });

  it("keeps two-way exchanges next to their ends instead of looping round the map", async () => {
    const result = await layoutFirmGraph(SPRAWLING_GRAPH, new ELK());
    const absolute = absoluteBoxes(SPRAWLING_GRAPH, result);
    for (const e of SPRAWLING_GRAPH.edges) {
      const source = absolute.get(e.source)!;
      const target = absolute.get(e.target)!;
      const top = Math.min(source.y, target.y) - 40;
      const bottom = Math.max(source.y + source.height, target.y + target.height) + 40;
      for (const point of result.routes.get(e.id)!.points) {
        expect(point.y, e.id).toBeGreaterThanOrEqual(top);
        expect(point.y, e.id).toBeLessThanOrEqual(bottom);
      }
    }
  });

  it("tiles functions nobody hands work to instead of stacking them", async () => {
    const result = await layoutFirmGraph(SPRAWLING_GRAPH, new ELK());
    const isolated = ISOLATED.map((_, i) => result.boxes.get(`fn:iso${i}`)!);
    // Not one column: at least two share a row.
    expect(new Set(isolated.map((box) => box.y)).size).toBeLessThan(isolated.length);
    // Packed under or beside the busy part, never overlapping it.
    const busy = result.boxes.get("fn:lt")!;
    for (const box of isolated) expect(overlaps(box, busy)).toBe(false);
    // Departments inside an isolated function tile too, rather than one per row.
    const teams = [0, 1, 2].map((d) => result.boxes.get(`dept:iso0-${d}`)!);
    expect(new Set(teams.map((box) => box.y)).size).toBeLessThan(teams.length);
  });

  it("keeps a container at least as wide as its title", async () => {
    const result = await layoutFirmGraph(BUSY_GRAPH, new ELK());
    // "OUTSIDE THE ORGANISATION" in 11px uppercase was clipped at child width.
    expect(result.boxes.get("outside")!.width).toBeGreaterThanOrEqual(
      "Outside the organisation".length * 8,
    );
  });
});

describe("firmEdgeLabelText", () => {
  it("clips long labels and counts the rest", () => {
    expect(firmEdgeLabelText(edge("a", "b", "Short"))).toBe("Short");
    const long = firmEdgeLabelText({
      ...edge("a", "b", "An extremely long description of what moves here"),
      labels: ["An extremely long description of what moves here", "Second"],
    });
    expect(long).toMatch(/…\s\+1$/);
    expect(long!.length).toBeLessThanOrEqual(36);
  });
});

describe("roundedOrthogonalPath", () => {
  it("draws straight segments with rounded bends", () => {
    expect(
      roundedOrthogonalPath([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ]),
    ).toBe("M 0 0 L 92 0 Q 100 0 100 8 L 100 50");
  });

  it("never overshoots a short segment", () => {
    expect(
      roundedOrthogonalPath([
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 40 },
      ]),
    ).toBe("M 0 0 L 2 0 Q 4 0 4 2 L 4 40");
  });
});

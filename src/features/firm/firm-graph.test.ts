import { describe, expect, it } from "vitest";
import {
  buildFirmGraph,
  buildFirmModel,
  deptNodeId,
  extNodeId,
  firmStats,
  fnNodeId,
  focusNeighborhood,
  linksAcross,
  procNodeId,
  summarizeDepartment,
  type FirmMapData,
} from "./firm-graph";

type LinkInput = {
  id: string;
  source: string;
  direction: "outbound" | "inbound";
  counterparty:
    | { kind: "process"; processId: string }
    | { kind: "department"; departmentId: string }
    | { kind: "function"; functionId: string }
    | { kind: "external"; name: string };
  counterpartyKey: string;
  label?: string;
  confidence?: "high" | "medium" | "low";
  review?: "proposed" | "confirmed";
};

function data(links: LinkInput[]): FirmMapData {
  return {
    canManage: true,
    truncated: { processes: false, links: false },
    resolution: { queued: 0, resolving: 0, ready: 3, failed: 0, lastResolvedAt: 1 },
    functions: [
      { _id: "ops", name: "Operations" },
      { _id: "shared", name: "Shared Services" },
    ],
    departments: [
      { _id: "support", functionId: "ops", name: "Support" },
      { _id: "finance", functionId: "shared", name: "Finance" },
      { _id: "legal", functionId: "shared", name: "Legal" },
    ],
    processes: [
      {
        _id: "tickets",
        departmentId: "support",
        name: "Ticketing",
        owner: { membershipId: "m1", name: "Ada", jobTitle: null },
        mapped: true,
        resolutionStatus: "ready",
        roles: [],
      },
      {
        _id: "escalations",
        departmentId: "support",
        name: "Escalations",
        owner: null,
        mapped: true,
        resolutionStatus: "ready",
        roles: [],
      },
      {
        _id: "billing",
        departmentId: "finance",
        name: "Billing",
        owner: null,
        mapped: true,
        resolutionStatus: "ready",
        roles: [],
      },
    ],
    links: links.map((link) => ({
      _id: link.id,
      sourceProcessId: link.source,
      direction: link.direction,
      counterparty: link.counterparty,
      counterpartyKey: link.counterpartyKey,
      kind: "handoff",
      label: link.label ?? "Work item",
      nodeIds: [],
      evidence: [],
      contributors: [],
      confidence: link.confidence ?? "medium",
      origin: "ai",
      review: link.review ?? "proposed",
    })),
  } as unknown as FirmMapData;
}

const TICKETS_TO_BILLING: LinkInput = {
  id: "l1",
  source: "tickets",
  direction: "outbound",
  counterparty: { kind: "process", processId: "billing" },
  counterpartyKey: "process:billing",
  label: "Invoice query",
};
// Billing describes the same handoff from its side.
const BILLING_FROM_TICKETS: LinkInput = {
  id: "l2",
  source: "billing",
  direction: "inbound",
  counterparty: { kind: "process", processId: "tickets" },
  counterpartyKey: "process:tickets",
  label: "Billing escalation",
  confidence: "high",
};
const BILLING_TO_LEGAL: LinkInput = {
  id: "l3",
  source: "billing",
  direction: "outbound",
  counterparty: { kind: "department", departmentId: "legal" },
  counterpartyKey: "department:legal",
  label: "Disputed invoice",
};
const CUSTOMER_TO_TICKETS: LinkInput = {
  id: "l4",
  source: "tickets",
  direction: "inbound",
  counterparty: { kind: "external", name: "Customers" },
  counterpartyKey: "external:customer",
  label: "Support request",
};
const TICKETS_TO_OWN_DEPARTMENT: LinkInput = {
  id: "l5",
  source: "tickets",
  direction: "outbound",
  counterparty: { kind: "department", departmentId: "support" },
  counterpartyKey: "department:support",
};
const ESCALATIONS_FROM_TICKETS: LinkInput = {
  id: "l6",
  source: "escalations",
  direction: "inbound",
  counterparty: { kind: "process", processId: "tickets" },
  counterpartyKey: "process:tickets",
};

const ALL = [
  TICKETS_TO_BILLING,
  BILLING_FROM_TICKETS,
  BILLING_TO_LEGAL,
  CUSTOMER_TO_TICKETS,
  TICKETS_TO_OWN_DEPARTMENT,
  ESCALATIONS_FROM_TICKETS,
];

describe("buildFirmModel", () => {
  it("orients every link as work flows", () => {
    const model = buildFirmModel(data(ALL));
    const byId = new Map(model.links.map((l) => [l.link._id as string, l]));
    expect(byId.get("l1")).toMatchObject({
      from: procNodeId("tickets"),
      to: procNodeId("billing"),
    });
    expect(byId.get("l2")).toMatchObject({
      from: procNodeId("tickets"),
      to: procNodeId("billing"),
    });
    expect(byId.get("l4")).toMatchObject({
      from: extNodeId("external:customer"),
      to: procNodeId("tickets"),
    });
    expect(model.externals.get(extNodeId("external:customer"))?.name).toBe(
      "Customers",
    );
  });
});

describe("buildFirmGraph", () => {
  it("merges both sides of a handoff into one corroborated edge", () => {
    const graph = buildFirmGraph(buildFirmModel(data(ALL)), "process");
    const edge = graph.edges.find(
      (e) => e.source === procNodeId("tickets") && e.target === procNodeId("billing"),
    );
    expect(edge).toMatchObject({
      corroborated: true,
      confidence: "high",
      labels: ["Invoice query", "Billing escalation"],
    });
    expect(edge?.links).toHaveLength(2);
  });

  it("drops links internal to a container", () => {
    const processLevel = buildFirmGraph(buildFirmModel(data(ALL)), "process");
    expect(
      processLevel.edges.some((e) => e.target === deptNodeId("support")),
    ).toBe(false);

    // At department level, Ticketing → Escalations is inside Support.
    const departmentLevel = buildFirmGraph(buildFirmModel(data(ALL)), "department");
    expect(departmentLevel.edges.map((e) => e.id).sort()).toEqual(
      [
        `${deptNodeId("support")}->${deptNodeId("finance")}`,
        `${deptNodeId("finance")}->${deptNodeId("legal")}`,
        `${extNodeId("external:customer")}->${deptNodeId("support")}`,
      ].sort(),
    );
  });

  it("nests departments under functions and processes under departments", () => {
    const graph = buildFirmGraph(buildFirmModel(data(ALL)), "process");
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    expect(byId.get(procNodeId("billing"))?.parentId).toBe(deptNodeId("finance"));
    expect(byId.get(deptNodeId("finance"))).toMatchObject({
      parentId: fnNodeId("shared"),
      container: true,
    });
    expect(byId.get(extNodeId("external:customer"))?.parentId).toBe("outside");

    const departmentLevel = buildFirmGraph(buildFirmModel(data(ALL)), "department");
    expect(
      departmentLevel.nodes.find((n) => n.id === deptNodeId("finance"))?.container,
    ).toBe(false);
    expect(departmentLevel.nodes.some((n) => n.kind === "process")).toBe(false);
  });

  it("folds opposite handoffs into one two-way edge", () => {
    const BILLING_TO_TICKETS: LinkInput = {
      id: "l7",
      source: "billing",
      direction: "outbound",
      counterparty: { kind: "process", processId: "tickets" },
      counterpartyKey: "process:tickets",
      label: "Credit note",
    };
    const graph = buildFirmGraph(
      buildFirmModel(
        data([TICKETS_TO_BILLING, BILLING_FROM_TICKETS, BILLING_TO_TICKETS]),
      ),
      "process",
    );
    const between = graph.edges.filter(
      (e) =>
        [e.source, e.target].sort().join() ===
        [procNodeId("billing"), procNodeId("tickets")].sort().join(),
    );
    expect(between).toHaveLength(1);
    // Kept in the dominant direction: two links run Ticketing → Billing.
    expect(between[0]).toMatchObject({
      source: procNodeId("tickets"),
      target: procNodeId("billing"),
      bidirectional: true,
      labels: ["Invoice query", "Billing escalation", "Credit note"],
    });
    expect(between[0].links).toHaveLength(3);
  });

  it("leads a tied exchange from inside the organisation", () => {
    const graph = buildFirmGraph(
      buildFirmModel(
        data([
          // Inbound first, so first-seen order would point it outward-in.
          CUSTOMER_TO_TICKETS,
          {
            id: "l11",
            source: "tickets",
            direction: "outbound",
            counterparty: { kind: "external", name: "Customer" },
            counterpartyKey: "external:customer",
          },
        ]),
      ),
      "process",
    );
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      source: procNodeId("tickets"),
      target: extNodeId("external:customer"),
      bidirectional: true,
    });
  });

  it("does not call two opposite handoffs agreement", () => {
    // Ticketing reports work to Customer; Billing reports work back from
    // Customer. Different processes, opposite directions: no corroboration.
    const graph = buildFirmGraph(
      buildFirmModel(
        data([
          CUSTOMER_TO_TICKETS,
          {
            id: "l9",
            source: "billing",
            direction: "outbound",
            counterparty: { kind: "external", name: "Customers" },
            counterpartyKey: "external:customer",
          },
          {
            id: "l10",
            source: "tickets",
            direction: "outbound",
            counterparty: { kind: "external", name: "Customer" },
            counterpartyKey: "external:customer",
          },
        ]),
      ),
      "department",
    );
    const support = graph.edges.find(
      (e) => e.bidirectional && [e.source, e.target].includes(deptNodeId("support")),
    );
    expect(support).toBeDefined();
    expect(support!.corroborated).toBe(false);
  });

  it("only marks an edge proposed while every link is unreviewed", () => {
    const graph = buildFirmGraph(
      buildFirmModel(
        data([TICKETS_TO_BILLING, { ...BILLING_FROM_TICKETS, review: "confirmed" }]),
      ),
      "process",
    );
    expect(graph.edges[0].proposed).toBe(false);
  });
});

describe("focusNeighborhood", () => {
  it("lights a container's contents and everything they connect to", () => {
    const graph = buildFirmGraph(buildFirmModel(data(ALL)), "process");
    const focus = focusNeighborhood(graph, deptNodeId("finance"));
    expect(focus.nodeIds.has(procNodeId("billing"))).toBe(true);
    expect(focus.nodeIds.has(procNodeId("tickets"))).toBe(true);
    expect(focus.nodeIds.has(deptNodeId("legal"))).toBe(true);
    expect(focus.nodeIds.has(extNodeId("external:customer"))).toBe(false);
    expect(focus.edgeIds.size).toBe(2);
  });
});

describe("linksAcross and summaries", () => {
  it("counts only links that cross the boundary", () => {
    const model = buildFirmModel(data(ALL));
    const support = linksAcross(model, deptNodeId("support"));
    expect(support.outbound.map((l) => l.link._id).sort()).toEqual(["l1", "l2"]);
    expect(support.inbound.map((l) => l.link._id)).toEqual(["l4"]);
    expect(summarizeDepartment(model, "support")).toEqual({
      processCount: 2,
      mappedCount: 2,
      unownedCount: 1,
      inboundCount: 1,
      outboundCount: 2,
    });
  });

  it("flags departments others depend on that nobody has mapped", () => {
    const stats = firmStats(buildFirmModel(data(ALL)));
    expect(stats.gaps).toEqual([
      { departmentId: "legal", name: "Legal", inboundCount: 1, reason: "empty" },
    ]);
    expect(stats).toMatchObject({
      processCount: 3,
      mappedCount: 3,
      unownedCount: 2,
      externalCount: 1,
    });
    // Tickets→Billing (2 links), Billing→Legal, Customer→Tickets,
    // Tickets→Escalations; the link into its own department is not a handoff.
    expect(stats.handoffCount).toBe(5);
    expect(stats.crossDepartmentCount).toBe(3);
  });
});

import { describe, expect, it } from "vitest";
import { isWithinTimeBudget } from "./aiProvider";
import {
  buildFirmCatalog,
  buildFirmLinksAIRequest,
  buildFirmLinksUserContent,
  deriveProcessRoles,
  FIRM_LINK_CAPS,
  FIRM_LINKS_MAX_RETRIES,
  FIRM_LINKS_MAX_TOKENS,
  FIRM_LINKS_TIMEOUT_MS,
  firmCounterpartyKey,
  hasResolvableSignal,
  normalizeExternalName,
  normalizeFirmLinks,
} from "./firmLinks";

const HIERARCHY = {
  functions: [
    { id: "fn_ops", name: "Operations" },
    { id: "fn_shared", name: "Shared Services" },
  ],
  departments: [
    { id: "d_support", name: "Support", functionId: "fn_ops" },
    { id: "d_finance", name: "Finance", functionId: "fn_shared" },
    { id: "d_orphan", name: "Orphan", functionId: "fn_missing" },
  ],
  processes: [
    { id: "p_tickets", name: "Ticketing", departmentId: "d_support" },
    { id: "p_billing", name: "Billing", departmentId: "d_finance" },
  ],
};

function catalog() {
  return buildFirmCatalog({ ...HIERARCHY, sourceProcessId: "p_tickets" });
}

function normalize(links: unknown[], contributors = ["Aisha", "Ben"]) {
  return normalizeFirmLinks(
    { links },
    {
      catalog: catalog(),
      sourceProcessId: "p_tickets",
      knownNodeIds: ["n1", "n2"],
      knownContributors: contributors,
    },
  );
}

const BASE = {
  direction: "outbound",
  kind: "handoff",
  label: "Escalated invoice query",
  nodeIds: ["n1"],
  evidence: ["We pass billing questions to Finance"],
  contributors: ["Aisha"],
  confidence: "medium",
};

describe("budget", () => {
  it("fits its timeout at the worst measured throughput", () => {
    expect(isWithinTimeBudget(FIRM_LINKS_MAX_TOKENS, FIRM_LINKS_TIMEOUT_MS)).toBe(
      true,
    );
  });

  it("fits every attempt inside the 10-minute action ceiling", () => {
    expect((1 + FIRM_LINKS_MAX_RETRIES) * FIRM_LINKS_TIMEOUT_MS).toBeLessThan(
      600_000,
    );
  });

  it("asks for the budgeted request shape", () => {
    const request = buildFirmLinksAIRequest("{}");
    expect(request.maxTokens).toBe(FIRM_LINKS_MAX_TOKENS);
    expect(request.tool.name).toBe("return_firm_links");
    expect(request.system).toContain("untrustedEvidence");
  });
});

describe("buildFirmCatalog", () => {
  it("keys entries in hierarchy order and drops orphans", () => {
    const result = catalog();
    expect(result.functions.map((f) => f.key)).toEqual(["F1", "F2"]);
    expect(result.departments.map((d) => d.name)).toEqual(["Support", "Finance"]);
    expect(result.processes.map((p) => [p.key, p.departmentKey])).toEqual([
      ["P1", "D1"],
      ["P2", "D2"],
    ]);
    expect(result.truncated).toBe(false);
  });

  it("keeps the source process when the catalog is capped", () => {
    const many = Array.from(
      { length: FIRM_LINK_CAPS.catalogProcesses + 5 },
      (_, i) => ({ id: `p_${i}`, name: `Process ${i}`, departmentId: "d_support" }),
    );
    const source = many[many.length - 1];
    const result = buildFirmCatalog({
      ...HIERARCHY,
      processes: many,
      sourceProcessId: source.id,
    });
    expect(result.processes).toHaveLength(FIRM_LINK_CAPS.catalogProcesses);
    expect(result.processes.some((p) => p.id === source.id)).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("never puts ids in the prompt", () => {
    const content = buildFirmLinksUserContent({
      catalog: catalog(),
      sourceProcessId: "p_tickets",
      steps: [],
      dependencyMentions: [],
    });
    expect(content).not.toContain("p_billing");
    expect(content).not.toContain("d_finance");
    expect(JSON.parse(content).untrustedEvidence.sourceProcess.key).toBe("P1");
  });
});

describe("normalizeFirmLinks", () => {
  it("maps catalog keys back to ids", () => {
    const [toProcess, toDepartment, toFunction] = normalize([
      { ...BASE, counterparty: "P2" },
      { ...BASE, direction: "inbound", counterparty: "d2" },
      { ...BASE, counterparty: "F1" },
    ]);
    expect(toProcess.counterparty).toEqual({
      kind: "process",
      processId: "p_billing",
    });
    expect(toProcess.counterpartyKey).toBe("process:p_billing");
    expect(toDepartment.counterparty).toEqual({
      kind: "department",
      departmentId: "d_finance",
    });
    expect(toFunction.counterparty).toEqual({
      kind: "function",
      functionId: "fn_ops",
    });
  });

  it("drops invented keys, self-links, and nameless externals", () => {
    expect(
      normalize([
        { ...BASE, counterparty: "P99" },
        { ...BASE, counterparty: "P1" },
        { ...BASE, counterparty: "EXTERNAL" },
        { ...BASE, counterparty: "EXTERNAL", externalName: "  " },
        { ...BASE, counterparty: "P2", direction: "sideways" },
        { ...BASE, counterparty: "P2", label: "" },
      ]),
    ).toEqual([]);
  });

  it("keeps only known step ids and known contributors", () => {
    const [link] = normalize([
      {
        ...BASE,
        counterparty: "EXTERNAL",
        externalName: "Axonify Canada",
        nodeIds: ["n1", "invented"],
        contributors: ["aisha", "Someone Else"],
      },
    ]);
    expect(link.nodeIds).toEqual(["n1"]);
    expect(link.contributors).toEqual(["Aisha"]);
    expect(link.counterpartyKey).toBe("external:axonify canada");
  });

  it("merges repeated mentions of one counterparty and direction", () => {
    const links = normalize([
      { ...BASE, counterparty: "P2", kind: "dependency", confidence: "low" },
      {
        ...BASE,
        counterparty: "P2",
        nodeIds: ["n2"],
        evidence: ["Finance owns the credit note"],
        contributors: ["Ben"],
        confidence: "high",
      },
    ]);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      kind: "handoff",
      confidence: "high",
      nodeIds: ["n1", "n2"],
      contributors: ["Aisha", "Ben"],
    });
    expect(links[0].evidence).toHaveLength(2);
  });

  it("degrades drifting fields instead of failing", () => {
    const [link] = normalize([
      {
        counterparty: "P2",
        direction: "inbound",
        label: "x".repeat(500),
        kind: "nonsense",
        confidence: "certain",
        evidence: "not an array",
      },
    ]);
    expect(link.kind).toBe("handoff");
    expect(link.confidence).toBe("medium");
    expect(link.evidence).toEqual([]);
    expect(link.label.length).toBeLessThanOrEqual(FIRM_LINK_CAPS.labelChars);
  });

  it("caps the number of links", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...BASE,
      counterparty: "EXTERNAL",
      externalName: `Vendor number ${i}`,
    }));
    expect(normalize(many)).toHaveLength(FIRM_LINK_CAPS.linksPerProcess);
  });

  it("tolerates a missing payload", () => {
    expect(
      normalizeFirmLinks(null, {
        catalog: catalog(),
        sourceProcessId: "p_tickets",
        knownNodeIds: [],
        knownContributors: [],
      }),
    ).toEqual([]);
  });
});

describe("normalizeExternalName", () => {
  it("collapses case, punctuation, and simple plurals", () => {
    expect(normalizeExternalName(" Customers. ")).toBe("customer");
    expect(normalizeExternalName("customer")).toBe("customer");
    expect(normalizeExternalName("Business")).toBe("business");
    expect(normalizeExternalName("AT&T")).toBe("at&t");
    expect(firmCounterpartyKey({ kind: "external", name: "The Customers" })).toBe(
      "external:the customer",
    );
  });
});

describe("deriveProcessRoles", () => {
  it("counts each role once per step, most active first", () => {
    expect(
      deriveProcessRoles([
        { actors: ["Support agent", "support agent "] },
        { actors: ["Team lead", "Support agent"] },
        { actors: [""] },
      ]),
    ).toEqual([
      { name: "Support agent", stepCount: 2 },
      { name: "Team lead", stepCount: 1 },
    ]);
  });
});

describe("hasResolvableSignal", () => {
  it("needs a handoff step or contributor dependency evidence", () => {
    expect(
      hasResolvableSignal({ steps: [{ category: "action" }], dependencyMentions: [] }),
    ).toBe(false);
    expect(
      hasResolvableSignal({ steps: [{ category: "handoff" }], dependencyMentions: [] }),
    ).toBe(true);
    expect(
      hasResolvableSignal({
        steps: [],
        dependencyMentions: [{ contributor: "Aisha", text: "Finance approves" }],
      }),
    ).toBe(true);
  });
});

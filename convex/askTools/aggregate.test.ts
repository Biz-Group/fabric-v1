/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import type { FlowNode, ProcessFlow } from "../lib/insightsDerivations";
import { isManualRework, mentions, normalizeKey, termOverlap } from "../lib/askNormalize";
import type { ConversationEvidence, ScopeEvidence } from "./evidence";
import { matchHandoffs, matchUsage } from "./graph";
import { HELP_ARTICLES } from "./helpCorpus.generated";
import { buildHelpCorpus, gatedIds, renderHelpCorpusModule } from "./helpCorpusBuild";
import { rankHelpArticles } from "./help";
import { affectedProcesses, collectSignals, scoreOf, SIGNALS } from "./signals";
import { findDuplicationCandidates, summarizeSystems } from "./systems";

// ---- Fixtures ------------------------------------------------------------------

function node(id: string, overrides: Partial<FlowNode> = {}): FlowNode {
  return {
    id,
    label: id,
    category: "action",
    description: "",
    actors: [],
    tools: [],
    painPoints: [],
    automationPotential: "none",
    confidence: "medium",
    isBottleneck: false,
    isTribalKnowledge: false,
    riskIndicators: [],
    sources: [],
    detailStatus: "ready",
    detailErrorMessage: undefined,
    ...overrides,
  };
}

function process(id: string, name: string): Doc<"processes"> {
  return { _id: id as Id<"processes">, _creationTime: 0, name, departmentId: "d" as Id<"departments">, sortOrder: 0, clerkOrgId: "org" } as Doc<"processes">;
}

function flowFor(p: Doc<"processes">, nodes: FlowNode[], edges: Array<[string, string]> = []) {
  const flow = {
    processId: p._id,
    status: "ready",
    nodes,
    edges: edges.map(([source, target], i) => ({ id: `e${i}`, source, target, type: "sequential", isHappyPath: true })),
    insights: { criticalPath: [], handoffCount: 0, toolCount: 0, automationOpportunities: [], topBottlenecks: [] },
  } as unknown as ProcessFlow;
  return { process: p, flow, nodes };
}

function contribution(p: Doc<"processes">, id: string, who: string, evidence: Partial<ConversationEvidence>) {
  return {
    conversation: { _id: id as Id<"conversations">, _creationTime: 0, processId: p._id, contributorName: who, status: "done", clerkOrgId: "org" } as Doc<"conversations">,
    evidence: {
      steps: [],
      actors: [],
      tools: [],
      handoffsAndDependencies: [],
      reportedVariations: [],
      frictionPoints: [],
      uncertainties: [],
      ...evidence,
    } as ConversationEvidence,
  };
}

function evidence(flows: ReturnType<typeof flowFor>[], contributions: ReturnType<typeof contribution>[] = []): ScopeEvidence {
  const processById = new Map<Id<"processes">, Doc<"processes">>();
  for (const f of flows) processById.set(f.process._id, f.process);
  for (const c of contributions) processById.set(c.conversation.processId, processById.get(c.conversation.processId) ?? process(c.conversation.processId, "P"));
  return { processById, flows, contributions, capped: false };
}

const dispatch = process("p_dispatch", "Dispatch scheduling");
const close = process("p_close", "Month-end close");
const onboarding = process("p_onboard", "Employee onboarding");

// ---- Normalisation -------------------------------------------------------------

describe("normalisation (1C.1)", () => {
  test("merges case, punctuation and spacing, but not different words", () => {
    expect(normalizeKey("  Re-keying into the ERP. ")).toBe(normalizeKey("re-keying into the erp"));
    expect(normalizeKey("Re-keying into SAP")).not.toBe(normalizeKey("Re-keying into the ERP"));
    expect(normalizeKey("“Smart” quotes")).toBe("smart quotes");
    expect(normalizeKey("Ana’s queue")).toBe(normalizeKey("ana's queue"));
  });

  test("matches names as whole words", () => {
    expect(mentions("Hand over to Finance team", "finance")).toBe(true);
    expect(mentions("Financed by the bank", "finance")).toBe(false);
    expect(mentions("ERPNext export", "ERP")).toBe(false);
  });

  test("scores label overlap on content words", () => {
    expect(termOverlap("Approve the purchase order", "Purchase order approval")).toBeGreaterThan(0.3);
    expect(termOverlap("Ship goods", "Approve invoice")).toBe(0);
  });

  test.each([
    ["Orders are re-keyed into the ERP", true],
    ["We copy and paste totals into the deck", true],
    ["Manual data entry from paper forms", true],
    ["Duplicate entry in two systems", true],
    ["Approvals take three days", false],
    ["The keyboard is old", false],
  ])("manualRework heuristic: %s → %s", (text, expected) => {
    expect(isManualRework(text)).toBe(expected);
  });
});

// ---- T15 -----------------------------------------------------------------------

describe("rankSignals scoring (FR-1.14)", () => {
  const scope = evidence(
    [
      flowFor(dispatch, [
        node("a", { label: "Build schedule", isBottleneck: true, confidence: "high", painPoints: ["Re-keying into the ERP"], sources: ["Ana, Conv. 1", "Bo, Conv. 2"] }),
        node("b", { label: "Load truck", actors: ["Driver"] }),
      ]),
      flowFor(close, [node("c", { label: "Post accruals", painPoints: ["re-keying into the ERP."], sources: ["Cy, Conv. 3"] })]),
    ],
    [contribution(onboarding, "k1", "Dee", { frictionPoints: ["Laptops arrive late"] })],
  );
  const ranked = collectSignals(new Set(SIGNALS), scope, []);

  test("merges identical friction text across processes and scores it", () => {
    const friction = ranked.get("friction")!;
    const rekey = friction.find((item) => normalizeKey(item.text) === normalizeKey("Re-keying into the ERP"))!;
    expect(rekey.processes.size).toBe(2);
    expect(rekey.contributors).toEqual(new Set(["ana", "bo", "cy"]));
    // 3 × 2 processes + 2 × 3 contributors + corroborated (3).
    expect(scoreOf(rekey)).toBe(15);
    expect(friction[0]).toBe(rekey);
    expect(rekey.refs.length).toBe(2);
  });

  test("ties break by name, and manualRework is flagged as heuristic", () => {
    const rework = ranked.get("manualRework")!;
    expect(rework).toHaveLength(1);
    expect(rework[0].heuristic).toBe(true);
    const single = collectSignals(
      new Set(["friction"] as const),
      evidence([], [contribution(dispatch, "x1", "Ann", { frictionPoints: ["Zebra issue", "Alpha issue"] })]),
      [],
    ).get("friction")!;
    expect(single.map((item) => item.text)).toEqual(["Alpha issue", "Zebra issue"]);
  });

  test("only collects the signals asked for", () => {
    const onlyBottlenecks = collectSignals(new Set(["bottleneck"] as const), scope, []);
    expect([...onlyBottlenecks.keys()]).toEqual(["bottleneck"]);
    expect(onlyBottlenecks.get("bottleneck")![0].text).toBe("Build schedule");
  });
});

// ---- T16, T11 ------------------------------------------------------------------

describe("systems and graph matching", () => {
  const scope = evidence(
    [
      flowFor(dispatch, [
        node("a", { label: "Plan", actors: ["Planner"], tools: ["Excel"], painPoints: ["Orders are re-keyed into the ERP"], automationPotential: "high" }),
        node("b", { label: "Send to Finance", category: "handoff", actors: ["Finance team"], tools: ["ERP"] }),
      ], [["a", "b"]]),
      flowFor(close, [node("c", { label: "Reconcile", actors: ["Accountant"], tools: ["excel"] })]),
    ],
    [contribution(onboarding, "k1", "Dee", { tools: ["Workday"], handoffsAndDependencies: ["HR hands joiners to IT"] })],
  );

  test("T16 ranks systems by evidenced friction and merges names", () => {
    const systems = summarizeSystems(scope);
    expect(systems[0].name).toBe("Excel");
    expect(systems[0].processes.size).toBe(2);
    expect(systems[0].rekeying).toHaveLength(1);
    expect(systems[0].automation).toBe("high");
    expect(systems.map((s) => s.name)).toContain("Workday");
  });

  test("T11 finds handoffs to a party in flows and in contribution evidence", () => {
    const finance = matchHandoffs(scope, "Finance");
    expect(finance.map((p) => p.processName)).toEqual(["Dispatch scheduling"]);
    expect(finance[0].matches[0].text).toContain("hands off to Finance");
    expect(matchHandoffs(scope, "IT")[0].matches[0].source).toBe("fabric:conversation/p_onboard/k1");
    expect(matchHandoffs(scope, "Legal")).toEqual([]);
  });

  test("T11 finds processes by tool, by actor and by both", () => {
    expect(matchUsage(scope, "Excel", null).map((p) => p.processName).sort()).toEqual(["Dispatch scheduling", "Month-end close"]);
    expect(matchUsage(scope, null, "Accountant").map((p) => p.processName)).toEqual(["Month-end close"]);
    expect(matchUsage(scope, "Excel", "Planner").map((p) => p.processName)).toEqual(["Dispatch scheduling"]);
  });
});

// ---- T17 -----------------------------------------------------------------------

describe("findSimilarWork first pass (FR-1.19)", () => {
  const scope = evidence(
    [
      flowFor(dispatch, [
        node("a", { label: "Approve purchase order", actors: ["Planner"], tools: ["SAP"], painPoints: ["Approvals wait for the manager"] }),
        node("b", { label: "Pay", actors: ["Finance"] }),
      ], [["a", "b"]]),
      flowFor(close, [
        node("c", { label: "Purchase order approval", actors: ["Planner"], tools: ["sap"], painPoints: ["approvals wait for the manager."] }),
        node("d", { label: "Book", actors: ["Finance"] }),
      ], [["c", "d"]]),
      flowFor(onboarding, [node("e", { label: "Create account", tools: ["SAP"] })]),
    ],
  );
  const candidates = findDuplicationCandidates(scope);

  test("finds the same system on a similar step, but not on an unrelated one", () => {
    const step = candidates.filter((c) => c.pattern === "sameSystemSimilarStep");
    expect(step).toHaveLength(1);
    expect(step[0].processes).toEqual(new Set(["p_dispatch", "p_close"]));
    expect(step[0].places.map((p) => p.source)).toEqual([
      "fabric:flow-node/p_dispatch/a",
      "fabric:flow-node/p_close/c",
    ]);
  });

  test("finds the same handoff pair and the same friction text", () => {
    expect(candidates.some((c) => c.pattern === "sameHandoff" && c.text === "Planner hands work to Finance")).toBe(true);
    const friction = candidates.find((c) => c.pattern === "sameFriction")!;
    expect(friction.processes.size).toBe(2);
  });

  test("ignores patterns confined to one process", () => {
    const single = findDuplicationCandidates(evidence([flowFor(dispatch, [node("x", { painPoints: ["Slow"] }), node("y", { painPoints: ["Slow"] })])]));
    expect(single).toEqual([]);
  });
});

// ---- T14 -----------------------------------------------------------------------

const helpFiles = import.meta.glob("/src/content/help/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const generatedModule = Object.values(
  import.meta.glob("./helpCorpus.generated.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>,
)[0];

const BODY = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
function article(id: string, audience = "[viewer, contributor, admin]") {
  return `---\nid: ${id}\ntitle: Title ${id}\nsummary: Summary ${id}\naudience: ${audience}\ntags: [a]\nrelated: []\nverifiedAgainst:\n  - src/x.tsx\n---\n\n${BODY}\n`;
}

describe("help corpus (FR-1.18)", () => {
  test("the committed module matches a fresh build", () => {
    const files = Object.fromEntries(Object.entries(helpFiles).map(([path, text]) => [path.split("/").pop()!, text]));
    const fresh = renderHelpCorpusModule(buildHelpCorpus(files, files["REVIEW-NOTES.md"] ?? ""));
    expect(generatedModule.replace(/\r\n/g, "\n")).toBe(fresh);
  });

  test("an article with a REVIEW-NOTES section is excluded; other headings are ignored", () => {
    const notes = "# Review notes\n\n## General\n- x\n\n## under-review\n- open item\n\n## Resolved\n";
    expect(gatedIds(notes, new Set(["under-review", "fine"]))).toEqual(new Set(["under-review"]));
    const built = buildHelpCorpus({ "under-review.md": "not even valid", "fine.md": article("fine") }, notes);
    expect(built.articles.map((a) => a.id)).toEqual(["fine"]);
    expect(built.excluded).toEqual(["under-review"]);
  });

  test("validation rejects a short body, a bad audience and a mismatched id", () => {
    expect(() => buildHelpCorpus({ "a.md": article("a").replace(BODY, "too short") }, "")).toThrow(/words/);
    expect(() => buildHelpCorpus({ "a.md": article("a", "[everyone]") }, "")).toThrow(/audience/);
    expect(() => buildHelpCorpus({ "a.md": article("b") }, "")).toThrow(/does not match/);
  });

  test("search ranks by keyword and filters by the caller's role", () => {
    const forViewer = rankHelpArticles(HELP_ARTICLES, "label speakers", "viewer");
    const forContributor = rankHelpArticles(HELP_ARTICLES, "label speakers", "contributor");
    // Speaker labelling is written for contributors and admins only.
    expect(forViewer.some((hit) => hit.article.id === "label-speakers")).toBe(false);
    expect(forContributor[0].article.id).toBe("label-speakers");
    expect(rankHelpArticles(HELP_ARTICLES, "on behalf", "contributor").some((h) => h.article.id === "contribute-on-behalf")).toBe(false);
    expect(HELP_ARTICLES.some((a) => a.id === "insights-and-recommendations")).toBe(false);
  });
});

describe("gap attribution", () => {
  const covered = ["p1", "p2", "p3"];
  const byDept = new Map([["d1", ["p1", "p2"]], ["d2", ["p3"]]]);

  test("a rollup gap counts the processes it cites, not the whole subtree", () => {
    expect(affectedProcesses([{ kind: "process", processId: "p2" as Id<"processes">, label: "P2" }], covered, byDept)).toEqual(["p2"]);
    expect(affectedProcesses([{ kind: "department", departmentId: "d1" as Id<"departments">, label: "D1" }], covered, byDept)).toEqual(["p1", "p2"]);
  });

  test("falls back to every covered process when the finding cites neither", () => {
    expect(affectedProcesses([{ kind: "conversation", conversationId: "c1" as Id<"conversations">, label: "Ana" }], covered, byDept)).toEqual(covered);
  });
});

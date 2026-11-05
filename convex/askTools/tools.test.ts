/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { authErrorCode } from "../lib/authErrors";
import {
  deriveHandoffs,
  deriveKeyFindings,
  type ProcessFlow,
} from "../lib/insightsDerivations";
import { SUMMARY_V2_PROMPT_VERSIONS, type ProcessOverviewArtifactV2 } from "../summaryV2";
import { ASK_TOOLS, getAskTool } from "./catalog";
import { parseFabricSource, RESULT_DETAILS_SOURCE, type AskToolResult } from "./results";

// Root-anchored: a relative glob keys this folder's own files as "./x.ts",
// which convex-test cannot map to "askTools/x".
const modules = import.meta.glob("/convex/**/*.ts");
const ORG_A = "org_ask_tools_a";
const ORG_B = "org_ask_tools_b";
const ISSUER = "https://ask-tools.test";
const originalSummaryV2 = process.env.SUMMARY_V2;

const NOW = Date.UTC(2026, 9, 20);

function processArtifact(orgLabel: string): ProcessOverviewArtifactV2 {
  const finding = (id: string, title: string) => ({
    id,
    title,
    body: `${title} body for ${orgLabel}.`,
    evidenceLevel: "corroborated" as const,
    supportCount: 2,
    sources: [],
  });
  return {
    schemaVersion: "v2",
    sourceMode: "interview_evidence",
    headline: `Dispatch runs on spreadsheets (${orgLabel})`,
    executiveBrief: "The morning schedule is re-keyed from Excel into the ERP.",
    scope: [finding("scope-1", "Trigger is the morning order cut")],
    consensus: [],
    variations: [],
    gaps: [finding("gap-1", "No owner for order exceptions")],
    notable: [],
    coverage: { includedSources: 1, totalEligibleSources: 1, uniqueContributors: 1, complete: true },
    provenance: {
      sourceSnapshotHash: "hash",
      generatedAt: NOW - 86_400_000,
      promptVersion: SUMMARY_V2_PROMPT_VERSIONS.processOverview,
      provider: "fabric-foundry",
      model: "test-model",
    },
  };
}

const NODE = {
  description: "Schedule is re-keyed",
  actors: ["Planner"],
  tools: ["Excel", "ERP"],
  painPoints: ["Re-keying takes an hour"],
  automationPotential: "high" as const,
  confidence: "high" as const,
  isBottleneck: false,
  isTribalKnowledge: false,
  riskIndicators: [],
  sources: ["Ana, Conv. 1"],
};

async function seedOrg(ctx: MutationCtx, orgId: string, label: string) {
  const functionId = await ctx.db.insert("functions", { name: `Operations ${label}`, sortOrder: 0, clerkOrgId: orgId });
  const departmentId = await ctx.db.insert("departments", { functionId, name: `Dispatch ${label}`, sortOrder: 0, clerkOrgId: orgId });
  const processId = await ctx.db.insert("processes", {
    departmentId,
    name: `Dispatch scheduling ${label}`,
    sortOrder: 0,
    clerkOrgId: orgId,
    summaryV2: processArtifact(label),
    summaryV2SourceRevision: 0,
    rollingSummary: `# Legacy overview for ${label}`,
    summaryUpdatedAt: NOW - 86_400_000,
  });
  const emptyProcessId = await ctx.db.insert("processes", {
    departmentId,
    name: `Returns ${label}`,
    sortOrder: 1,
    clerkOrgId: orgId,
  });
  const conversationId = await ctx.db.insert("conversations", {
    processId,
    contributorName: `Ana ${label}`,
    status: "done",
    title: `Morning schedule walkthrough ${label}`,
    durationSeconds: 900,
    clerkOrgId: orgId,
    summary: "Ana explains the morning schedule.",
    transcript: Array.from({ length: 60 }, (_, i) => ({
      role: i % 2 ? "user" : "ai",
      content: i === 41 ? "Then finance approves the purchase order" : `Line ${i + 1} of the walkthrough`,
      time_in_call_secs: i * 10,
    })),
    processSummaryEvidenceV2: {
      schemaVersion: "v2",
      sourceMode: "interview_evidence",
      steps: [{ id: "s1", title: "Build schedule", body: "Planner builds it in Excel." }],
      actors: ["Planner"],
      tools: ["Excel", "ERP"],
      handoffsAndDependencies: ["Planning to dispatch over WhatsApp"],
      reportedVariations: [],
      frictionPoints: ["Re-keying into the ERP"],
      uncertainties: [],
      transcriptHash: "t",
      promptVersion: "p",
      generatedAt: NOW,
      provider: "fabric-foundry",
      model: "test-model",
    },
  });
  await ctx.db.insert("conversations", {
    processId,
    contributorName: `Ben ${label}`,
    status: "processing",
    clerkOrgId: orgId,
    // convex-test tokenizes every row in a search query, so every row needs
    // the searched fields (see verification-baseline notes).
    title: `Returns intake ${label}`,
    summary: "Not analysed yet.",
  });
  await ctx.db.insert("processFlows", {
    processId,
    status: "ready",
    stale: false,
    generatedAt: NOW,
    conversationCount: 1,
    nodes: [
      { id: "plan", label: "Build schedule", category: "start", ...NODE, isBottleneck: true },
      { id: "rekey", label: "Re-key into ERP", category: "action", ...NODE, actors: ["Clerk"], isTribalKnowledge: true },
      { id: "ship", label: "Dispatch", category: "end", ...NODE, actors: ["Driver"], painPoints: [] },
    ],
    edges: [
      { id: "e1", source: "plan", target: "rekey", type: "sequential", isHappyPath: true },
      { id: "e2", source: "rekey", target: "ship", type: "sequential", isHappyPath: true },
    ],
    insights: {
      criticalPath: ["plan", "rekey", "ship"],
      handoffCount: 2,
      toolCount: 2,
      automationOpportunities: ["Import the schedule"],
      automationOpportunityDetails: [
        {
          title: "Import the schedule into the ERP",
          kind: "integration",
          nodeIds: ["rekey"],
          rationale: "The same rows are typed twice.",
          prerequisites: [],
          confidence: "high",
        },
      ],
      automationOpportunitiesSource: "ai",
      topBottlenecks: ["Build schedule"],
    },
    clerkOrgId: orgId,
  });
  // A second flow sharing a system and a pain point, so duplication has a
  // cross-process candidate. Its process still has no completed contribution.
  await ctx.db.insert("processFlows", {
    processId: emptyProcessId,
    status: "ready",
    stale: false,
    generatedAt: NOW - 30 * 86_400_000,
    conversationCount: 0,
    nodes: [{ id: "log", label: "Re-key the return", category: "action", ...NODE }],
    edges: [],
    insights: { criticalPath: [], handoffCount: 0, toolCount: 1, automationOpportunities: [], topBottlenecks: [] },
    clerkOrgId: orgId,
  });
  return { functionId, departmentId, processId, emptyProcessId, conversationId };
}

async function seedViewer(ctx: MutationCtx, name: string, orgId: string, role: "viewer" | "contributor" | "admin") {
  const tokenIdentifier = `${ISSUER}|${name}`;
  const userId = await ctx.db.insert("users", { tokenIdentifier, name, email: `${name}@example.test`, profileComplete: true });
  const membershipId = await ctx.db.insert("memberships", { tokenIdentifier, userId, clerkOrgId: orgId, role, createdAt: NOW });
  return { viewer: { tokenIdentifier, orgId }, membershipId };
}

async function setup() {
  const t = convexTest(schema, modules);
  const seeded = await t.run(async (ctx) => {
    const a = await seedOrg(ctx, ORG_A, "A");
    const b = await seedOrg(ctx, ORG_B, "B");
    const viewer = await seedViewer(ctx, "vera", ORG_A, "viewer");
    const contributor = await seedViewer(ctx, "cole", ORG_A, "contributor");
    const admin = await seedViewer(ctx, "ada", ORG_A, "admin");
    return { a, b, viewer, contributor, admin };
  });
  return { t, ...seeded };
}

type Seeded = Awaited<ReturnType<typeof setup>>;

/** One valid call per tool, against org A's entities. */
function calls(s: Seeded): Record<string, Record<string, unknown>> {
  return {
    searchHierarchy: { query: "dispatch", kinds: [], cursor: "" },
    browseHierarchy: { kind: "department", id: s.a.departmentId, cursor: "" },
    getOverview: { kind: "process", ids: [s.a.processId], sections: [] },
    getProcessFlow: { processId: s.a.processId },
    listConversations: { processId: "", departmentId: "", functionId: "", since: "", cursor: "" },
    getConversationEvidence: { conversationId: s.a.conversationId },
    getTranscript: { conversationId: s.a.conversationId, atSeconds: -1, query: "", full: false },
    getCoverage: { kind: "org", id: "" },
    whatsNew: { since: "2026-10-01", kind: "org", id: "", cursor: "" },
    findHandoffs: { party: "Clerk" },
    findProcessesUsing: { tool: "Excel", actor: "" },
    searchConversations: { query: "walkthrough", processId: "", since: "", cursor: "" },
    searchFabricHelp: { query: "process flow" },
    rankSignals: { signals: ["friction", "bottleneck", "gap", "handoff", "manualRework"], kind: "org", id: "", limit: 0 },
    listSystems: { kind: "org", id: "" },
    findSimilarWork: { kind: "org", id: "" },
    getFlowNode: { processId: s.a.processId, nodeId: "rekey" },
    getParticipation: { kind: "org", id: "" },
  };
}

/** The same calls pointed at org B's entities (tools that take an id). */
function crossOrgCalls(s: Seeded): Record<string, Record<string, unknown>> {
  return {
    browseHierarchy: { kind: "department", id: s.b.departmentId, cursor: "" },
    getOverview: { kind: "process", ids: [s.b.processId], sections: [] },
    getProcessFlow: { processId: s.b.processId },
    listConversations: { processId: s.b.processId, departmentId: "", functionId: "", since: "", cursor: "" },
    getConversationEvidence: { conversationId: s.b.conversationId },
    getTranscript: { conversationId: s.b.conversationId, atSeconds: -1, query: "", full: false },
    getCoverage: { kind: "process", id: s.b.processId },
    whatsNew: { since: "2026-10-01", kind: "process", id: s.b.processId, cursor: "" },
    searchConversations: { query: "walkthrough", processId: s.b.processId, since: "", cursor: "" },
    rankSignals: { signals: ["friction"], kind: "process", id: s.b.processId, limit: 0 },
    listSystems: { kind: "department", id: s.b.departmentId },
    findSimilarWork: { kind: "function", id: s.b.functionId },
    getFlowNode: { processId: s.b.processId, nodeId: "rekey" },
  };
}

async function run(s: Seeded, name: string, input: Record<string, unknown>, viewer?: Seeded["viewer"]["viewer"]) {
  const tool = getAskTool(name)!;
  // Admin-only tools (T13) run as the admin unless a test says otherwise.
  viewer ??= tool.access === "admin" ? s.admin.viewer : s.viewer.viewer;
  return (await s.t.query(tool.executorRef, { viewer, ...input })) as AskToolResult;
}

function found(result: AskToolResult) {
  if (!result.found) throw new Error("expected a found result");
  return result;
}

function sourcesOf(result: AskToolResult): string[] {
  return found(result).content.flatMap((block) =>
    block.type === "search_result" && block.source !== RESULT_DETAILS_SOURCE ? [block.source] : [],
  );
}

function textOf(result: AskToolResult): string {
  return found(result)
    .content.map((block) => (block.type === "text" ? block.text : `${block.title}\n${block.content[0].text}`))
    .join("\n");
}

beforeEach(() => {
  process.env.SUMMARY_V2 = ORG_A;
});

afterEach(() => {
  if (originalSummaryV2 === undefined) delete process.env.SUMMARY_V2;
  else process.env.SUMMARY_V2 = originalSummaryV2;
});

describe("AskFabric core tools (T1–T9)", () => {
  test("every tool answers within budget, citing only its FR-1.8 source formats", async () => {
    const s = await setup();
    for (const [name, input] of Object.entries(calls(s))) {
      const tool = getAskTool(name)!;
      const result = found(await run(s, name, input));
      expect(result.resultCount, name).toBeGreaterThan(0);
      // The API rejects a tool result that mixes search results with text.
      expect(result.content.every((block) => block.type === "search_result"), name).toBe(true);
      expect(result.resultTokens, name).toBeLessThanOrEqual(tool.budgetTokens);
      for (const source of sourcesOf(result)) {
        const parsed = parseFabricSource(source);
        expect(parsed, `${name}: ${source}`).not.toBeNull();
        expect(tool.citationSources, `${name}: ${source}`).toContain(parsed!.type);
        // Sources never name the org (FR-1.8).
        expect(source).not.toContain(ORG_A);
      }
      // Org B's data never appears in an org-A answer.
      expect(textOf(result), name).not.toMatch(/\bB\b|Ana B|Dispatch B/);
    }
  });

  test("org B ids return found: false and nothing else (FR-1.4)", async () => {
    const s = await setup();
    for (const [name, input] of Object.entries(crossOrgCalls(s))) {
      expect(await run(s, name, input), name).toEqual({ found: false });
    }
    // Malformed ids look the same as missing ones.
    expect(await run(s, "getProcessFlow", { processId: "not-an-id" })).toEqual({ found: false });
  });

  test("viewers, contributors and admins get the same answers (member access)", async () => {
    const s = await setup();
    for (const [name, input] of Object.entries(calls(s))) {
      if (getAskTool(name)!.access !== "member") continue;
      const asViewer = await run(s, name, input, s.viewer.viewer);
      expect(await run(s, name, input, s.contributor.viewer), name).toEqual(asViewer);
      expect(await run(s, name, input, s.admin.viewer), name).toEqual(asViewer);
    }
  });

  test("T10 reads one step in full, with the steps either side (FR-1.20)", async () => {
    const s = await setup();
    const result = found(await run(s, "getFlowNode", calls(s).getFlowNode));
    expect(sourcesOf(result).every((source) => source === `fabric:flow-node/${s.a.processId}/rekey`)).toBe(true);
    expect(textOf(result)).toMatch(/Step \(action\): Re-key into ERP\./);
    expect(textOf(result)).toMatch(/Actors: Clerk\./);
    expect(textOf(result)).toMatch(/Flags: [^.]*tribal knowledge/);
    expect(textOf(result)).toMatch(/Comes after: Build schedule\. Leads to: Dispatch/);
    expect(await run(s, "getFlowNode", { processId: s.a.processId, nodeId: "no-such-step" })).toEqual({ found: false });
  });

  test("T13 is admin only, and lists who has and hasn't contributed (FR-1.21, FR-9.3, D27)", async () => {
    const s = await setup();
    const input = calls(s).getParticipation;
    expect(await run(s, "getParticipation", input, s.viewer.viewer)).toEqual({ found: false });
    expect(await run(s, "getParticipation", input, s.contributor.viewer)).toEqual({ found: false });
    const asAdmin = found(await run(s, "getParticipation", input, s.admin.viewer));
    const text = textOf(asAdmin);
    expect(text).toMatch(/Completed contributions to Dispatch scheduling A by contributor: Ana A \(1\)\./);
    expect(text).toMatch(/Processes with no completed contributions/);
    // Seeded members have no contributions of their own; org B's never appear.
    expect(text).toMatch(/have no completed contribution in scope: ada \(admin\), cole \(contributor\), vera \(viewer\)\./);
    expect(text).toMatch(/1 completed contributions in scope from 1 contributor/);
    expect(text).not.toMatch(/B|Ana B/);
    // Org B scopes are not found, even for an admin.
    expect(await run(s, "getParticipation", { kind: "process", id: s.b.processId }, s.admin.viewer)).toEqual({ found: false });
  });

  test("a member removed between two tool calls gets the access error on the second", async () => {
    const s = await setup();
    const input = calls(s).getCoverage;
    found(await run(s, "getCoverage", input));
    await s.t.run((ctx) => ctx.db.patch("memberships", s.viewer.membershipId, { removedAt: NOW }));
    let code: string | null = null;
    try {
      await run(s, "getCoverage", input);
    } catch (error) {
      let data = (error as { data?: unknown }).data;
      while (typeof data === "string") data = JSON.parse(data);
      code = authErrorCode({ data });
    }
    expect(code).toBe("REMOVED");
  });

  test("with SUMMARY_V2 off, no tool returns V2 findings (FR-1.5)", async () => {
    process.env.SUMMARY_V2 = "false";
    const s = await setup();
    for (const [name, input] of Object.entries(calls(s))) {
      const result = await run(s, name, input);
      if (!result.found) continue;
      expect(sourcesOf(result).some((source) => source.startsWith("fabric:finding/")), name).toBe(false);
      expect(textOf(result), name).not.toContain("No owner for order exceptions");
    }
    expect(textOf(await run(s, "getOverview", calls(s).getOverview))).toContain("Legacy overview for A");
  });

  test("T3 returns state, coverage and pending work with its findings (FR-1.7)", async () => {
    const s = await setup();
    const text = textOf(await run(s, "getOverview", calls(s).getOverview));
    expect(text).toContain("Dispatch runs on spreadsheets (A)");
    expect(text).toContain("No owner for order exceptions");
    expect(text).toMatch(/State: (current|stale|partial)/);
    expect(text).toContain("1 still processing");
    const gapsOnly = textOf(await run(s, "getOverview", { ...calls(s).getOverview, sections: ["gaps"] }));
    expect(gapsOnly).not.toContain("Trigger is the morning order cut");
  });

  test("T4 key findings match the Insights tab's derivation (FR-1.12)", async () => {
    const s = await setup();
    const result = found(await run(s, "getProcessFlow", calls(s).getProcessFlow));
    const flow = await s.t.run(async (ctx) => {
      const { readProcessFlow } = await import("../processFlows");
      return await readProcessFlow(ctx, ORG_A, s.a.processId as Id<"processes">);
    });
    const expected = deriveKeyFindings(flow as ProcessFlow, deriveHandoffs(flow!.nodes, flow!.edges));
    expect(expected.state).toBe("findings");
    if (expected.state !== "findings") return;
    const titles = result.content.flatMap((b) => (b.type === "search_result" ? [b.content[0].text] : []));
    for (const finding of expected.findings) {
      expect(titles.some((text) => text.startsWith(`${finding.title}. ${finding.detail}`))).toBe(true);
    }
  });

  test("T7 windows by time, by query and by default, and caps a full read", async () => {
    const s = await setup();
    const base = calls(s).getTranscript;
    const lines = (result: AskToolResult) =>
      sourcesOf(result).map((source) => Number(source.match(/line=(\d+)/)![1]));

    expect(lines(await run(s, "getTranscript", base))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(lines(await run(s, "getTranscript", { ...base, query: "finance approves" }))).toContain(42);
    expect(lines(await run(s, "getTranscript", { ...base, atSeconds: 300 }))).toContain(31);
    const full = found(await run(s, "getTranscript", { ...base, full: true }));
    expect(full.resultCount).toBe(60);
  });

  test("T7 truncates a full read at 40K tokens", async () => {
    const s = await setup();
    const longId = await s.t.run((ctx) =>
      ctx.db.insert("conversations", {
        processId: s.a.processId,
        contributorName: "Long talker",
        status: "done",
        clerkOrgId: ORG_A,
        transcript: Array.from({ length: 400 }, (_, i) => ({
          role: "user",
          content: "word ".repeat(150),
          time_in_call_secs: i,
        })),
      }),
    );
    const result = found(
      await run(s, "getTranscript", { conversationId: longId, atSeconds: -1, query: "", full: true }),
    );
    expect(result.truncated).toBe(true);
    expect(result.resultTokens).toBeLessThanOrEqual(40_000);
    expect(result.resultCount).toBeLessThan(400);
  });

  test("T8 reports the coverage caveat's numbers", async () => {
    const s = await setup();
    const text = textOf(await run(s, "getCoverage", calls(s).getCoverage));
    expect(text).toContain("1 of 2 processes have at least one completed contribution (50%)");
    expect(text).toContain("Processes with no completed contributions: Returns A");
    expect(text).toContain("1 processing");
  });

  test("T9 lists new contributions and regenerated flows, and rejects a bad date", async () => {
    const s = await setup();
    const text = textOf(await run(s, "whatsNew", calls(s).whatsNew));
    expect(text).toContain("New contribution recorded");
    expect(text).toContain("process flow for Dispatch scheduling A was regenerated");
    const bad = found(await run(s, "whatsNew", { ...calls(s).whatsNew, since: "last tuesday" }));
    expect(bad.resultCount).toBe(0);
    expect(textOf(bad)).toContain("since must be a date");
  });

  test("flow facts and the ranking's scope are citable, not only metadata (D52)", async () => {
    const s = await setup();
    const flow = found(await run(s, "getProcessFlow", calls(s).getProcessFlow));
    const summary = flow.content.find((block) => block.type === "search_result" && block.title.endsWith("process flow summary"));
    expect(summary).toMatchObject({ source: `fabric:entity/process/${s.a.processId}` });
    expect(textOf(flow)).toMatch(/Process flow for .+: \d+ steps and \d+ handoffs, built from \d+ contributions?, generated \d{4}-\d{2}-\d{2}/);
    expect(textOf(flow)).toMatch(/how the steps connect\nStep connections: .+ → /);
    expect(textOf(await run(s, "rankSignals", calls(s).rankSignals))).toMatch(/Ranked across \d+ processes in scope, reading \d+ process flows and \d+ contributions/);
    expect(textOf(await run(s, "rankSignals", calls(s).rankSignals))).toMatch(/Found: \d+ bottleneck, \d+ friction, \d+ gap, \d+ handoff, \d+ manualRework\. Up to \d+ of each are listed\./);
    const listed = found(await run(s, "listConversations", calls(s).listConversations));
    const count = listed.content.find((block) => block.type === "search_result" && block.title === "Contributions in the organization");
    expect(count).toMatchObject({ source: "fabric:entity/org" });
    expect(textOf(listed)).toMatch(/\d+ completed contributions? in scope, newest first\./);
    expect(textOf(await run(s, "findProcessesUsing", calls(s).findProcessesUsing))).toMatch(/\d+ process(?:es)? found using Excel, searching/);
    expect(textOf(await run(s, "findHandoffs", calls(s).findHandoffs))).toMatch(/Handoffs involving "Clerk" found in \d+ process(?:es)?, searching/);
  });

  test("a scan that finds nothing says so in a citable result, sourced to its scope", async () => {
    const s = await setup();
    // One process can't duplicate itself, and nobody is called Zebedee.
    const empty = [
      await run(s, "findSimilarWork", { kind: "process", id: s.a.processId }),
      await run(s, "findHandoffs", { party: "Zebedee" }),
      await run(s, "findProcessesUsing", { tool: "Zebedee", actor: "" }),
    ];
    expect(empty.map((result) => found(result).resultCount)).toEqual([0, 0, 0]);
    expect(empty.map((result) => sourcesOf(result))).toEqual([[`fabric:entity/process/${s.a.processId}`], ["fabric:entity/org"], ["fabric:entity/org"]]);
    expect(textOf(empty[0])).toMatch(/No duplication candidates found across 1 processes/);
    // A scan with results carries no such block.
    expect(textOf(await run(s, "findSimilarWork", calls(s).findSimilarWork))).not.toMatch(/No duplication candidates/);
  });

  test("lists page with a cursor", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let i = 0; i < 30; i++) {
        await ctx.db.insert("conversations", {
          processId: s.a.processId,
          contributorName: `Contributor ${i}`,
          status: "done",
          clerkOrgId: ORG_A,
        });
      }
    });
    const first = found(await run(s, "listConversations", calls(s).listConversations));
    expect(first.resultCount).toBeLessThanOrEqual(25);
    expect(first.cursor).not.toBeNull();
    const second = found(
      await run(s, "listConversations", { ...calls(s).listConversations, cursor: first.cursor }),
    );
    expect(first.resultCount + second.resultCount).toBe(31);
    expect(second.cursor).toBeNull();
  });

  test("the catalog covers every tool exercised here", () => {
    // Display tools return no data; their tests are in askfabric/display.test.ts.
    expect(ASK_TOOLS.filter((tool) => tool.display === undefined).map((tool) => tool.name).sort()).toEqual(
      Object.keys(calls({ a: {}, b: {} } as unknown as Seeded)).sort(),
    );
  });
});

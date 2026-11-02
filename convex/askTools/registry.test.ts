import { getFunctionName } from "convex/server";
import { v } from "convex/values";
import { describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery, query } from "../_generated/server";
import { ASK_TOOL_NAMES } from "../lib/askSchema";
import { ASK_TOOLS } from "./catalog";
import { transcriptWindow, windowCentre, type TranscriptLine } from "./conversations";
import {
  defineTool,
  FORBIDDEN_INPUT_FIELDS,
  toApiTools,
  toStrictJsonSchema,
  ToolRegistrationError,
} from "./registry";
import {
  ResultBuilder,
  clipText,
  parseFabricSource,
  searchResult,
  sources,
  UNTRUSTED_NOTICE,
} from "./results";

const fakeExecutor = internalQuery({ args: {}, handler: async () => null });

function validDefinition() {
  return {
    name: "searchHierarchy" as const,
    description: "Find things.",
    input: { query: v.string(), cursor: v.union(v.string(), v.null()) },
    inputDescriptions: { query: "Words.", cursor: "Cursor." },
    access: "member" as const,
    executor: fakeExecutor,
    executorPath: "askTools/hierarchy:searchHierarchy",
    output: "Things.",
    citationSources: ["entity"] as const,
    budgetTokens: 2_000,
    telemetryName: "searchHierarchy" as const,
    label: () => "Searching",
  };
}

describe("tool registration (FR-1.1, FR-1.2, FR-1.11)", () => {
  test("accepts a complete definition and derives a strict schema", () => {
    const tool = defineTool(validDefinition());
    expect(tool.inputSchema).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "Words." },
        cursor: { anyOf: [{ type: "string" }, { type: "null" }], description: "Cursor." },
      },
      required: ["query", "cursor"],
    });
  });

  test.each([
    "name",
    "description",
    "input",
    "inputDescriptions",
    "access",
    "executor",
    "executorPath",
    "output",
    "citationSources",
    "budgetTokens",
    "telemetryName",
    "label",
  ])("rejects a definition missing %s", (field) => {
    const definition = { ...validDefinition(), [field]: undefined };
    expect(() => defineTool(definition as never)).toThrow(ToolRegistrationError);
  });

  test.each(FORBIDDEN_INPUT_FIELDS)("rejects the identity field %s, at any depth", (field) => {
    expect(() =>
      defineTool({
        ...validDefinition(),
        input: { ...validDefinition().input, [field]: v.string() },
        inputDescriptions: { ...validDefinition().inputDescriptions, [field]: "x" },
      } as never),
    ).toThrow(/identity field/);
    expect(() =>
      defineTool({
        ...validDefinition(),
        input: { ...validDefinition().input, filter: v.object({ [field]: v.string() }) },
        inputDescriptions: { ...validDefinition().inputDescriptions, filter: "x" },
      } as never),
    ).toThrow(/identity field/);
  });

  test("rejects a mutation executor and a public query", () => {
    const mutationExecutor = internalMutation({ args: {}, handler: async () => null });
    const publicQuery = query({ args: {}, handler: async () => null });
    expect(() => defineTool({ ...validDefinition(), executor: mutationExecutor })).toThrow(
      /internal query/,
    );
    expect(() => defineTool({ ...validDefinition(), executor: publicQuery })).toThrow(
      /internal query/,
    );
  });

  test("rejects a budget above the 4K hard cap and an optional input", () => {
    expect(() => defineTool({ ...validDefinition(), budgetTokens: 4_001 })).toThrow(/budgetTokens/);
    expect(() =>
      defineTool({
        ...validDefinition(),
        input: { query: v.optional(v.string()), cursor: v.union(v.string(), v.null()) },
      }),
    ).toThrow(/optional/);
  });

  test("renders a nullable enum as one enum plus null", () => {
    expect(
      toStrictJsonSchema(v.union(v.literal("function"), v.literal("department"), v.null())),
    ).toEqual({ anyOf: [{ type: "string", enum: ["function", "department"] }, { type: "null" }] });
  });
});

describe("the catalog", () => {
  test("registers tools in ASK_TOOL_NAMES order with unique names", () => {
    const names = ASK_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    const order = names.map((name) => ASK_TOOL_NAMES.indexOf(name));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("every executor path names the internal query it registered", () => {
    const refs: Record<string, unknown> = {
      searchHierarchy: internal.askTools.hierarchy.searchHierarchy,
      browseHierarchy: internal.askTools.hierarchy.browseHierarchy,
      getOverview: internal.askTools.overview.getOverview,
      getProcessFlow: internal.askTools.flow.getProcessFlow,
      listConversations: internal.askTools.conversations.listConversations,
      getConversationEvidence: internal.askTools.conversations.getConversationEvidence,
      getTranscript: internal.askTools.conversations.getTranscript,
      getCoverage: internal.askTools.coverage.getCoverage,
      whatsNew: internal.askTools.coverage.whatsNew,
      findHandoffs: internal.askTools.graph.findHandoffs,
      findProcessesUsing: internal.askTools.graph.findProcessesUsing,
      searchConversations: internal.askTools.conversations.searchConversations,
      searchFabricHelp: internal.askTools.help.searchFabricHelp,
      rankSignals: internal.askTools.signals.rankSignals,
      listSystems: internal.askTools.systems.listSystems,
      findSimilarWork: internal.askTools.systems.findSimilarWork,
    };
    for (const tool of ASK_TOOLS) {
      expect(getFunctionName(refs[tool.name] as never)).toBe(tool.executorPath);
      expect(getFunctionName(tool.executorRef)).toBe(tool.executorPath);
    }
  });

  test("every input schema is strict: all properties required, no extras", () => {
    for (const { input_schema: schema, strict } of toApiTools(ASK_TOOLS)) {
      expect(strict).toBe(true);
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(Object.keys(schema.properties as object));
    }
  });

  test("no label is a generic placeholder (FR-2.15)", () => {
    const sample = {
      query: "approval delays",
      kinds: null,
      cursor: null,
      kind: null,
      id: null,
      ids: ["a", "b"],
      sections: null,
      processId: "p",
      departmentId: null,
      functionId: null,
      since: "2026-10-01",
      conversationId: "c",
      atSeconds: null,
      full: null,
      party: "Finance",
      tool: "Excel",
      actor: null,
      signals: ["friction", "bottleneck"],
      limit: null,
    };
    for (const tool of ASK_TOOLS) {
      const label = tool.label(sample as never);
      expect(label).not.toMatch(/^(Processing|Working|Loading|Thinking)/);
      expect(label.length).toBeGreaterThan(10);
    }
  });
});

describe("citation sources (FR-1.8)", () => {
  test("every builder round-trips through the parser to its entity", () => {
    expect(parseFabricSource(sources.finding("process", "p1", "f_2"))).toEqual({
      type: "finding",
      sourceKind: "process",
      sourceEntityId: "p1",
    });
    expect(parseFabricSource(sources.overview("function", "f1"))?.type).toBe("overview");
    expect(parseFabricSource(sources.entity("department", "d1"))).toMatchObject({
      type: "entity",
      sourceKind: "department",
    });
    expect(parseFabricSource(sources.org())).toEqual({
      type: "org",
      sourceKind: "org",
      sourceEntityId: "org",
    });
    expect(parseFabricSource(sources.flowNode("p1", "node-3"))).toEqual({
      type: "flowNode",
      sourceKind: "process",
      sourceEntityId: "p1",
    });
    expect(parseFabricSource(sources.conversation("p1", "c1"))).toEqual({
      type: "conversation",
      sourceKind: "conversation",
      sourceEntityId: "c1",
    });
    expect(parseFabricSource(sources.transcriptLine("p1", "c1", 125.7, 14))).toEqual({
      type: "transcriptLine",
      sourceKind: "conversation",
      sourceEntityId: "c1",
    });
    expect(sources.transcriptLine("p1", "c1", 125.7, 14)).toBe(
      "fabric:conversation/p1/c1?t=125&line=14",
    );
    expect(parseFabricSource(sources.members("process", "p1"))?.type).toBe("members");
    expect(parseFabricSource(sources.help("ask-fabric-basics"))?.type).toBe("help");
  });

  test("rejects sources outside the scheme", () => {
    for (const bad of ["https://evil.example", "fabric:entity/team/x", "fabric:finding/process/p1", "fabric:entity/org/x"]) {
      expect(parseFabricSource(bad)).toBeNull();
    }
  });
});

describe("result envelope (FR-1.9, FR-1.10)", () => {
  test("stops at the budget, marks truncation and leads with the untrusted notice", () => {
    const builder = new ResultBuilder(300, 50);
    let added = 0;
    for (let i = 0; i < 50; i++) {
      if (!builder.add(searchResult(sources.org(), `Item ${i}`, "x".repeat(200)))) break;
      added++;
    }
    const result = builder.finish({ scope: "org" });
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(added).toBeGreaterThan(0);
    expect(added).toBeLessThan(50);
    expect(result.truncated).toBe(true);
    expect(result.resultCount).toBe(added);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text: string }).text.startsWith(UNTRUSTED_NOTICE)).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('"truncated":true');
  });

  test("clipText marks the cut", () => {
    expect(clipText("short", 100)).toBe("short");
    expect(clipText("y".repeat(1000), 10)).toMatch(/… \[truncated\]$/);
  });
});

describe("transcript windows (FR-1.6)", () => {
  const lines: TranscriptLine[] = Array.from({ length: 60 }, (_, i) => ({
    line: i + 1,
    timeSecs: i * 10,
    speaker: i % 2 ? "Ana" : "Fabric",
    text: i === 41 ? "Then finance approves the purchase order" : i === 30 ? "the approval sits for days" : `line ${i + 1}`,
  }));

  test("centres on atSeconds, then on the query, then on the opening", () => {
    expect(windowCentre(lines, 205, null)).toBe(21);
    expect(windowCentre(lines, null, "finance approves")).toBe(41);
    // No line has both terms: falls back to the line with the most.
    expect(windowCentre(lines, null, "approval weekly")).toBe(30);
    expect(windowCentre(lines, null, null)).toBe(0);
  });

  test("returns 20 lines around the centre, clamped to the transcript", () => {
    expect(transcriptWindow(lines, 41).map((l) => l.line)).toEqual(
      Array.from({ length: 20 }, (_, i) => 33 + i),
    );
    expect(transcriptWindow(lines, 0)[0].line).toBe(1);
    expect(transcriptWindow(lines, 59).at(-1)!.line).toBe(60);
  });
});

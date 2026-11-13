import type { FunctionReference } from "convex/server";
import { internal } from "../_generated/api";
import { ASK_TOOLS } from "../askTools/catalog";
import type { JsonSchema, RegisteredAskTool } from "../askTools/registry";
import type { AskToolResult } from "../askTools/results";

/**
 * The tools the Fabric MCP server exposes.
 *
 * Decision M2 (2026-11-12) keeps the synthesised layer and leaves out
 * transcripts, conversation-level tools, participation and the display tool,
 * because the AskFabric system prompt that carries the named-people guardrail
 * (D7) doesn't travel over MCP. Descriptions are AskFabric's own, unchanged,
 * so AskFabric's prompt and eval are untouched; MCP-specific guidance goes in
 * the server instructions.
 */
export const MCP_ASK_TOOL_NAMES = [
  "searchHierarchy",
  "browseHierarchy",
  "getOverview",
  "getProcessFlow",
  "getFlowNode",
  "getCoverage",
  "whatsNew",
  "findHandoffs",
  "findProcessesUsing",
  "rankSignals",
  "listSystems",
  "findSimilarWork",
  "searchFabricHelp",
] as const;

/**
 * Conversation-level tools: transcripts and contribution evidence. Exposed
 * only when the workspace admin turns them on (M2), since they carry
 * contributors' own words.
 */
export const MCP_CONVERSATION_TOOL_NAMES = [
  "listConversations",
  "getConversationEvidence",
  "getTranscript",
  "searchConversations",
] as const;

export const WORKSPACE_TOOL_NAME = "getWorkspaceContents";

/** Every always-on tool name, in `tools/list` order. */
export const MCP_TOOL_NAMES = [WORKSPACE_TOOL_NAME, ...MCP_ASK_TOOL_NAMES] as const;

type ExecutorRef = FunctionReference<"query", "internal", { viewer: { tokenIdentifier: string; orgId: string } } & Record<string, unknown>, AskToolResult>;

export type McpTool = {
  name: string;
  description: string;
  /** The strict AskFabric schema, every field required; what the executor validates. */
  inputSchema: JsonSchema;
  /** What clients see: the same schema with placeholder fields made optional. */
  publishedSchema: JsonSchema;
  /** The placeholder value for each optional field, filled in before the executor runs. */
  defaults: Record<string, unknown>;
  /** An internal query taking the viewer plus the tool's arguments. */
  executorRef: ExecutorRef;
};

const WORKSPACE_TOOL: McpTool = {
  name: WORKSPACE_TOOL_NAME,
  description:
    "List this organization's whole structure in one call: every function, its departments and their processes, with ids and, where available, each process's overview headline. Call it first, then pass the ids to the other tools. For a large organization, processes are summarised as counts per department; find them with searchHierarchy or browseHierarchy.",
  inputSchema: { type: "object", additionalProperties: false, properties: {}, required: [] },
  publishedSchema: { type: "object", additionalProperties: false, properties: {}, required: [] },
  defaults: {},
  executorRef: internal.mcp.workspace.getWorkspaceContents as unknown as ExecutorRef,
};

/**
 * The placeholder a field's description documents, if any. AskFabric's strict
 * tool use makes every field required, so optional inputs take placeholders
 * ("" / [] / -1 / 0 / false / "org" / "root"), each written into the field's
 * description. MCP clients such as Copilot Studio treat every required field
 * as one to ask the user for, so MCP publishes these fields as optional and
 * fills the placeholder in itself.
 */
export function placeholderFor(field: JsonSchema): { value: unknown } | null {
  const description = typeof field.description === "string" ? field.description : "";
  const options = Array.isArray(field.enum) ? (field.enum as unknown[]) : [];
  if (options.includes("org") && description.includes('"org"')) return { value: "org" };
  if (options.includes("root") && description.includes('"root"')) return { value: "root" };
  if (field.type === "string" && /(^|\s)""(\s|\.|,|$)|or ""|"" for|"" with/.test(description)) return { value: "" };
  if (field.type === "array" && /\[\]/.test(description)) return { value: [] };
  if (field.type === "number" && /\bor -1\b/.test(description)) return { value: -1 };
  if (field.type === "number" && /\b0 for the default\b/.test(description)) return { value: 0 };
  if (field.type === "boolean" && /otherwise false/.test(description)) return { value: false };
  return null;
}

/** The client-facing schema and the defaults that complete a call to the strict schema. */
export function relaxSchema(schema: JsonSchema): { publishedSchema: JsonSchema; defaults: Record<string, unknown> } {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const defaults: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(properties)) {
    const placeholder = placeholderFor(field);
    if (placeholder) defaults[key] = placeholder.value;
  }
  const required = ((schema.required ?? []) as string[]).filter((key) => !(key in defaults));
  return { publishedSchema: { ...schema, required }, defaults };
}

function fromAskTool(tool: RegisteredAskTool): McpTool {
  if (tool.access !== "member" || tool.display) throw new Error(`MCP tool ${tool.name} must be a member data tool`);
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...relaxSchema(tool.inputSchema),
    executorRef: tool.executorRef as unknown as ExecutorRef,
  };
}

export type McpToolOptions = { conversationTools: boolean };

/** The tools a workspace exposes. Conversation tools come last, so the always-on prefix stays stable. */
export function mcpTools({ conversationTools }: McpToolOptions): McpTool[] {
  const byName = new Map(ASK_TOOLS.map((tool) => [tool.name as string, tool]));
  const names: readonly string[] = conversationTools ? [...MCP_ASK_TOOL_NAMES, ...MCP_CONVERSATION_TOOL_NAMES] : MCP_ASK_TOOL_NAMES;
  return [
    WORKSPACE_TOOL,
    ...names.map((name) => {
      const tool = byName.get(name);
      if (!tool) throw new Error(`MCP tool ${name} is not in the AskFabric catalog`);
      return fromAskTool(tool);
    }),
  ];
}

export function getMcpTool(name: string, options: McpToolOptions): McpTool | undefined {
  return mcpTools(options).find((tool) => tool.name === name);
}

/** `tools/list` entries, in a fixed order so client prompt caches hold. */
export function toolListEntries(options: McpToolOptions) {
  return mcpTools(options).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.publishedSchema,
    annotations: {
      title: tool.name,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }));
}

/** Every Fabric citation source in a result, for link resolution. */
export function sourcesIn(result: AskToolResult): string[] {
  if (!result.found) return [];
  return [...new Set(result.content.flatMap((block) => (block.type === "search_result" && block.source.startsWith("fabric:") ? [block.source] : [])))];
}

/**
 * An AskFabric result as MCP text content. Each `search_result` becomes a
 * titled section with an https link into the workbench, because external
 * clients have no `fabric:` scheme and no native citation blocks.
 */
export function toMcpContent(result: AskToolResult, links: ReadonlyMap<string, string>): Array<{ type: "text"; text: string }> {
  if (!result.found) {
    return [{ type: "text", text: "Nothing found in this Fabric workspace for that request." }];
  }
  const sections = result.content.map((block) => {
    if (block.type === "text") return block.text;
    const body = block.content.map((part) => part.text).join("\n");
    const link = links.get(block.source);
    return [`### ${block.title}`, link ? `Link: ${link}` : null, body].filter(Boolean).join("\n");
  });
  if (result.truncated) {
    sections.push(
      result.cursor
        ? `(More results are available: call again with cursor "${result.cursor}".)`
        : "(Results were cut to fit the size budget; narrow the request for more.)",
    );
  }
  return [{ type: "text", text: sections.join("\n\n") }];
}

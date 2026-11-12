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
  inputSchema: JsonSchema;
  /** An internal query taking the viewer plus the tool's arguments. */
  executorRef: ExecutorRef;
};

const WORKSPACE_TOOL: McpTool = {
  name: WORKSPACE_TOOL_NAME,
  description:
    "List this organization's whole structure in one call: every function, its departments and their processes, with ids and, where available, each process's overview headline. Call it first, then pass the ids to the other tools. For a large organization, processes are summarised as counts per department; find them with searchHierarchy or browseHierarchy.",
  inputSchema: { type: "object", additionalProperties: false, properties: {}, required: [] },
  executorRef: internal.mcp.workspace.getWorkspaceContents as unknown as ExecutorRef,
};

function fromAskTool(tool: RegisteredAskTool): McpTool {
  if (tool.access !== "member" || tool.display) throw new Error(`MCP tool ${tool.name} must be a member data tool`);
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema, executorRef: tool.executorRef as unknown as ExecutorRef };
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
    inputSchema: tool.inputSchema,
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

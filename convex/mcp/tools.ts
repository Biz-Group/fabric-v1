import { ASK_TOOLS } from "../askTools/catalog";
import type { RegisteredAskTool } from "../askTools/registry";
import type { AskToolResult } from "../askTools/results";

/**
 * The AskFabric tools exposed over MCP (SPIKE). Decision M2 (2026-11-12) keeps
 * the synthesised layer and leaves out transcripts, conversation-level tools,
 * participation and the display tool. The AskFabric system prompt carries the
 * named-people guardrail (D7), and that prompt doesn't travel over MCP.
 */
export const MCP_TOOL_NAMES = [
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

export function mcpTools(): RegisteredAskTool[] {
  const byName = new Map(ASK_TOOLS.map((tool) => [tool.name as string, tool]));
  return MCP_TOOL_NAMES.map((name) => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`MCP tool ${name} is not in the AskFabric catalog`);
    if (tool.access !== "member" || tool.display) throw new Error(`MCP tool ${name} must be a member data tool`);
    return tool;
  });
}

export function getMcpTool(name: string): RegisteredAskTool | undefined {
  return (MCP_TOOL_NAMES as readonly string[]).includes(name) ? mcpTools().find((tool) => tool.name === name) : undefined;
}

/**
 * `tools/list` entries, in a fixed order so client prompt caches hold. The
 * AskFabric schemas are already strict JSON Schema, which MCP accepts as is.
 */
export function toolListEntries() {
  return mcpTools().map((tool) => ({
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

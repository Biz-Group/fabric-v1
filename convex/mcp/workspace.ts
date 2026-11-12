import { internalQuery } from "../_generated/server";
import { orgViewerValidator, requireOrgViewer } from "../lib/orgAuth";
import { buildTableOfContents, tocFromHierarchy } from "../askfabric/context";
import { loadHierarchy } from "../askTools/scope";
import { estimateTokens, UNTRUSTED_NOTICE, type AskToolResult } from "../askTools/results";

/**
 * `getWorkspaceContents`, an MCP-only tool: the whole function → department →
 * process tree with ids in one call, the same table of contents AskFabric puts
 * in its prompt (at most 8K tokens; past that, processes become counts). Without
 * it, MCP clients crawl the hierarchy one browseHierarchy call per node.
 *
 * Not in the AskFabric catalog, so AskFabric's cached tool prefix is unchanged.
 */
export const getWorkspaceContents = internalQuery({
  args: { viewer: orgViewerValidator },
  handler: async (ctx, { viewer }): Promise<AskToolResult> => {
    await requireOrgViewer(ctx, viewer);
    const hierarchy = await loadHierarchy(ctx, viewer.orgId);
    const text = buildTableOfContents(tocFromHierarchy(hierarchy));
    const content = [
      { type: "text" as const, text: UNTRUSTED_NOTICE },
      { type: "text" as const, text },
    ];
    return {
      found: true,
      content,
      resultCount: hierarchy.processes.length,
      resultTokens: estimateTokens(UNTRUSTED_NOTICE + text),
      truncated: hierarchy.truncated,
      cursor: null,
    };
  },
});

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { readProcessFlow } from "../processFlows";
import { describedNodes, type FlowNode, type ProcessFlow } from "../lib/insightsDerivations";
import { normalizeKey } from "../lib/askNormalize";

/**
 * Stored pipeline outputs for a set of processes, the only input to the
 * aggregation tools (FR-1.14): no model calls, nothing derived on the fly but
 * the deterministic passes in this folder.
 *
 * Conversation rows carry their transcripts, so they are the heavy read here.
 * The caps keep a call well inside Convex's per-query limits; the result says
 * when one was hit. FR-1.14's `askSignals` index replaces these reads if the
 * eval snapshot shows them above a quarter of the limits.
 */

/** Processes whose flows are read per call. */
export const MAX_FLOW_PROCESSES = 300;
/** Completed contributions read per call. */
export const MAX_EVIDENCE_CONVERSATIONS = 400;
/** Below this many processes, contributions are read per process. */
const PER_PROCESS_READ_THRESHOLD = 20;

export type ConversationEvidence = NonNullable<
  Doc<"conversations">["processSummaryEvidenceV2"]
>;

export type ScopeEvidence = {
  processById: Map<Id<"processes">, Doc<"processes">>;
  flows: Array<{ process: Doc<"processes">; flow: ProcessFlow; nodes: FlowNode[] }>;
  contributions: Array<{ conversation: Doc<"conversations">; evidence: ConversationEvidence }>;
  capped: boolean;
};

export async function loadScopeEvidence(
  ctx: QueryCtx,
  orgId: string,
  processes: Doc<"processes">[],
): Promise<ScopeEvidence> {
  const processById = new Map(processes.map((p) => [p._id, p]));
  let capped = processes.length > MAX_FLOW_PROCESSES;

  const flows: ScopeEvidence["flows"] = [];
  for (const process of processes.slice(0, MAX_FLOW_PROCESSES)) {
    const flow = await readProcessFlow(ctx, orgId, process._id);
    if (!flow || flow.status !== "ready" || flow.nodes.length === 0) continue;
    // Detail-derived signals only come from described steps (see
    // `describedNodes`): a placeholder must never read as an assessment.
    flows.push({ process, flow: flow as ProcessFlow, nodes: describedNodes(flow.nodes as FlowNode[]) });
  }

  let rows: Doc<"conversations">[] = [];
  if (processes.length <= PER_PROCESS_READ_THRESHOLD) {
    for (const process of processes) {
      rows.push(
        ...(await ctx.db
          .query("conversations")
          .withIndex("by_clerkOrgId_and_processId_and_status", (q) =>
            q.eq("clerkOrgId", orgId).eq("processId", process._id).eq("status", "done"),
          )
          .order("desc")
          .take(MAX_EVIDENCE_CONVERSATIONS)),
      );
    }
    if (rows.length > MAX_EVIDENCE_CONVERSATIONS) {
      rows = rows.sort((a, b) => b._creationTime - a._creationTime).slice(0, MAX_EVIDENCE_CONVERSATIONS);
      capped = true;
    }
  } else {
    const scanned = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_status", (q) => q.eq("clerkOrgId", orgId).eq("status", "done"))
      .order("desc")
      .take(MAX_EVIDENCE_CONVERSATIONS);
    if (scanned.length === MAX_EVIDENCE_CONVERSATIONS) capped = true;
    rows = scanned.filter((row) => processById.has(row.processId));
  }

  const contributions = rows.flatMap((conversation) =>
    conversation.processSummaryEvidenceV2
      ? [{ conversation, evidence: conversation.processSummaryEvidenceV2 }]
      : [],
  );
  return { processById, flows, contributions, capped };
}

/**
 * Who a flow node's evidence came from. Node sources read like
 * "Alice, Conv. 1", so the name is the part before the first comma.
 */
export function nodeContributors(node: FlowNode): string[] {
  return node.sources
    .map((source) => normalizeKey(source.split(",")[0] ?? ""))
    .filter(Boolean);
}

/**
 * The same name key for a contribution, so a person counts once whether the
 * signal came from a flow node or from their contribution's evidence.
 */
export function conversationContributor(conversation: Doc<"conversations">): string {
  return normalizeKey(conversation.contributorName);
}

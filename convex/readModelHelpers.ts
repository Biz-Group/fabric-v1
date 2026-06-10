import { Doc, Id } from "./_generated/dataModel";

export type PendingWorkStatus =
  | "needs_labels"
  | "failed"
  | "processing"
  | "current";

export type ConversationCounts = {
  total: number;
  done: number;
  processing: number;
  needsSpeakerLabels: number;
  failed: number;
};

export const PENDING_WORK_LABELS: Record<PendingWorkStatus, string> = {
  needs_labels: "Needs labels",
  failed: "Failed",
  processing: "Processing",
  current: "Current",
};

export function emptyConversationCounts(): ConversationCounts {
  return {
    total: 0,
    done: 0,
    processing: 0,
    needsSpeakerLabels: 0,
    failed: 0,
  };
}

export function getConversationCounts(
  conversations: Doc<"conversations">[],
): ConversationCounts {
  const counts = emptyConversationCounts();
  counts.total = conversations.length;

  for (const conversation of conversations) {
    if (conversation.status === "done") counts.done += 1;
    else if (conversation.status === "processing") counts.processing += 1;
    else if (conversation.status === "needs_speaker_labels") {
      counts.needsSpeakerLabels += 1;
    } else if (conversation.status === "failed") counts.failed += 1;
  }

  return counts;
}

export function derivePendingWorkStatus(
  counts: ConversationCounts,
): PendingWorkStatus {
  if (counts.needsSpeakerLabels > 0) return "needs_labels";
  if (counts.failed > 0) return "failed";
  if (counts.processing > 0) return "processing";
  return "current";
}

export function getLatestConversation(
  conversations: Doc<"conversations">[],
): Doc<"conversations"> | null {
  let latest: Doc<"conversations"> | null = null;
  for (const conversation of conversations) {
    if (!latest || conversation._creationTime > latest._creationTime) {
      latest = conversation;
    }
  }
  return latest;
}

export function getLatestDoneConversation(
  conversations: Doc<"conversations">[],
): Doc<"conversations"> | null {
  let latest: Doc<"conversations"> | null = null;
  for (const conversation of conversations) {
    if (conversation.status !== "done") continue;
    if (!latest || conversation._creationTime > latest._creationTime) {
      latest = conversation;
    }
  }
  return latest;
}

export function groupConversationsByProcess(
  conversations: Doc<"conversations">[],
): Map<Id<"processes">, Doc<"conversations">[]> {
  const byProcess = new Map<Id<"processes">, Doc<"conversations">[]>();
  for (const conversation of conversations) {
    const current = byProcess.get(conversation.processId) ?? [];
    current.push(conversation);
    byProcess.set(conversation.processId, current);
  }
  return byProcess;
}

export function summarizeFlow(
  flow: Doc<"processFlows"> | null,
  completedConversationCount: number,
) {
  if (!flow) return null;

  const painPoints = new Set<string>();
  for (const node of flow.nodes) {
    for (const painPoint of node.painPoints) painPoints.add(painPoint);
  }

  return {
    _id: flow._id,
    status: flow.status,
    stale:
      flow.stale ||
      (flow.status === "ready" &&
        completedConversationCount > flow.conversationCount),
    generatedAt: flow.generatedAt,
    conversationCount: flow.conversationCount,
    nodeCount: flow.nodes.length,
    edgeCount: flow.edges.length,
    decisionCount: flow.nodes.filter((node) => node.category === "decision")
      .length,
    painPointCount: painPoints.size,
    handoffCount: flow.insights.handoffCount,
    toolCount: flow.insights.toolCount,
  };
}

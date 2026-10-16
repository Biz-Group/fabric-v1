/** Contributions that exist but can't feed a flow yet. */
export type PendingConversationCounts = {
  processing: number;
  needsLabels: number;
};

/**
 * Why there's nothing to generate a flow from yet. Contributions still in the
 * pipeline aren't usable, so name them instead of asking for a first one.
 */
export function noConversationsMessage({
  processing,
  needsLabels,
}: PendingConversationCounts): string {
  if (processing > 0) {
    return processing === 1
      ? "1 contribution is still processing. The flow can be generated once it's done."
      : `${processing} contributions are still processing. The flow can be generated once one is done.`;
  }
  if (needsLabels > 0) {
    return needsLabels === 1
      ? "1 contribution needs speaker labels before it can be used."
      : `${needsLabels} contributions need speaker labels before they can be used.`;
  }
  return "Add at least one contribution first.";
}

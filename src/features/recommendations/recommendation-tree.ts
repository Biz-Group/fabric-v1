import type { ClientRecommendation } from "./recommendation-meta";

/**
 * Recommendations as the list shows them: each with the follow-ons that build
 * on it nested underneath.
 *
 * A follow-on is a next step, not a separate recommendation, so it sits under
 * its parent wherever the parent sits — open, dismissed or no longer
 * recommended — whatever its own decision is. It is still decided on its own.
 * Nesting is one level deep. A follow-on whose parent is missing, or is itself
 * a follow-on, is shown at the top level rather than lost.
 */

export type RecommendationNode = {
  rec: ClientRecommendation;
  followOns: ClientRecommendation[];
};

export type RecommendationGroups = {
  open: RecommendationNode[];
  dismissed: RecommendationNode[];
  earlier: RecommendationNode[];
};

export function groupRecommendations(
  /** Active recommendations, already ranked. */
  current: readonly ClientRecommendation[],
  /** Recommendations the latest run no longer returned. */
  earlier: readonly ClientRecommendation[],
): RecommendationGroups {
  const all = [...current, ...earlier];
  const byId = new Map(all.map((rec) => [rec._id as string, rec]));

  const parentOf = (rec: ClientRecommendation): ClientRecommendation | null => {
    if (!rec.buildsOnId || rec.buildsOnId === rec._id) return null;
    const parent = byId.get(rec.buildsOnId);
    // One level only: a parent that is itself nested cannot take children.
    if (!parent || (parent.buildsOnId && byId.has(parent.buildsOnId))) {
      return null;
    }
    return parent;
  };

  const followOnsOf = new Map<string, ClientRecommendation[]>();
  for (const rec of all) {
    const parent = parentOf(rec);
    if (!parent) continue;
    const list = followOnsOf.get(parent._id) ?? [];
    list.push(rec);
    followOnsOf.set(parent._id, list);
  }

  const groups: RecommendationGroups = { open: [], dismissed: [], earlier: [] };
  for (const rec of all) {
    if (parentOf(rec)) continue;
    const node = { rec, followOns: followOnsOf.get(rec._id) ?? [] };
    if (rec.lifecycle !== "active") groups.earlier.push(node);
    else if (rec.decisionStatus === "dismissed") groups.dismissed.push(node);
    else groups.open.push(node);
  }
  return groups;
}

/** Every recommendation in display order: each parent, then its follow-ons. */
export function flattenNodes(
  nodes: readonly RecommendationNode[],
): ClientRecommendation[] {
  return nodes.flatMap((node) => [node.rec, ...node.followOns]);
}

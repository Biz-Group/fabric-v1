/**
 * Which incoming recommendations are the same as ones already stored.
 *
 * Identity is what lets a decision survive regeneration: shortlist something,
 * regenerate the flow, and it must still be shortlisted. Graph regeneration
 * can rename node ids, so exact node-set matching alone loses identity. In
 * order:
 *
 *   1. The model was shown the stored recommendations and may say "this is
 *      id X". Accepted only if X is a stored recommendation of this process
 *      that nothing else has already claimed.
 *   2. Otherwise, an exact match key (sorted node ids + intervention).
 *   3. Otherwise, it is new.
 *
 * Title similarity is deliberately not a key: two different changes to the
 * same steps often have near-identical titles.
 *
 * Pure, so the cases (rename, split, merge, removal, node-id churn) are tested
 * without a database. See docs/process-improvement-recommendations-plan.md §9.3.
 */

export type StoredRecommendation = {
  id: string;
  matchKey: string;
  lifecycle: "active" | "absent_from_latest";
  decisionStatus: "new" | "shortlisted" | "dismissed" | "in_progress" | "done";
};

export type IncomingRecommendation = {
  matchKey: string;
  previousRecommendationId?: string;
};

export type ReconcilePlan = {
  /** Same order as the incoming list; `null` means insert a new row. */
  matches: Array<string | null>;
  /** Stored rows the latest run did not return, and what they become. */
  unmatched: Array<{
    id: string;
    lifecycle: "absent_from_latest" | "superseded";
  }>;
};

export function planReconciliation(
  stored: readonly StoredRecommendation[],
  incoming: readonly IncomingRecommendation[],
): ReconcilePlan {
  const byId = new Map(stored.map((row) => [row.id, row]));
  const claimed = new Set<string>();
  const matches: Array<string | null> = incoming.map(() => null);

  // Pass 1: ids the model vouched for. Done for every incoming row before any
  // key matching, so a key match cannot steal a row the model named for a
  // different recommendation.
  incoming.forEach((rec, index) => {
    const id = rec.previousRecommendationId;
    if (id && byId.has(id) && !claimed.has(id)) {
      matches[index] = id;
      claimed.add(id);
    }
  });

  // Pass 2: exact keys, for whatever is still unmatched.
  incoming.forEach((rec, index) => {
    if (matches[index] !== null) return;
    const hit = stored.find(
      (row) => !claimed.has(row.id) && row.matchKey === rec.matchKey,
    );
    if (hit) {
      matches[index] = hit.id;
      claimed.add(hit.id);
    }
  });

  // A row someone decided about stays visible as "earlier"; an untouched one
  // has nothing worth keeping and is superseded. A row already absent stays
  // absent rather than being reported as a change.
  const unmatched = stored
    .filter((row) => !claimed.has(row.id) && row.lifecycle === "active")
    .map((row) => ({
      id: row.id,
      lifecycle:
        row.decisionStatus === "new"
          ? ("superseded" as const)
          : ("absent_from_latest" as const),
    }));

  return { matches, unmatched };
}

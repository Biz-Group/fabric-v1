import type { OverviewFinding } from "@/features/overview/overview-primitives";

/**
 * Section ids on the process overview. The key facts and the "On this page"
 * row jump to these, so they live in one place with the sections themselves.
 */
export const PROCESS_OVERVIEW_SECTION_IDS = {
  scope: "process-scope",
  variations: "process-variations",
  alignment: "process-agreements-gaps",
  notable: "process-notable-context",
} as const;

// Scope returns at most one finding per orientation fact (trigger, finish,
// roles, systems, dependencies), so four covers the facts a reader needs first
// without the strip outgrowing the brief it introduces.
const MAX_SCOPE_FACTS = 4;

export type ProcessKeyFact = {
  key: string;
  kind: "scope" | "open_question";
  label: string;
  text: string;
  /** The finding row this fact summarises, where its sources live. */
  targetId: string;
};

/** A DOM id for one finding row; finding ids come from the model, so sanitize. */
export function findingAnchorId(sectionId: string, findingId: string): string {
  return `${sectionId}-finding-${findingId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

/**
 * The first-screen facts for a process: its scope findings as written (the
 * scope prompt asks for trigger, completion, roles and systems, but the
 * findings carry no type, so they are shown rather than classified), then the
 * first open question. Each points at the full row with its evidence.
 */
export function processKeyFacts({
  scope,
  gaps,
}: {
  scope: OverviewFinding[];
  gaps: OverviewFinding[];
}): ProcessKeyFact[] {
  const facts: ProcessKeyFact[] = scope.slice(0, MAX_SCOPE_FACTS).map((finding) => ({
    key: `scope:${finding.id}`,
    kind: "scope",
    label: finding.title,
    text: finding.body,
    targetId: findingAnchorId(PROCESS_OVERVIEW_SECTION_IDS.scope, finding.id),
  }));
  const openQuestion = gaps[0];
  if (openQuestion) {
    facts.push({
      key: `gap:${openQuestion.id}`,
      kind: "open_question",
      label: "Open question",
      text: openQuestion.title,
      targetId: findingAnchorId(PROCESS_OVERVIEW_SECTION_IDS.alignment, openQuestion.id),
    });
  }
  return facts;
}

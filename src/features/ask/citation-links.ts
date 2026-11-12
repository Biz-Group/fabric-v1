import { parseFabricSource } from "../../../convex/askTools/results";
import type { CitationView } from "../../../convex/lib/citationLinks";

// The link mapping lives in convex/lib so the MCP server shares it.
export {
  chartLinkHref,
  citationTarget,
  entityHref,
  flowStepHref,
  type CitationPath,
  type CitationTarget,
  type CitationView,
} from "../../../convex/lib/citationLinks";

export type SourceKind =
  | "process"
  | "department"
  | "function"
  | "flow"
  | "contribution"
  | "help"
  | "workspace"
  | "members";

const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  process: "Process",
  department: "Department",
  function: "Function",
  flow: "Process flow",
  contribution: "Contribution",
  help: "Help article",
  workspace: "Workspace",
  members: "Members",
};

/** What kind of thing a citation points at, for the sources list's icon and label. */
export function sourceKind(source: string): SourceKind | null {
  const parsed = parseFabricSource(source);
  if (!parsed) return null;
  switch (parsed.type) {
    case "org":
      return "workspace";
    case "help":
      return "help";
    case "members":
      return "members";
    case "flowNode":
      return "flow";
    case "conversation":
    case "transcriptLine":
      return "contribution";
    case "entity":
    case "overview":
    case "finding":
      return parsed.sourceKind as "function" | "department" | "process";
  }
}

export function sourceKindLabel(kind: SourceKind): string {
  return SOURCE_KIND_LABEL[kind];
}

const EVIDENCE_ORDER = ["contribution", "process", "flow", "department", "function", "help"] as const;
type EvidenceKind = (typeof EVIDENCE_ORDER)[number];

const EVIDENCE_NOUN: Record<EvidenceKind, [string, string]> = {
  contribution: ["contribution", "contributions"],
  process: ["process", "processes"],
  flow: ["process flow", "process flows"],
  department: ["department", "departments"],
  function: ["function", "functions"],
  help: ["help article", "help articles"],
};

/**
 * What an answer stands on (the evidence line): distinct contributions,
 * processes, flows, departments, functions and help articles among its
 * available citations. Derived from stored citations, so older answers get it
 * too. Workspace and member lists aren't evidence in this sense.
 */
export function evidenceSummary(
  citations: CitationView[],
): Array<{ kind: EvidenceKind; count: number; label: string }> {
  const seen = new Map<EvidenceKind, Set<string>>();
  for (const citation of citations) {
    if (citation.availability === "unavailable") continue;
    const parsed = parseFabricSource(citation.source);
    const kind = sourceKind(citation.source);
    if (!parsed || !kind || !(EVIDENCE_ORDER as readonly string[]).includes(kind)) continue;
    // A flow is cited node by node; its source id is the process, so one flow counts once.
    const ids = seen.get(kind as EvidenceKind) ?? new Set<string>();
    ids.add(parsed.sourceEntityId);
    seen.set(kind as EvidenceKind, ids);
  }
  return EVIDENCE_ORDER.flatMap((kind) => {
    const count = seen.get(kind)?.size ?? 0;
    if (count === 0) return [];
    const [one, many] = EVIDENCE_NOUN[kind];
    return [{ kind, count, label: `${count} ${count === 1 ? one : many}` }];
  });
}

/**
 * The answer's sources grouped by the entity they come from (FR-5.1), in the
 * order each entity is first cited. Repeated results already share a number.
 * A group of different results is labelled by its first and a count, so one
 * finding's title never stands for the others.
 */
export function groupSources(
  citations: CitationView[],
): Array<{ key: string; label: string; citations: CitationView[] }> {
  const groups = new Map<string, CitationView[]>();
  for (const citation of [...citations].sort((a, b) => a.ordinal - b.ordinal)) {
    const parsed = parseFabricSource(citation.source);
    const key = parsed ? `${parsed.sourceKind}:${parsed.sourceEntityId}` : citation.source;
    groups.set(key, [...(groups.get(key) ?? []), citation]);
  }
  return [...groups.entries()].map(([key, grouped]) => {
    const others = new Set(grouped.map((c) => c.title)).size - 1;
    const label = others > 0 ? `${grouped[0].title} and ${others} more` : grouped[0].title;
    return { key, label, citations: grouped };
  });
}

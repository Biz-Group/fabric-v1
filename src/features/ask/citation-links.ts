import { parseFabricSource } from "../../../convex/askTools/results";

/**
 * Where a citation chip leads (FR-5.2). One module maps every Fabric source to
 * a workbench link within the current org; sources never carry an org id.
 */

export type CitationPath = { fn: string | null; dept: string | null; proc: string | null };

export type CitationView = {
  ordinal: number;
  source: string;
  availability: "available" | "unavailable" | "updated";
  path: CitationPath;
  title: string;
  citedText: string | null;
};

export type CitationTarget =
  | { kind: "link"; href: string }
  | { kind: "help"; articleId: string }
  | { kind: "none" };

/** Workbench query parameters, in the order the workbench writes them. */
type Query = Partial<Record<"fn" | "dept" | "proc" | "tab" | "node" | "conv" | "finding" | "t" | "line", string>>;

function withQuery(appHref: string, query: Query): string {
  const params = new URLSearchParams();
  for (const key of ["fn", "dept", "proc", "tab", "node", "conv", "finding", "t", "line"] as const) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  const search = params.toString();
  return search ? `${appHref}?${search}` : appHref;
}

/** The path's ids down to `depth`, or null when the path doesn't reach it. */
function pathQuery(path: CitationPath, depth: "function" | "department" | "process"): Query | null {
  if (!path.fn) return null;
  if (depth === "function") return { fn: path.fn };
  if (!path.dept) return null;
  if (depth === "department") return { fn: path.fn, dept: path.dept };
  if (!path.proc) return null;
  return { fn: path.fn, dept: path.dept, proc: path.proc };
}

/** An entity card's link: the entity's workbench page, as a citation of it opens (FR-5.2). */
export function entityHref(
  path: CitationPath,
  kind: "function" | "department" | "process",
  appHref: string,
): string | null {
  const query = pathQuery(path, kind);
  return query ? withQuery(appHref, query) : null;
}

export function citationTarget(
  citation: Pick<CitationView, "source" | "availability" | "path">,
  routes: { appHref: string; adminUsersHref: string },
): CitationTarget {
  if (citation.availability === "unavailable") return { kind: "none" };
  const parsed = parseFabricSource(citation.source);
  if (!parsed) return { kind: "none" };
  const updated = citation.availability === "updated";
  const last = citation.source.slice(citation.source.lastIndexOf("/") + 1);
  const link = (query: Query | null): CitationTarget =>
    query ? { kind: "link", href: withQuery(routes.appHref, query) } : { kind: "none" };

  switch (parsed.type) {
    case "org":
      return { kind: "link", href: routes.appHref };
    case "help":
      return { kind: "help", articleId: parsed.sourceEntityId };
    case "members":
      return { kind: "link", href: routes.adminUsersHref };
    case "entity":
    case "overview":
      return link(pathQuery(citation.path, parsed.sourceKind as "function" | "department" | "process"));
    case "finding": {
      const base = pathQuery(citation.path, parsed.sourceKind as "function" | "department" | "process");
      // A finding that has since changed links to its entity's overview.
      return link(base && (updated ? base : { ...base, finding: last }));
    }
    case "flowNode": {
      const base = pathQuery(citation.path, "process");
      return link(base && { ...base, tab: "flow", ...(updated ? {} : { node: last }) });
    }
    case "conversation":
    case "transcriptLine": {
      const base = pathQuery(citation.path, "process");
      if (!base) return { kind: "none" };
      const query: Query = { ...base, tab: "conversations", conv: parsed.sourceEntityId };
      if (parsed.type === "transcriptLine") {
        const params = new URLSearchParams(citation.source.slice(citation.source.indexOf("?") + 1));
        query.t = params.get("t") ?? undefined;
        query.line = params.get("line") ?? undefined;
      }
      return link(query);
    }
  }
}

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

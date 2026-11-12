import { parseFabricSource } from "../askTools/results";

/**
 * Where a citation leads (FR-5.2). One module maps every Fabric source to a
 * workbench link within the current org; sources never carry an org id. Used
 * by the AskFabric UI (re-exported from src/features/ask/citation-links.ts)
 * and by the MCP server, which turns each link into an absolute URL.
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

/** A flow step's link: the process's Process Flow tab with the step selected, as a citation of it opens. */
export function flowStepHref(path: CitationPath, nodeId: string, appHref: string): string | null {
  const query = pathQuery(path, "process");
  return query ? withQuery(appHref, { ...query, tab: "flow", node: nodeId }) : null;
}

/** A chart point's link: its entity's workbench page, on the tab and step the chart names. */
export function chartLinkHref(
  link: { fn: string | null; dept: string | null; proc: string | null; tab: string | null; node: string | null },
  appHref: string,
): string | null {
  if (!link.fn) return null;
  return withQuery(appHref, {
    fn: link.fn,
    dept: link.dept ?? undefined,
    proc: link.proc ?? undefined,
    tab: link.tab ?? undefined,
    node: link.node ?? undefined,
  });
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


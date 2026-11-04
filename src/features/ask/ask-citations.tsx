"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen,
  Building2,
  Cog,
  FileText,
  GitBranch,
  LayoutGrid,
  Layers,
  Mic,
  Users,
  type LucideIcon,
} from "lucide-react";
import { HELP_ARTICLES } from "../../../convex/askTools/helpCorpus.generated";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useWorkspaceRoutes } from "@/features/shell/use-workspace-routes";
import { cn } from "@/lib/utils";
import {
  citationTarget,
  evidenceSummary,
  groupSources,
  sourceKind,
  sourceKindLabel,
  type CitationView,
  type SourceKind,
} from "./citation-links";
import { markersToLinks } from "./trace-view-model";

// Tinted with the org accent so sources stand out from the text; a
// monochrome tenant gets a light neutral tint with an outline.
const CHIP =
  "mx-0.5 inline-flex h-4 min-w-4 -translate-y-px items-center justify-center rounded-full bg-org-accent-subtle px-1 align-middle text-[10px] font-medium tabular-nums text-foreground no-underline ring-1 ring-org-accent-border ring-inset transition-colors hover:bg-org-accent hover:text-org-accent-foreground hover:ring-org-accent focus-visible:outline-2 focus-visible:outline-ring";

/** The workbench's icons for each kind of source (command palette, process tabs). */
const SOURCE_ICON: Record<SourceKind, LucideIcon> = {
  process: Cog,
  department: Layers,
  function: Building2,
  flow: GitBranch,
  contribution: Mic,
  help: BookOpen,
  workspace: LayoutGrid,
  members: Users,
};

function CitationCard({ citation }: { citation: CitationView }) {
  if (citation.availability === "unavailable") {
    return <p className="text-sm text-muted-foreground">Source no longer available.</p>;
  }
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-foreground">{citation.title}</p>
      {citation.citedText && (
        <p className="line-clamp-6 border-l-2 pl-2 text-xs leading-relaxed text-muted-foreground">
          {citation.citedText}
        </p>
      )}
      {citation.availability === "updated" && (
        <p className="text-xs text-muted-foreground">This finding has since been updated.</p>
      )}
    </div>
  );
}

/** A numbered chip after cited text, with a hover card (FR-5.1). */
export function CitationChip({
  citation,
  onOpenHelp,
}: {
  citation: CitationView;
  onOpenHelp: (articleId: string) => void;
}) {
  const routes = useWorkspaceRoutes();
  const target = citationTarget(citation, routes);
  const label = `Source ${citation.ordinal}: ${citation.availability === "unavailable" ? "no longer available" : citation.title}`;
  const trigger =
    target.kind === "link" ? (
      // Same tab, so Back returns to the thread; modifier-click opens a new one (FR-5.6).
      <Link href={target.href} className={CHIP} aria-label={label} />
    ) : target.kind === "help" ? (
      <button type="button" className={CHIP} aria-label={label} onClick={() => onOpenHelp(target.articleId)} />
    ) : (
      <span className={cn(CHIP, "cursor-default opacity-60")} aria-label={label} />
    );

  return (
    <HoverCard>
      <HoverCardTrigger delay={150} render={trigger}>
        {citation.ordinal}
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-72">
        <CitationCard citation={citation} />
      </HoverCardContent>
    </HoverCard>
  );
}

/** A help article from the approved corpus, for `fabric:help/<id>` citations. */
export function HelpArticleDialog({ articleId, onClose }: { articleId: string | null; onClose: () => void }) {
  const article = HELP_ARTICLES.find((a) => a.id === articleId);
  return (
    <Dialog open={article !== undefined} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        {article && (
          <>
            <DialogHeader>
              <DialogTitle>{article.title}</DialogTitle>
              <DialogDescription>{article.summary}</DialogDescription>
            </DialogHeader>
            <div className="text-sm leading-relaxed text-foreground [&_li]:my-1 [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:my-2 [&_ul]:ml-5 [&_ul]:list-disc">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{article.body}</ReactMarkdown>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function allowCiteLinks(url: string): string {
  return url.startsWith("cite:") ? url : defaultUrlTransform(url);
}

/** The answer as markdown, with citation markers rendered as chips. */
export function AskAnswer({
  text,
  citations,
  onOpenHelp,
}: {
  text: string;
  citations: CitationView[];
  onOpenHelp: (articleId: string) => void;
}) {
  const byOrdinal = new Map(citations.map((citation) => [citation.ordinal, citation]));
  const components: Components = {
    a: ({ href, children }) => {
      if (href?.startsWith("cite:")) {
        const citation = byOrdinal.get(Number(href.slice(5)));
        return citation ? <CitationChip citation={citation} onOpenHelp={onOpenHelp} /> : null;
      }
      return (
        <a href={href} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
          {children}
        </a>
      );
    },
    p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
    ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 ml-5 list-decimal space-y-1">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
    h1: ({ children }) => <h3 className="mt-4 mb-1 text-sm font-semibold">{children}</h3>,
    h2: ({ children }) => <h3 className="mt-4 mb-1 text-sm font-semibold">{children}</h3>,
    h3: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-semibold">{children}</h4>,
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto rounded-md border">
        <table className="w-full text-left text-xs">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className="border-b bg-muted/50 px-2 py-1.5 font-medium">{children}</th>,
    td: ({ children }) => <td className="border-b px-2 py-1.5 align-top last:border-b-0">{children}</td>,
  };
  return (
    <div className="text-sm text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={allowCiteLinks} components={components}>
        {markersToLinks(text)}
      </ReactMarkdown>
    </div>
  );
}

/**
 * What the answer stands on, one line under the byline: distinct
 * contributions, processes, flows and so on among its citations.
 */
export function AskEvidence({ citations }: { citations: CitationView[] }) {
  const items = evidenceSummary(citations);
  if (items.length === 0) return null;
  return (
    <p className="mb-3 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
      <span className="sr-only">Based on</span>
      {items.map((item) => {
        const Icon = SOURCE_ICON[item.kind];
        return (
          <span key={item.kind} className="inline-flex items-center gap-1.5 tabular-nums">
            <Icon className="size-3.5" aria-hidden />
            {item.label}
          </span>
        );
      })}
    </p>
  );
}

/** Chips a source row shows before "+N more": a flow cited node by node can run to dozens. */
const CHIPS_SHOWN = 4;

function SourceRow({
  group,
  onOpenHelp,
}: {
  group: ReturnType<typeof groupSources>[number];
  onOpenHelp: (articleId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const kind = sourceKind(group.citations[0].source);
  const Icon = kind ? SOURCE_ICON[kind] : FileText;
  const hidden = group.citations.length - CHIPS_SHOWN;
  const chips = expanded || hidden <= 0 ? group.citations : group.citations.slice(0, CHIPS_SHOWN);
  return (
    <li className="flex min-w-0 items-start gap-2.5 py-1.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-xs font-medium text-foreground"
          title={group.citations.map((c) => `${c.ordinal}. ${c.title}`).join("\n")}
        >
          {group.label}
        </span>
        {/* Under the title, so many chips wrap instead of covering it. */}
        <span className="mt-0.5 flex flex-wrap items-center gap-y-1 text-[11px] text-muted-foreground">
          {kind && <span className="mr-1">{sourceKindLabel(kind)}</span>}
          {chips.map((citation) => (
            <CitationChip key={citation.ordinal} citation={citation} onOpenHelp={onOpenHelp} />
          ))}
          {hidden > 0 && (
            <button
              type="button"
              className="ml-1 rounded-sm text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Show fewer" : `+${hidden} more`}
            </button>
          )}
        </span>
      </span>
    </li>
  );
}

/** Source rows shown before "Show all": three rows of two on wider screens. */
const SOURCES_SHOWN = 6;

/** The answer's sources, grouped by the entity they come from (FR-5.1). */
export function AskSources({
  citations,
  onOpenHelp,
}: {
  citations: CitationView[];
  onOpenHelp: (articleId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (citations.length === 0) return null;
  const groups = groupSources(citations);
  const shown = open ? groups : groups.slice(0, SOURCES_SHOWN);
  return (
    <div className="mt-4 border-t pt-3">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
        Sources · {citations.length}
      </p>
      <ul className="grid gap-x-4 sm:grid-cols-2">
        {shown.map((group) => (
          <SourceRow key={group.key} group={group} onOpenHelp={onOpenHelp} />
        ))}
      </ul>
      {groups.length > SOURCES_SHOWN && (
        <button
          type="button"
          className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Show fewer" : `Show all ${groups.length}`}
        </button>
      )}
    </div>
  );
}

export function HelpDialogHost({ children }: { children: (open: (id: string) => void) => ReactNode }) {
  const [articleId, setArticleId] = useState<string | null>(null);
  return (
    <>
      {children(setArticleId)}
      <HelpArticleDialog articleId={articleId} onClose={() => setArticleId(null)} />
    </>
  );
}

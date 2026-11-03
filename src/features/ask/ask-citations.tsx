"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { HELP_ARTICLES } from "../../../convex/askTools/helpCorpus.generated";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useWorkspaceRoutes } from "@/features/shell/use-workspace-routes";
import { cn } from "@/lib/utils";
import { citationTarget, groupSources, type CitationView } from "./citation-links";
import { markersToLinks } from "./trace-view-model";

const CHIP =
  "mx-0.5 inline-flex h-4 min-w-4 -translate-y-px items-center justify-center rounded-full bg-muted px-1 align-middle text-[10px] font-medium tabular-nums text-muted-foreground no-underline transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring";

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
  const shown = open ? groups : groups.slice(0, 3);
  return (
    <div className="mt-3 border-t pt-2">
      <p className="mb-1 text-xs font-medium text-muted-foreground">
        Sources · {citations.length}
      </p>
      <ul className="space-y-1">
        {shown.map((group) => (
          <li key={group.key} className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <span className="flex shrink-0 gap-0.5 pt-px">
              {group.citations.map((citation) => (
                <CitationChip key={citation.ordinal} citation={citation} onOpenHelp={onOpenHelp} />
              ))}
            </span>
            <span className="min-w-0 truncate" title={group.citations.map((c) => `${c.ordinal}. ${c.title}`).join("\n")}>
              {group.label}
            </span>
          </li>
        ))}
      </ul>
      {groups.length > 3 && (
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

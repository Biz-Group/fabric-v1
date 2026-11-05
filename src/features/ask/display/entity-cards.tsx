"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { useRef, type KeyboardEvent } from "react";
import { Building2, ChevronLeft, ChevronRight, Cog, Layers, type LucideIcon } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { AskDisplayPart } from "../../../../convex/lib/askSchema";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspaceRoutes } from "@/features/shell/use-workspace-routes";
import { entityHref } from "../citation-links";

type EntityCard = FunctionReturnType<typeof api.askDisplay.getEntityCards>[number];

const KIND: Record<EntityCard["kind"], { label: string; icon: LucideIcon }> = {
  function: { label: "Function", icon: Building2 },
  department: { label: "Department", icon: Layers },
  process: { label: "Process", icon: Cog },
};

const OVERVIEW_STATE: Record<string, string> = {
  current: "Overview current",
  partial: "Overview partial",
  stale: "Overview out of date",
  refreshing: "Overview refreshing",
  failed: "Overview failed",
  missing: "No overview yet",
};

/** Three or more cards scroll sideways; fewer sit in a grid. */
const CAROUSEL_FROM = 3;
/** Every card is this tall, and so is its skeleton, so the stream never jumps. */
const CARD_HEIGHT = "h-40";

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** The card's facts line: the same counts the workbench shows for the entity. */
export function cardFacts(card: Pick<EntityCard, "contributions" | "departments" | "processes" | "overviewGeneratedAt">): string {
  const facts = [
    ...(card.contributions !== null ? [plural(card.contributions, "contribution", "contributions")] : []),
    ...(card.departments !== null ? [plural(card.departments, "department", "departments")] : []),
    ...(card.processes !== null ? [plural(card.processes, "process", "processes")] : []),
    ...(card.overviewGeneratedAt !== null
      ? [`updated ${new Date(card.overviewGeneratedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`]
      : []),
  ];
  return facts.join(" · ");
}

function Card({ card }: { card: EntityCard }) {
  const { appHref } = useWorkspaceRoutes();
  const href = entityHref(card.path, card.kind, appHref);
  const kind = KIND[card.kind];
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
        <kind.icon className="size-3.5 text-org-accent" aria-hidden />
        {kind.label}
      </span>
      <span className="line-clamp-1 text-sm font-semibold text-foreground">{card.name}</span>
      {card.trail.length > 0 && (
        <span className="line-clamp-1 text-xs text-muted-foreground">{card.trail.join(" › ")}</span>
      )}
      <span className="line-clamp-2 text-xs leading-relaxed text-foreground/80">
        {card.headline ?? OVERVIEW_STATE[card.overviewState] ?? "No overview yet"}
      </span>
      <span className="mt-auto text-2xs text-muted-foreground tabular-nums">{cardFacts(card)}</span>
    </>
  );
  const className = `flex ${CARD_HEIGHT} w-full flex-col gap-1 rounded-lg border bg-background p-3 text-left transition-colors`;
  return href ? (
    // Same tab, so Back returns to the thread (FR-5.6).
    <Link href={href} className={`${className} focus-ring hover:border-org-accent-border hover:bg-org-accent-subtle`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function Carousel({ cards }: { cards: EntityCard[] }) {
  const track = useRef<HTMLDivElement>(null);
  const scroll = (direction: 1 | -1) => {
    const element = track.current;
    if (!element) return;
    const card = element.firstElementChild as HTMLElement | null;
    const step = (card?.offsetWidth ?? element.clientWidth) + 12;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollBy({ left: direction * step, behavior: reduce ? "auto" : "smooth" });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight") scroll(1);
    else if (event.key === "ArrowLeft") scroll(-1);
    else return;
    event.preventDefault();
  };
  return (
    <div className="relative">
      <div
        ref={track}
        role="region"
        aria-label={`${cards.length} cards`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="focus-ring flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain rounded-lg pb-1 [scrollbar-width:thin]"
      >
        {cards.map((card) => (
          // One card and a peek of the next at phone width.
          <div key={card.id} className="w-[85%] shrink-0 snap-start sm:w-64">
            <Card card={card} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 hidden justify-end gap-1 sm:flex">
        <Button type="button" size="icon-xs" variant="ghost" aria-label="Previous cards" onClick={() => scroll(-1)}>
          <ChevronLeft aria-hidden />
        </Button>
        <Button type="button" size="icon-xs" variant="ghost" aria-label="Next cards" onClick={() => scroll(1)}>
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/** Entity cards (FR-11.1): live counts, re-authorized on every view (D56). */
export function EntityCards({ part }: { part: AskDisplayPart }) {
  const cards = useQuery(api.askDisplay.getEntityCards, { refs: part.refs });
  if (cards === undefined) {
    const placeholders = Math.min(part.refs.length, CAROUSEL_FROM);
    return (
      <div className="grid gap-3 sm:grid-cols-2" aria-busy>
        {Array.from({ length: placeholders }, (_, index) => (
          <Skeleton key={index} className={`${CARD_HEIGHT} w-full rounded-lg`} />
        ))}
      </div>
    );
  }
  if (cards.length === 0) return null;
  if (cards.length >= CAROUSEL_FROM) return <Carousel cards={cards} />;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cards.map((card) => (
        <Card key={card.id} card={card} />
      ))}
    </div>
  );
}

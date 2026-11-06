"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowDown, ArrowRight, Workflow } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { AskDisplayPart } from "../../../../convex/lib/askSchema";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CATEGORY_CONFIG } from "@/features/process-flow/flow-category";
import { useWorkspaceRoutes } from "@/features/shell/use-workspace-routes";
import { flowStepHref } from "../citation-links";

type Neighbourhood = NonNullable<FunctionReturnType<typeof api.processFlows.getFlowNeighbourhood>>;
type Step = Neighbourhood["step"];
type Neighbour = Neighbourhood["before"][number];

/** The snippet's skeleton is about this tall, so the stream doesn't jump. */
const SNIPPET_HEIGHT = "h-44";

function StepChip({ step, href, focus = false }: { step: Step; href: string | null; focus?: boolean }) {
  const config = CATEGORY_CONFIG[step.category];
  const body = (
    <>
      <span className={cn("flex size-5 shrink-0 items-center justify-center rounded", config.iconBg)} aria-hidden>
        <config.Icon className="size-3" />
      </span>
      <span className="min-w-0">
        <span className={cn("line-clamp-2 break-words leading-snug", focus ? "text-sm font-semibold" : "text-xs font-medium")}>
          {step.label}
        </span>
        <span className="sr-only">, {config.label} step</span>
      </span>
    </>
  );
  const className = cn(
    "flex w-full items-start gap-2 rounded-md border border-l-4 bg-card px-2.5 py-2 text-left text-card-foreground",
    config.color,
    focus && "ring-2 ring-org-accent-border",
  );
  return href ? (
    // Same tab, so Back returns to the thread (FR-5.6).
    <Link href={href} className={cn(className, "focus-ring transition-colors hover:bg-org-accent-subtle")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function Side({
  label,
  steps,
  more,
  empty,
  hrefFor,
}: {
  label: string;
  steps: Neighbour[];
  more: number;
  empty: string;
  hrefFor: (nodeId: string) => string | null;
}) {
  return (
    <div className={cn("min-w-0 flex-col gap-1.5", steps.length === 0 ? "hidden sm:flex" : "flex")}>
      <span className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</span>
      {steps.length === 0 ? (
        <span className="text-xs text-muted-foreground">{empty}</span>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {steps.map((step) => (
            <li key={step.id} className="flex flex-col gap-0.5">
              {step.edgeLabel && (
                // The branch condition, styled like the flow canvas's edge labels.
                <span
                  title={step.edgeLabel}
                  className="line-clamp-1 w-fit max-w-full rounded-full border bg-card px-2 py-px text-2xs font-medium text-muted-foreground"
                >
                  {step.edgeLabel}
                </span>
              )}
              <StepChip step={step} href={hrefFor(step.id)} />
            </li>
          ))}
          {more > 0 && <li className="text-2xs text-muted-foreground">and {more} more</li>}
        </ul>
      )}
    </div>
  );
}

function Arrow({ shown }: { shown: boolean }) {
  return (
    <span className={cn("items-center justify-center text-muted-foreground", shown ? "flex" : "hidden sm:flex")} aria-hidden>
      <ArrowRight className="hidden size-4 sm:block" />
      <ArrowDown className="size-4 sm:hidden" />
    </span>
  );
}

/**
 * A flow snippet (FR-11.3): one step with the steps directly either side,
 * loaded live as the viewer (D56). Plain markup rather than a React Flow
 * canvas, so it reads at phone width and never traps page scroll. Renders
 * nothing once the step is gone from the process's flow.
 */
export function FlowSnippet({ part }: { part: AskDisplayPart }) {
  const process = part.refs.find((ref) => ref.kind === "process");
  const data = useQuery(
    api.processFlows.getFlowNeighbourhood,
    process && part.nodeId ? { processId: process.id as Id<"processes">, nodeId: part.nodeId } : "skip",
  );
  const { appHref } = useWorkspaceRoutes();
  if (!process || !part.nodeId) return null;
  if (data === undefined) return <Skeleton className={`${SNIPPET_HEIGHT} w-full rounded-lg`} aria-busy />;
  if (data === null) return null;

  const hrefFor = (nodeId: string) => flowStepHref(data.path, nodeId, appHref);
  const generated = new Date(data.generatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return (
    <section aria-label={`Where "${data.step.label}" sits in the ${data.processName} flow`} className="rounded-lg border bg-background p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
          <Workflow className="size-3.5 shrink-0 text-org-accent" aria-hidden />
          <span className="truncate">Process flow · {data.processName}</span>
        </span>
        {hrefFor(data.step.id) && (
          <Link href={hrefFor(data.step.id)!} className="focus-ring shrink-0 rounded text-xs font-medium text-org-accent hover:underline">
            Open in Flow
          </Link>
        )}
      </div>
      <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)_auto_minmax(0,1fr)] sm:gap-3">
        <Side label="Before" steps={data.before} more={data.moreBefore} empty="Nothing before this step" hrefFor={hrefFor} />
        <Arrow shown={data.before.length > 0} />
        <div className="flex flex-col gap-1.5">
          <span className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">This step</span>
          <StepChip step={data.step} href={null} focus />
        </div>
        <Arrow shown={data.after.length > 0} />
        <Side label="After" steps={data.after} more={data.moreAfter} empty="Nothing after this step" hrefFor={hrefFor} />
      </div>
      <p className="mt-3 text-2xs text-muted-foreground">
        Flow generated {generated}
        {data.stale ? " · new evidence available" : ""}
      </p>
    </section>
  );
}

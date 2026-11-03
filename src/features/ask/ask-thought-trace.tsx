"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronRight, CircleAlert, Lightbulb, Loader2, Search } from "lucide-react";
import type { AskMessagePart } from "../../../convex/lib/askSchema";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ShimmeringText } from "@/components/ui/shimmering-text";
import { cn } from "@/lib/utils";
import {
  statusLine,
  traceDefaultOpen,
  traceHeader,
  traceSteps,
  type MessageStatus,
  type TraceStep,
} from "./trace-view-model";

function seconds(ms: number | null): string | null {
  if (ms === null) return null;
  return ms < 1_000 ? "<1s" : `${Math.round(ms / 1_000)}s`;
}

function StepIcon({ step }: { step: TraceStep }) {
  const base = "size-3.5 shrink-0";
  if (step.status === "active") return <Loader2 className={cn(base, "animate-spin motion-reduce:animate-none")} aria-hidden />;
  if (step.status === "failed") return <CircleAlert className={cn(base, "text-destructive")} aria-hidden />;
  if (step.kind === "reasoning") return <Lightbulb className={base} aria-hidden />;
  return <Search className={base} aria-hidden />;
}

function Step({ step }: { step: TraceStep }) {
  const duration = seconds(step.durationMs);
  return (
    <li className="flex gap-2 py-1">
      <span className="mt-0.5 text-muted-foreground">
        <StepIcon step={step} />
      </span>
      <div className="min-w-0 flex-1 text-xs text-muted-foreground">
        {step.kind === "reasoning" ? (
          <div className="[&_li]:ml-4 [&_li]:list-disc [&_p]:my-0.5 [&_strong]:font-medium">
            <ReactMarkdown>{step.text}</ReactMarkdown>
          </div>
        ) : (
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className={cn(step.status === "failed" && "text-destructive")}>{step.label}</span>
            {step.status === "done" && step.resultCount !== null && (
              <span className="tabular-nums">
                {step.resultCount} result{step.resultCount === 1 ? "" : "s"}
              </span>
            )}
            {step.status === "failed" && <span>Didn&apos;t finish</span>}
          </p>
        )}
      </div>
      {duration && step.status !== "active" && (
        <span className="shrink-0 pt-px text-[11px] tabular-nums text-muted-foreground/70">{duration}</span>
      )}
    </li>
  );
}

/**
 * The collapsible list of an answer's reasoning and tool steps (FR-2.15).
 * Open while the agent works; folds when the answer begins, unless the user
 * has opened or closed it themselves.
 */
export function AskThoughtTrace({
  parts,
  status,
  completedAt,
}: {
  parts: AskMessagePart[];
  status: MessageStatus;
  completedAt: number | null;
}) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const steps = traceSteps(parts, status);
  if (steps.length === 0) return null;
  const open = userOpen ?? traceDefaultOpen(parts, status);
  return (
    <Collapsible open={open} onOpenChange={(next) => setUserOpen(next)} className="mb-2">
      <CollapsibleTrigger className="group flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight
          className="size-3.5 transition-transform group-data-[panel-open]:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        {traceHeader(parts, status, completedAt)}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-1 ml-1.5 border-l pl-3">
          {steps.map((step) => (
            <Step key={step.key} step={step} />
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * One line naming the current step while the answer is worked on (FR-2.15).
 * A polite live region, so screen readers hear each step once rather than
 * every streamed character.
 */
export function AskStatusLine({ parts, status }: { parts: AskMessagePart[]; status: MessageStatus }) {
  const line = statusLine(parts, status);
  return (
    <div aria-live="polite" className="min-h-5 text-sm">
      {line && <ShimmeringText text={line} className="text-sm" />}
    </div>
  );
}

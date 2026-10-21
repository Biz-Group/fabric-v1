"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  Copy,
  FileWarning,
  Workflow,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionLabel } from "@/components/ui/section-label";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingState } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  flowDetailProgress,
  flowHasIncompleteDetails,
  flowStage,
} from "@/lib/flow-status";
import { pluralize } from "@/features/insights/insights-derivations";
import {
  confidenceTone,
  STATUS_TONE_TEXT,
} from "@/features/status/status-meta";
import { useSummaryOverview } from "@/features/workbench/use-summary-overview";
import {
  type AutomationOpportunity,
  composeOpportunityBrief,
} from "@/features/automations/opportunity-brief";
import {
  CONFIDENCE_DEFINITION,
  effectiveOpportunityConfidence,
} from "@/features/automations/opportunity-confidence";

// The list and brief sit side by side from Tailwind's `md`; below it they are
// one pane at a time, and focus has to follow the pane that is showing.
const SPLIT_PANE_QUERY = "(min-width: 48rem)";

const KIND_LABEL: Record<AutomationOpportunity["kind"], string> = {
  agent: "Agent",
  workflow: "Workflow",
  integration: "Integration",
  other: "Automation",
};

const CONFIDENCE_CLASS: Record<AutomationOpportunity["confidence"], string> = {
  high: STATUS_TONE_TEXT[confidenceTone.high],
  medium: STATUS_TONE_TEXT[confidenceTone.medium],
  low: STATUS_TONE_TEXT[confidenceTone.low],
};

const markdownComponents: Components = {
  h1: () => null, // The title is already the panel heading.
  h2: ({ children }) => (
    <SectionLabel
      render={<h3 />}
      className="mt-6 mb-2 text-foreground first:mt-0"
    >
      {children}
    </SectionLabel>
  ),
  p: ({ children }) => (
    <p className="my-2 break-words text-sm leading-6 text-muted-foreground">
      {children}
    </p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  ul: ({ children }) => (
    <ul className="my-2 ml-4 list-disc space-y-1 break-words text-sm text-muted-foreground">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 ml-4 list-decimal space-y-1.5 break-words text-sm text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-6">{children}</li>,
};

/**
 * Automation opportunities and the copy-paste brief for each one.
 *
 * V0: the brief is composed from the flow and overview artifacts that already
 * exist — no AI call, nothing persisted. See
 * `docs/agent-opportunities-prd.md` § Phase V0.
 */
export function ProcessAutomationsTab({
  processId,
  processName,
  departmentName,
  functionName,
  onOpenProcessFlow,
  onAddContribution,
}: {
  processId: Id<"processes">;
  processName: string;
  departmentName?: string | null;
  functionName?: string | null;
  onOpenProcessFlow?: () => void;
  /** Pass only when the viewer may capture; the empty state offers it then. */
  onAddContribution?: () => void;
}) {
  const flow = useQuery(api.processFlows.getProcessFlow, { processId });
  const overview = useSummaryOverview({ kind: "process", processId });
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  const [showDetailOnMobile, setShowDetailOnMobile] = useState(false);
  const briefHeadingRef = useRef<HTMLHeadingElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  // Set by the action that swaps panes, consumed once the swapped-in pane has
  // rendered. A ref, not state: it must not cause a render of its own.
  const pendingFocusRef = useRef<"brief" | "row" | null>(null);

  const opportunities = useMemo<AutomationOpportunity[]>(() => {
    if (!flow) return [];
    // Only analysed opportunities carry the structure a brief needs. The
    // node-derived fallback is a list of strings pointing at automatable-looking
    // steps, and briefing from it would present guesses as findings.
    if (flow.insights.automationOpportunitiesSource === "derived") return [];
    return flow.insights.automationOpportunityDetails ?? [];
  }, [flow]);

  // Derived, not synced: a regeneration that drops or renames the selected
  // opportunity falls back to the first one on the next render, with no effect
  // and no window where the panel points at something that no longer exists.
  const selected =
    opportunities.find((item) => item.title === selectedTitle) ??
    opportunities[0] ??
    null;

  useEffect(() => {
    const pending = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (!pending || !selected) return;
    if (pending === "brief") {
      const heading = briefHeadingRef.current;
      heading?.scrollIntoView({ block: "start" });
      heading?.focus({ preventScroll: true });
      return;
    }
    const row = rowRefs.current.get(selected.title);
    row?.scrollIntoView({ block: "nearest" });
    row?.focus({ preventScroll: true });
  }, [showDetailOnMobile, selected]);

  if (flow === undefined || overview === undefined) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (flow === null) {
    return (
      <TabShell>
        <EmptyState
          icon={Bot}
          title="No process flow yet"
          description="Automations are read from the process flow. Generate the flow first, and the Potential automations will appear here."
          action={
            onOpenProcessFlow ? (
              <Button size="sm" variant="outline" onClick={onOpenProcessFlow}>
                Open Process Flow
              </Button>
            ) : undefined
          }
        />
      </TabShell>
    );
  }

  const stage = flowStage(flow);

  if (stage === "graph" || stage === "details") {
    const progress = flowDetailProgress(flow);
    return (
      <TabShell>
        <LoadingState
          title={
            stage === "graph"
              ? "Mapping the process"
              : "Describing the steps"
          }
          description={
            stage === "graph"
              ? "Automations are identified once the process flow has been mapped."
              : progress
                ? `Step detail is ${progress.completed} of ${progress.total} complete. Automations appear once the analysis finishes.`
                : "Automations appear once the step analysis finishes."
          }
        />
      </TabShell>
    );
  }

  if (stage === "failed" && flow.nodes.length === 0) {
    return (
      <TabShell>
        <EmptyState
          icon={FileWarning}
          title="Process flow generation failed"
          description={
            flow.errorMessage ??
            "The last run did not complete, so no automations could be identified. Retry generation from the Process Flow tab."
          }
          action={
            onOpenProcessFlow ? (
              <Button size="sm" variant="outline" onClick={onOpenProcessFlow}>
                Open Process Flow
              </Button>
            ) : undefined
          }
        />
      </TabShell>
    );
  }

  const source = flow.insights.automationOpportunitiesSource;
  // Flows generated before opportunities were analysed carry no source and no
  // details. "Found nothing" would be false for them: nothing was looked for.
  const predatesAnalysis = source === undefined && opportunities.length === 0;
  if (source === "derived" || predatesAnalysis) {
    return (
      <TabShell>
        <EmptyState
          icon={AlertTriangle}
          title="Automations were not analysed for this run"
          description={
            predatesAnalysis
              ? "This process flow was generated before automations were analysed. Regenerate the process flow to get Potential automations."
              : "The analysis stage fell back to flagging automatable-looking steps, which is not enough to brief a build. Regenerate the process flow to get Potential automations."
          }
          action={
            onOpenProcessFlow ? (
              <Button size="sm" variant="outline" onClick={onOpenProcessFlow}>
                Open Process Flow
              </Button>
            ) : undefined
          }
        />
      </TabShell>
    );
  }

  if (opportunities.length === 0) {
    return (
      <TabShell>
        <EmptyState
          icon={Bot}
          title="No automations recommended"
          description="The analysis ran and found nothing in this process worth automating yet. More contributions covering exceptions and handoffs usually surface candidates."
          action={
            onAddContribution ? (
              <Button size="sm" variant="outline" onClick={onAddContribution}>
                Add a contribution
              </Button>
            ) : onOpenProcessFlow ? (
              <Button size="sm" variant="outline" onClick={onOpenProcessFlow}>
                Open Process Flow
              </Button>
            ) : undefined
          }
        />
      </TabShell>
    );
  }

  const artifact =
    overview.content.format === "v2" ? overview.content.artifact : null;
  const brief = selected
    ? composeOpportunityBrief({
        opportunity: selected,
        nodes: flow.nodes,
        edges: flow.edges,
        criticalPath: flow.insights.criticalPath,
        processName,
        departmentName,
        functionName,
        overview: artifact
          ? {
              executiveBrief: artifact.executiveBrief,
              gaps: artifact.gaps.map((gap) => ({
                title: gap.title,
                body: gap.body,
              })),
            }
          : null,
        coverage: overview.coverage,
      })
    : null;

  return (
    <div className="flex min-h-0 flex-col">
      {(flow.stale || flowHasIncompleteDetails(flow)) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-warning-border bg-warning-subtle px-4 py-2 text-xs text-foreground">
          <span className="min-w-0 flex-1 basis-60">
            {flow.stale
              ? "New contributions have landed since this flow was generated. Regenerate the process flow for automations that reflect them."
              : "Some steps were never described, so these briefs report a floor, not a complete picture."}
          </span>
          {onOpenProcessFlow ? (
            <Button
              size="sm"
              variant="outline"
              className="bg-background"
              onClick={onOpenProcessFlow}
            >
              Open Process Flow
            </Button>
          ) : null}
        </div>
      )}

      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
        <div
          className={cn(
            "min-w-0 border-b md:border-b-0 md:border-r",
            showDetailOnMobile && "hidden md:block",
          )}
        >
          <div className="border-b px-4 py-3">
            <SectionLabel>Potential automations</SectionLabel>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {pluralize(opportunities.length, "opportunity", "opportunities")}{" "}
              from {pluralize(flow.conversationCount, "contribution")}
            </p>
          </div>
          <ul className="divide-y">
            {opportunities.map((opportunity) => {
              const isSelected = selected?.title === opportunity.title;
              const confidence = effectiveOpportunityConfidence(
                opportunity.confidence,
                overview.coverage?.uniqueContributors,
              );
              return (
                <li key={`${opportunity.kind}:${opportunity.title}`}>
                  <button
                    type="button"
                    ref={(node) => {
                      if (node) rowRefs.current.set(opportunity.title, node);
                      else rowRefs.current.delete(opportunity.title);
                    }}
                    onClick={() => {
                      setSelectedTitle(opportunity.title);
                      setShowDetailOnMobile(true);
                      if (!window.matchMedia(SPLIT_PANE_QUERY).matches) {
                        pendingFocusRef.current = "brief";
                      }
                    }}
                    aria-current={isSelected ? "true" : undefined}
                    className={cn(
                      "flex w-full items-start gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-ring-inset",
                      isSelected && "bg-muted/70",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-5">
                        {opportunity.title}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="gap-1 text-2xs">
                          {opportunity.kind === "agent" ? (
                            <Bot className="size-3" />
                          ) : (
                            <Workflow className="size-3" />
                          )}
                          {KIND_LABEL[opportunity.kind]}
                        </Badge>
                        <span className="text-2xs text-muted-foreground">
                          {pluralize(opportunity.nodeIds.length, "step")}
                        </span>
                        <span
                          className={cn(
                            "text-2xs capitalize",
                            CONFIDENCE_CLASS[confidence.level],
                          )}
                        >
                          {confidence.level} confidence
                        </span>
                      </span>
                    </span>
                    <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground md:hidden" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div
          className={cn(
            "min-w-0",
            !showDetailOnMobile && "hidden md:block",
          )}
        >
          {brief && selected ? (
            <article className="p-4 sm:p-6">
              <Button
                size="sm"
                variant="ghost"
                className="mb-3 -ml-2 gap-1.5 md:hidden"
                onClick={() => {
                  pendingFocusRef.current = "row";
                  setShowDetailOnMobile(false);
                }}
              >
                <ArrowLeft className="size-3.5" />
                All automations
              </Button>

              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2
                    ref={briefHeadingRef}
                    tabIndex={-1}
                    className="text-base font-semibold leading-6 focus:outline-none"
                  >
                    {selected.title}
                  </h2>
                  <OpportunityEvidence
                    confidence={selected.confidence}
                    coverage={overview.coverage}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Paste this into Copilot Studio&apos;s agent builder as the
                    description of what to build.
                  </p>
                </div>
                <CopyBriefButton markdown={brief.body} />
              </div>

              <div className="mt-5 max-w-3xl">
                <ReactMarkdown components={markdownComponents}>
                  {brief.body}
                </ReactMarkdown>
              </div>
            </article>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The evidence behind an opportunity, beside its heading: how many
 * contributions and people back it, and what its confidence label measures.
 * Shown before the brief is copied, not only inside it.
 */
function OpportunityEvidence({
  confidence: stored,
  coverage,
}: {
  confidence: AutomationOpportunity["confidence"];
  coverage: { includedSources: number; uniqueContributors?: number } | null;
}) {
  const confidence = effectiveOpportunityConfidence(
    stored,
    coverage?.uniqueContributors,
  );
  return (
    <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
      <p className="flex flex-wrap items-center gap-x-1.5">
        {coverage ? (
          <>
            <span>{pluralize(coverage.includedSources, "contribution")}</span>
            {coverage.uniqueContributors !== undefined ? (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {pluralize(coverage.uniqueContributors, "contributor")}
                </span>
              </>
            ) : null}
            <span aria-hidden="true">·</span>
          </>
        ) : null}
        <span className={cn("capitalize", CONFIDENCE_CLASS[confidence.level])}>
          {confidence.level} confidence
        </span>
      </p>
      <p>
        {CONFIDENCE_DEFINITION}
        {confidence.capped ? " With one contributor it is capped at medium." : ""}
      </p>
    </div>
  );
}

function TabShell({ children }: { children: React.ReactNode }) {
  return <div className="p-4 sm:p-6">{children}</div>;
}

function CopyBriefButton({ markdown }: { markdown: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <Button
      size="sm"
      variant={state === "failed" ? "destructive" : "default"}
      className="gap-1.5"
      onClick={() => {
        // Report the real outcome: the Clipboard API is absent outside a secure
        // context, and a button that always says "Copied" would be lying there.
        void copyTextToClipboard(markdown).then((ok) =>
          setState(ok ? "copied" : "failed"),
        );
      }}
    >
      {state === "copied" ? (
        <Check className="size-3.5" />
      ) : (
        <Copy className="size-3.5" />
      )}
      {state === "copied"
        ? "Copied"
        : state === "failed"
          ? "Copy failed — select the text"
          : "Copy"}
    </Button>
  );
}

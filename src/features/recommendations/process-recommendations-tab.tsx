"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronRight,
  CornerDownRight,
  FileWarning,
  Lightbulb,
  RefreshCw,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionLabel } from "@/components/ui/section-label";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingState } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { describeError } from "@/lib/user-error-message";
import {
  flowDetailProgress,
  flowHasIncompleteDetails,
  flowStage,
} from "@/lib/flow-status";
import { pluralize } from "@/features/insights/insights-derivations";
import { STATUS_TONE_SURFACE, type StatusTone } from "@/features/status/status-meta";
import { useSummaryOverview } from "@/features/workbench/use-summary-overview";
import { RecommendationDetail } from "./recommendation-detail";
import {
  flattenNodes,
  groupRecommendations,
  type RecommendationNode,
} from "./recommendation-tree";
import {
  DECISION_LABEL,
  DECISION_TONE,
  EFFORT_TONE,
  INTERVENTION_LABEL,
  isTechnical,
  VALUE_TONE,
  type ClientRecommendation,
} from "./recommendation-meta";

const LEGACY_KIND_LABEL = {
  agent: "Agent",
  workflow: "Workflow",
  integration: "Integration",
  other: "Automation",
} as const;

/**
 * Recommendations for one process: technical and non-technical changes,
 * ranked, each with a decision and a plan. Replaces the automation-only tab;
 * `?tab=automations` still lands here. See
 * docs/process-improvement-recommendations-plan.md §5.1.
 */
export function ProcessRecommendationsTab({
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
  /** With a node id, opens the flow focused on that step. */
  onOpenProcessFlow?: (nodeId?: string) => void;
  /** Pass only when the viewer may capture; the empty state offers it then. */
  onAddContribution?: () => void;
}) {
  const flow = useQuery(api.processFlows.getProcessFlow, { processId });
  const data = useQuery(api.recommendations.getProcessRecommendations, { processId });
  const overview = useSummaryOverview({ kind: "process", processId });
  const regenerate = useMutation(api.recommendations.regenerateRecommendations);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetailOnMobile, setShowDetailOnMobile] = useState(false);
  const [compareEarlier, setCompareEarlier] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The list and detail sit side by side once the detail panel (not the
  // viewport) is `@3xl` wide; below that they are one pane at a time, and
  // focus has to follow the pane that is showing.
  const detailPaneRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  // Set by the action that swaps panes, consumed once the swapped-in pane has
  // rendered. A ref, not state: it must not cause a render of its own.
  const pendingFocusRef = useRef<"detail" | "row" | null>(null);

  const everPublished = data?.lastReadyAt != null;
  const current = data?.recommendations ?? [];
  const earlier = data?.earlier ?? [];
  const legacy = data?.legacy ?? [];
  const allCurrent = [...current, ...earlier];
  // Follow-ons nest under the recommendation they build on; see
  // recommendation-tree.ts.
  const groups = groupRecommendations(current, earlier);
  const legacyNodes: RecommendationNode[] = legacy.map((rec) => ({
    rec,
    followOns: [],
  }));
  const nextSteps = groups.open.reduce(
    (count, node) => count + node.followOns.length,
    0,
  );
  // Before anything has been published, the earlier suggestions are all there
  // is; afterwards they are a comparison the user opts into.
  const showLegacy = legacy.length > 0 && (!everPublished || compareEarlier);
  const selectable = [
    ...(everPublished ? flattenNodes(groups.open) : []),
    ...(everPublished ? flattenNodes(groups.dismissed) : []),
    ...(everPublished ? flattenNodes(groups.earlier) : []),
    ...(showLegacy ? legacy : []),
  ];

  // Derived, not synced: a refresh that drops the selected recommendation
  // falls back to the first one on the next render, with no window where the
  // panel points at something that no longer exists.
  const selected =
    selectable.find((rec) => rec._id === selectedId) ?? selectable[0] ?? null;

  useEffect(() => {
    const pending = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (!pending || !selected) return;
    if (pending === "detail") {
      const heading = headingRef.current;
      heading?.scrollIntoView({ block: "start" });
      heading?.focus({ preventScroll: true });
      return;
    }
    const row = rowRefs.current.get(selected._id);
    row?.scrollIntoView({ block: "nearest" });
    row?.focus({ preventScroll: true });
  }, [showDetailOnMobile, selected]);

  if (flow === undefined || data === undefined || overview === undefined) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const openFlowButton = onOpenProcessFlow ? (
    <Button size="sm" variant="outline" onClick={() => onOpenProcessFlow()}>
      Open Process Flow
    </Button>
  ) : undefined;

  if (flow === null || data === null) {
    return (
      <TabShell>
        <EmptyState
          icon={Lightbulb}
          title="No process flow yet"
          description="Recommendations are worked out from the process flow. Generate the flow first, and recommendations will follow."
          action={openFlowButton}
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
          title={stage === "graph" ? "Mapping the process" : "Describing the steps"}
          description={
            stage === "graph"
              ? "Recommendations are worked out once the process flow has been mapped."
              : progress
                ? `Step detail is ${progress.completed} of ${progress.total} complete. Recommendations follow once it finishes.`
                : "Recommendations follow once the step analysis finishes."
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
            "The last run did not complete, so there is nothing to recommend from yet. Retry generation from the Process Flow tab."
          }
          action={openFlowButton}
        />
      </TabShell>
    );
  }

  const canDecide = data.canDecide;
  const run = data.run;
  const working = run?.status === "pending" || run?.status === "running";
  const runFailed = run?.status === "failed";

  const requestRun = async () => {
    setRequesting(true);
    try {
      const result = await regenerate({ processId });
      if (result.message) toast.info(result.message);
    } catch (error) {
      toast.error(describeError(error, "Could not start the recommendation analysis."));
    } finally {
      setRequesting(false);
    }
  };

  const runButton = (label: string) =>
    canDecide ? (
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 bg-background"
        disabled={requesting || working}
        onClick={() => void requestRun()}
      >
        <RefreshCw className={cn("size-3.5", (requesting || working) && "animate-spin")} />
        {label}
      </Button>
    ) : undefined;

  // --- Nothing published yet, and no earlier suggestions to fall back on ---
  if (!everPublished && legacy.length === 0) {
    if (working) {
      return (
        <TabShell>
          <LoadingState
            title="Working out recommendations"
            description="The process flow is ready to use while this runs. It usually takes under a minute."
          />
        </TabShell>
      );
    }
    return (
      <TabShell>
        <EmptyState
          icon={runFailed ? AlertTriangle : Lightbulb}
          title={runFailed ? "Recommendations didn't finish" : "No recommendations yet"}
          description={
            runFailed
              ? (run?.errorMessage ??
                "The analysis did not finish. Retry it — the process flow is not affected.")
              : "Recommendations haven't been worked out for this process flow yet."
          }
          action={runButton(runFailed ? "Retry" : "Generate recommendations")}
        />
      </TabShell>
    );
  }

  // --- Published, and the honest answer was "nothing to change" ---
  if (everPublished && current.length === 0 && earlier.length === 0 && !showLegacy) {
    return (
      <div className="flex min-h-0 flex-col">
        <Banners
          working={working}
          runFailed={runFailed}
          lastReadyAt={data.lastReadyAt}
          newInterviewsSince={data.newInterviewsSince}
          incomplete={flowHasIncompleteDetails(flow)}
          runButton={runButton("Retry")}
          openFlowButton={openFlowButton}
        />
        <TabShell>
          <EmptyState
            icon={Lightbulb}
            title="No changes recommended from current evidence"
            description="The analysis ran and found nothing contributors described that needs changing. More contributions covering exceptions, handoffs and waiting time usually surface something."
            action={
              onAddContribution ? (
                <Button size="sm" variant="outline" onClick={onAddContribution}>
                  Add a contribution
                </Button>
              ) : (
                openFlowButton
              )
            }
          />
          {legacy.length > 0 ? (
            <div className="mt-4 text-center">
              <Button size="sm" variant="ghost" onClick={() => setCompareEarlier(true)}>
                Compare with {pluralize(legacy.length, "earlier automation suggestion")}
              </Button>
            </div>
          ) : null}
        </TabShell>
      </div>
    );
  }

  const selectRow = (id: string) => {
    // A detail pane with no boxes is hidden behind the list, so this click
    // swaps panes rather than updating a split.
    const stacked = detailPaneRef.current?.getClientRects().length === 0;
    setSelectedId(id);
    setShowDetailOnMobile(true);
    if (stacked) pendingFocusRef.current = "detail";
  };

  const rowProps = {
    selectedId: selected?._id ?? null,
    onSelect: selectRow,
    registerRow: (id: string, node: HTMLButtonElement | null) => {
      if (node) rowRefs.current.set(id, node);
      else rowRefs.current.delete(id);
    },
  };

  const artifact = overview.content.format === "v2" ? overview.content.artifact : null;

  return (
    <div className="flex min-h-0 flex-col">
      {everPublished ? (
        <Banners
          working={working}
          runFailed={runFailed}
          lastReadyAt={data.lastReadyAt}
          newInterviewsSince={data.newInterviewsSince}
          incomplete={flowHasIncompleteDetails(flow)}
          runButton={runButton("Retry")}
          openFlowButton={openFlowButton}
        />
      ) : (
        <Banner tone={runFailed ? "warning" : "info"}>
          <span className="min-w-0 flex-1 basis-60">
            {working
              ? "Working out recommendations, including non-technical changes. These earlier automation suggestions are shown until they are ready."
              : runFailed
                ? "The recommendation analysis didn't finish. These are earlier automation suggestions, made before recommendations covered non-technical changes."
                : "These are earlier automation suggestions. Generate recommendations to see technical and non-technical changes, ranked."}
          </span>
          {working ? null : runButton(runFailed ? "Retry" : "Generate recommendations")}
        </Banner>
      )}

      <div className="grid min-h-0 flex-1 @3xl/detail:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div
          className={cn(
            "min-w-0 border-b @3xl/detail:border-b-0 @3xl/detail:border-r",
            showDetailOnMobile && "hidden @3xl/detail:block",
          )}
        >
          {everPublished ? (
            <>
              <div className="border-b px-4 py-3">
                <SectionLabel>Recommendations</SectionLabel>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {groups.open.length === 0
                    ? "None open"
                    : `${pluralize(groups.open.length, "recommendation")}${
                        nextSteps > 0 ? ` and ${pluralize(nextSteps, "next step")}` : ""
                      }, highest value first`}
                </p>
              </div>
              <RowList nodes={groups.open} {...rowProps} />
              <Group title="Dismissed" nodes={groups.dismissed} {...rowProps} />
              <Group
                title="No longer recommended"
                description="The latest analysis didn't return these, but someone had decided something about them."
                nodes={groups.earlier}
                {...rowProps}
              />
              {legacy.length > 0 ? (
                <div className="border-t px-4 py-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="-ml-2 h-auto px-2 py-1 text-xs"
                    aria-pressed={compareEarlier}
                    onClick={() => setCompareEarlier((value) => !value)}
                  >
                    {compareEarlier ? "Hide" : "Compare with"}{" "}
                    {pluralize(legacy.length, "earlier automation suggestion")}
                  </Button>
                </div>
              ) : null}
              {showLegacy ? (
                <Group
                  title="Earlier automation suggestions"
                  description="Made before recommendations covered non-technical changes."
                  nodes={legacyNodes}
                  defaultOpen
                  {...rowProps}
                />
              ) : null}
            </>
          ) : (
            <>
              <div className="border-b px-4 py-3">
                <SectionLabel>Earlier automation suggestions</SectionLabel>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {pluralize(legacy.length, "suggestion")} from{" "}
                  {pluralize(flow.conversationCount, "contribution")}
                </p>
              </div>
              <RowList nodes={legacyNodes} {...rowProps} />
            </>
          )}
        </div>

        <div
          ref={detailPaneRef}
          className={cn("min-w-0", !showDetailOnMobile && "hidden @3xl/detail:block")}
        >
          {selected ? (
            <RecommendationDetail
              key={selected._id}
              recommendation={selected}
              canDecide={canDecide}
              flow={{
                nodes: flow.nodes,
                edges: flow.edges,
                criticalPath: flow.insights.criticalPath,
              }}
              processName={processName}
              departmentName={departmentName}
              functionName={functionName}
              overview={
                artifact
                  ? {
                      executiveBrief: artifact.executiveBrief,
                      gaps: artifact.gaps.map((gap) => ({ title: gap.title, body: gap.body })),
                    }
                  : null
              }
              coverage={overview.coverage}
              headingRef={headingRef}
              onBack={() => {
                pendingFocusRef.current = "row";
                setShowDetailOnMobile(false);
              }}
              onShowStep={onOpenProcessFlow ? (nodeId) => onOpenProcessFlow(nodeId) : undefined}
              related={{
                buildsOn:
                  allCurrent.find((rec) => rec._id === selected.buildsOnId) ?? null,
                followOns: allCurrent.filter((rec) => rec.buildsOnId === selected._id),
              }}
              onSelectRecommendation={(id) => {
                setSelectedId(id);
                pendingFocusRef.current = "detail";
              }}
            />
          ) : (
            <TabShell>
              <p className="text-sm text-muted-foreground">
                Select a recommendation to see the detail.
              </p>
            </TabShell>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

type RowProps = {
  selectedId: string | null;
  onSelect: (id: string) => void;
  registerRow: (id: string, node: HTMLButtonElement | null) => void;
};

type RowListProps = RowProps & { nodes: RecommendationNode[] };

function RowList({ nodes, ...rowProps }: RowListProps) {
  if (nodes.length === 0) return null;
  return (
    <ul className="divide-y">
      {nodes.map(({ rec, followOns }) => (
        <li key={rec._id}>
          <Row rec={rec} {...rowProps} />
          {followOns.length > 0 ? (
            // A next step, not a recommendation of its own: indented under the
            // change it builds on, and still selectable and decided alone.
            <ul aria-label={`Next steps after ${rec.title}`}>
              {followOns.map((followOn) => (
                <li key={followOn._id}>
                  <Row rec={followOn} nested {...rowProps} />
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Row({
  rec,
  nested = false,
  selectedId,
  onSelect,
  registerRow,
}: RowProps & { rec: ClientRecommendation; nested?: boolean }) {
  const selected = selectedId === rec._id;
  return (
    <button
      type="button"
      ref={(node) => registerRow(rec._id, node)}
      onClick={() => onSelect(rec._id)}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-2 text-left transition-colors hover:bg-muted/50 focus-ring-inset",
        nested ? "py-2.5 pl-8 pr-4" : "px-4 py-3",
        selected && "bg-muted/70",
      )}
    >
      {nested ? (
        <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className={cn("block font-medium leading-5", nested ? "text-xs" : "text-sm")}>
          {nested ? <span className="text-muted-foreground">Then: </span> : null}
          {rec.title}
        </span>
        <RowMeta rec={rec} />
      </span>
      <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground @3xl/detail:hidden" />
    </button>
  );
}

function RowMeta({ rec }: { rec: ClientRecommendation }) {
  if (!rec.content || !rec.scores) {
    return (
      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="text-2xs">
          {rec.legacy ? LEGACY_KIND_LABEL[rec.legacy.kind] : "Automation"}
        </Badge>
        <span className="text-2xs text-muted-foreground">
          {pluralize(rec.nodeIds.length, "step")}
        </span>
      </span>
    );
  }
  const technical = isTechnical(rec.content.intervention);
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <Badge tone={technical ? "info" : "success"} className="text-2xs">
        {INTERVENTION_LABEL[rec.content.intervention]}
      </Badge>
      <ScoreText label="Value" level={rec.scores.value.level} tone={VALUE_TONE[rec.scores.value.level]} />
      <ScoreText label="Effort" level={rec.scores.effort.level} tone={EFFORT_TONE[rec.scores.effort.level]} />
      {rec.decisionStatus !== "new" ? (
        <Badge tone={DECISION_TONE[rec.decisionStatus]} className="text-2xs">
          {DECISION_LABEL[rec.decisionStatus]}
        </Badge>
      ) : null}
    </span>
  );
}

function ScoreText({
  label,
  level,
  tone,
}: {
  label: string;
  level: string;
  tone: StatusTone;
}) {
  return (
    <span className="text-2xs text-muted-foreground">
      {label}{" "}
      <span
        className={cn(
          "capitalize",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "info" && "text-info",
        )}
      >
        {level}
      </span>
    </span>
  );
}

function Group({
  title,
  description,
  nodes,
  defaultOpen = false,
  ...rowProps
}: RowListProps & { title: string; description?: string; defaultOpen?: boolean }) {
  if (nodes.length === 0) return null;
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-t">
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 px-4 py-2.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-ring-inset">
        <ChevronRight className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
        {title} ({nodes.length})
      </CollapsibleTrigger>
      <CollapsibleContent>
        {description ? (
          <p className="px-4 pb-2 text-2xs text-muted-foreground">{description}</p>
        ) : null}
        <RowList nodes={nodes} {...rowProps} />
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

function Banner({
  tone,
  children,
}: {
  tone: StatusTone;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-4 py-2 text-xs text-foreground",
        STATUS_TONE_SURFACE[tone],
        "rounded-none border-x-0 border-t-0",
      )}
    >
      {children}
    </div>
  );
}

function Banners({
  working,
  runFailed,
  lastReadyAt,
  newInterviewsSince,
  incomplete,
  runButton,
  openFlowButton,
}: {
  working: boolean;
  runFailed: boolean;
  lastReadyAt: number | null;
  newInterviewsSince: number;
  incomplete: boolean;
  runButton: React.ReactNode;
  openFlowButton: React.ReactNode;
}) {
  const since = lastReadyAt
    ? new Date(lastReadyAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
      })
    : null;
  return (
    <>
      {working ? (
        <Banner tone="info">
          <span className="min-w-0 flex-1 basis-60">
            Refreshing recommendations from the latest process flow. Decisions
            carry over.
          </span>
        </Banner>
      ) : runFailed ? (
        <Banner tone="warning">
          <span className="min-w-0 flex-1 basis-60">
            The latest refresh didn&apos;t finish{since ? `; these are from ${since}` : ""}.
          </span>
          {runButton}
        </Banner>
      ) : null}
      {newInterviewsSince > 0 ? (
        <Banner tone="warning">
          <span className="min-w-0 flex-1 basis-60">
            {pluralize(newInterviewsSince, "new interview")} since these
            recommendations. Regenerate the process flow to include{" "}
            {newInterviewsSince === 1 ? "it" : "them"}.
          </span>
          {openFlowButton}
        </Banner>
      ) : incomplete ? (
        <Banner tone="warning">
          <span className="min-w-0 flex-1 basis-60">
            Some steps were never described, so these recommendations may miss
            problems on them.
          </span>
          {openFlowButton}
        </Banner>
      ) : null}
    </>
  );
}

function TabShell({ children }: { children: React.ReactNode }) {
  return <div className="p-4 sm:p-6">{children}</div>;
}

"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowUpRight,
  BarChart3,
  Check,
  FileText,
  GitBranch,
  Library,
  MessageSquareQuote,
  Sparkles,
  Users,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Card, cardVariants } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionLabel } from "@/components/ui/section-label";
import { Skeleton } from "@/components/ui/skeleton";
import { MarkdownSummary } from "@/features/workbench/markdown-summary";
import {
  EmphasizedText,
  FindingRows,
  OverviewGeneratedTime,
  OverviewLead,
  OverviewSection,
  OverviewStateBadge,
  type OverviewCopyState,
  type OverviewFinding,
} from "@/features/overview/overview-primitives";
import {
  legacyPreviewText,
  overviewCopyText,
  surfaceReadinessLabel,
} from "@/features/overview/overview-view-model";
import { useSummaryOverview } from "@/features/workbench/use-summary-overview";

type OverviewResponse = FunctionReturnType<typeof api.summaries.getOverview>;
type StructuredArtifact = Extract<
  OverviewResponse["content"],
  { format: "v2" }
>["artifact"];
type ProcessArtifact = Extract<StructuredArtifact, { scope: unknown[] }>;

type ProcessOverviewProps = {
  processId: Id<"processes">;
  canRefresh: boolean;
  onOpenConversation: (conversationId: Id<"conversations">) => void;
  onOpenFlow: () => void;
  onOpenInsights: () => void;
};

function isProcessArtifact(
  artifact: StructuredArtifact,
): artifact is ProcessArtifact {
  return "scope" in artifact;
}

function ProcessOverviewLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 @xl/detail:px-6 @3xl/detail:px-8" aria-label="Loading overview">
      <div className="space-y-4 pb-8">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-36 sm:h-7" />
        </div>
        <Skeleton className="h-6 w-64 rounded-full" />
        <Skeleton className="h-5 w-full max-w-3xl" />
        <Skeleton className="h-5 w-3/4 max-w-2xl" />
      </div>
      <div className="grid grid-cols-2 gap-px border-y bg-border @3xl/detail:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24 rounded-none" />
        ))}
      </div>
      <div className="space-y-6 py-10">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    </div>
  );
}

function EvidenceStrip({ artifact }: { artifact: ProcessArtifact }) {
  const coverage = artifact.coverage;
  const items = [
    {
      label: "Contributions included",
      value: coverage.includedSources.toLocaleString(),
      icon: MessageSquareQuote,
    },
    {
      label: "Eligible contributions",
      value: coverage.totalEligibleSources.toLocaleString(),
      icon: Library,
    },
    {
      label: "Unique contributors",
      value: coverage.uniqueContributors?.toLocaleString() ?? "—",
      icon: Users,
    },
    {
      label: "Evidence coverage",
      value: coverage.complete ? "Complete" : "Partial",
      icon: coverage.complete ? Check : Sparkles,
    },
  ];

  return (
    <section aria-label="Evidence coverage" className="border-y border-border">
      <div className="grid grid-cols-2 gap-px bg-border @3xl/detail:grid-cols-4">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="min-w-0 bg-background px-4 py-5 @3xl/detail:px-5">
              <div className="mb-3 flex items-start gap-2 text-muted-foreground">
                <Icon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                <SectionLabel render={<span />} size="sm" className="min-w-0">
                  {item.label}
                </SectionLabel>
              </div>
              <p className="text-xl font-semibold tracking-tight @3xl/detail:text-2xl">
                {item.value}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Orientation facts the Flow graph cannot state at process level: trigger,
 * completion, owning roles, systems of record, and dependencies. Deliberately
 * not a sequence — an ordered list here would compete with the Flow graph, and
 * two independently generated orders over the same transcripts never match.
 */
function ScopeAndParticipants({
  scope,
  flowAvailable,
  onOpenConversation,
  onOpenFlow,
}: {
  scope: OverviewFinding[];
  flowAvailable: boolean;
  onOpenConversation: (conversationId: Id<"conversations">) => void;
  onOpenFlow: () => void;
}) {
  return (
    <>
      <FindingRows
        findings={scope}
        onOpenConversation={onOpenConversation}
        emptyText="The current evidence does not establish the trigger, completion, or ownership of this process."
      />
      {flowAvailable && (
        <p className="mt-6 text-sm text-muted-foreground">
          For the order these activities happen in,{" "}
          <button
            type="button"
            onClick={onOpenFlow}
            className="focus-ring rounded font-medium text-org-accent underline decoration-org-accent-border underline-offset-4 hover:decoration-current"
          >
            open the Process Flow
          </button>
          .
        </p>
      )}
    </>
  );
}

function ReadinessFooter({
  overview,
  onOpenFlow,
  onOpenInsights,
}: {
  overview: OverviewResponse;
  onOpenFlow: () => void;
  onOpenInsights: () => void;
}) {
  const destinations = [
    {
      label: "Process Flow",
      description: "Open the map and step detail",
      readiness: overview.flow,
      icon: GitBranch,
      onOpen: onOpenFlow,
    },
    {
      label: "Process Insights",
      description: "Open diagnosis and improvement analysis",
      readiness: overview.insights,
      icon: BarChart3,
      onOpen: onOpenInsights,
    },
  ];

  return (
    <footer className="border-t border-border py-8" aria-label="Related process views">
      <h2 className="mb-4 text-base font-semibold tracking-tight">
        Continue exploring
      </h2>
      <div className="grid gap-3 @xl/detail:grid-cols-2">
        {destinations.map((destination) => {
          const Icon = destination.icon;
          return (
            <button
              type="button"
              key={destination.label}
              onClick={destination.onOpen}
              className={cardVariants({
                padding: "md",
                className:
                  "focus-ring group flex min-h-20 min-w-0 items-center gap-3 text-left transition-colors hover:border-org-accent-border hover:bg-org-accent-subtle",
              })}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-background group-hover:text-org-accent">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">{destination.label}</span>
                  <span className="text-2xs text-muted-foreground">
                    {surfaceReadinessLabel(destination.readiness)}
                  </span>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {destination.description}
                </span>
              </span>
              <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </footer>
  );
}

export function ProcessOverviewContent({
  overview,
  canRefresh,
  refreshPending,
  refreshError,
  onRefresh,
  onOpenConversation,
  onOpenFlow,
  onOpenInsights,
}: {
  overview: OverviewResponse;
  canRefresh: boolean;
  refreshPending: boolean;
  refreshError: string | null;
  onRefresh: () => void;
  onOpenConversation: (conversationId: Id<"conversations">) => void;
  onOpenFlow: () => void;
  onOpenInsights: () => void;
}) {
  const [copyState, setCopyState] = useState<OverviewCopyState>("idle");
  const hasContent = overview.content.format !== "none";
  const structuredArtifact =
    overview.content.format === "v2" && isProcessArtifact(overview.content.artifact)
      ? overview.content.artifact
      : null;
  const brief = structuredArtifact?.executiveBrief ?? null;
  const handleCopy = async () => {
    const text = overviewCopyText(overview.content);
    if (!text) return;
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    } finally {
      window.setTimeout(() => setCopyState("idle"), 1_800);
    }
  };

  return (
    <article
      className="mx-auto w-full max-w-5xl px-4 pb-4 pt-5 @xl/detail:px-6 @xl/detail:pt-6 @3xl/detail:px-8"
      aria-label="Process overview"
    >
      <OverviewLead
        id="process-overview-brief"
        state={overview.state}
        hasContent={hasContent}
        generatedAt={overview.lastSuccessfulGenerationAt}
        progress={overview.progress}
        canRefresh={canRefresh}
        refreshAvailable={overview.refreshAvailable}
        hasEvidenceSource={overview.hasEvidenceSource}
        refreshPending={refreshPending}
        refreshError={refreshError}
        error={overview.error}
        copyState={copyState}
        onCopy={() => void handleCopy()}
        onRefresh={onRefresh}
      >
        {structuredArtifact ? (
          brief && (
            <p className="max-w-3xl text-base leading-8 text-foreground/75 @xl/detail:text-lg">
              <EmphasizedText value={brief} />
            </p>
          )
        ) : hasContent ? (
          <div className="max-w-3xl">
            <p className="mb-5 text-xs leading-5 text-muted-foreground">
              Compatibility view · This overview predates structured evidence
              links. It remains readable while Fabric transitions to the
              evidence-backed format.
            </p>
            <div className="border-l-2 border-border pl-5 @xl/detail:pl-7">
              <MarkdownSummary content={overview.content.markdown ?? ""} />
            </div>
          </div>
        ) : (
          <EmptyState
            variant="plain"
            size="lg"
            className="border-y py-14"
            icon={FileText}
            title={
              overview.state === "refreshing"
                ? "Overview will appear here"
                : "No overview yet"
            }
            description={
              overview.state === "refreshing"
                ? "You can continue working while Fabric prepares it in the background."
                : "Complete a contribution to this process to establish the first evidence-backed overview."
            }
          />
        )}
      </OverviewLead>

      {structuredArtifact ? (
        <>
          <EvidenceStrip artifact={structuredArtifact} />

          <OverviewSection
            id="process-scope"
            title="Scope and participants"
            description="What contributors say this process covers, who runs it, and what it depends on. The Process Flow owns the order these activities happen in."
          >
            <ScopeAndParticipants
              scope={structuredArtifact.scope}
              flowAvailable={overview.flow?.available === true}
              onOpenConversation={onOpenConversation}
              onOpenFlow={onOpenFlow}
            />
          </OverviewSection>

          <OverviewSection
            id="process-variations"
            title="Reported practice"
            description="Different ways the work is described. These are reported variations, not measured execution frequency or conformance."
          >
            <FindingRows
              findings={structuredArtifact.variations}
              onOpenConversation={onOpenConversation}
              emptyText="No material variation is visible in the current evidence set."
            />
          </OverviewSection>

          <OverviewSection
            id="process-agreements-gaps"
            title="Evidence alignment"
            description="Agreements and open questions across the available contributions."
          >
            <div className="grid gap-10 @3xl/detail:grid-cols-2 @3xl/detail:gap-12">
              <div>
                <SectionLabel render={<h3 />} className="mb-4">
                  Agreements
                </SectionLabel>
                <FindingRows
                  findings={structuredArtifact.consensus}
                  onOpenConversation={onOpenConversation}
                  emptyText="No agreement across contributions has been established yet."
                />
              </div>
              <div>
                <SectionLabel render={<h3 />} className="mb-4">
                  Knowledge gaps and tensions
                </SectionLabel>
                <FindingRows
                  findings={structuredArtifact.gaps}
                  onOpenConversation={onOpenConversation}
                  emptyText="No explicit knowledge gap is recorded in the current overview."
                />
              </div>
            </div>
          </OverviewSection>

          <OverviewSection
            id="process-notable-context"
            title="Context worth carrying forward"
            description="Notable context that helps readers interpret the reported process."
          >
            <FindingRows
              findings={structuredArtifact.notable}
              onOpenConversation={onOpenConversation}
              emptyText="No additional context has been elevated from the current evidence."
            />
          </OverviewSection>
        </>
      ) : null}

      <ReadinessFooter
        overview={overview}
        onOpenFlow={onOpenFlow}
        onOpenInsights={onOpenInsights}
      />
    </article>
  );
}

export function ProcessOverview({
  processId,
  canRefresh,
  onOpenConversation,
  onOpenFlow,
  onOpenInsights,
}: ProcessOverviewProps) {
  const entity = useMemo(
    () => ({ kind: "process" as const, processId }),
    [processId],
  );
  const overview = useSummaryOverview(entity);
  const forceRefresh = useMutation(api.summaries.forceRefresh);
  const [refreshPending, setRefreshPending] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  if (overview === undefined) return <ProcessOverviewLoading />;

  const handleRefresh = async () => {
    setRefreshPending(true);
    setRefreshError(null);
    try {
      const result = await forceRefresh({ entity });
      if (result.status === "disabled") {
        setRefreshError("Structured overview generation is not enabled yet.");
      }
    } catch {
      setRefreshError("The overview refresh could not be started. Please try again.");
    } finally {
      setRefreshPending(false);
    }
  };

  return (
    <ProcessOverviewContent
      overview={overview}
      canRefresh={canRefresh}
      refreshPending={refreshPending}
      refreshError={refreshError}
      onRefresh={() => void handleRefresh()}
      onOpenConversation={onOpenConversation}
      onOpenFlow={onOpenFlow}
      onOpenInsights={onOpenInsights}
    />
  );
}

export function ProcessOverviewCompactPreview({
  processId,
}: {
  processId: Id<"processes">;
}) {
  const entity = useMemo(
    () => ({ kind: "process" as const, processId }),
    [processId],
  );
  const overview = useSummaryOverview(entity);

  if (overview === undefined) {
    return (
      <Card padding="md" className="space-y-3">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-7 w-4/5" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </Card>
    );
  }

  const artifact =
    overview.content.format === "v2" && isProcessArtifact(overview.content.artifact)
      ? overview.content.artifact
      : null;
  const preview = artifact?.executiveBrief ?? legacyPreviewText(overview.content.markdown);

  return (
    <section className={cardVariants({ padding: "md" })} aria-label="Process overview preview">
      <div className="flex flex-wrap items-center gap-2">
        <OverviewStateBadge state={overview.state} />
        {artifact && (
          <span className="text-xs text-muted-foreground">
            {artifact.coverage.includedSources} of {artifact.coverage.totalEligibleSources} contributions
          </span>
        )}
      </div>
      <p className="mt-4 line-clamp-5 text-sm leading-6 text-muted-foreground">
        <EmphasizedText value={preview} />
      </p>
      <div className="mt-4">
        <OverviewGeneratedTime value={overview.lastSuccessfulGenerationAt} />
      </div>
    </section>
  );
}

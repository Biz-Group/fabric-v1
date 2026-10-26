"use client";

import { useCallback, useState } from "react";
import { useAction, useQuery } from "convex/react";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  ArrowRight,
  ArrowRightLeft,
  ArrowUpRight,
  Bot,
  FileWarning,
  GitBranch,
  KeyRound,
  Monitor,
  RefreshCw,
  ShieldAlert,
  Split,
  Timer,
  Users,
  Workflow,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionLabel } from "@/components/ui/section-label";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingState, Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  automationPotentialTone,
  confidenceTone,
  STATUS_TONE_CHIP,
  STATUS_TONE_SURFACE,
  STATUS_TONE_TEXT,
} from "@/features/status/status-meta";
import {
  flowDetailProgress,
  flowHasIncompleteDetails,
  flowStage,
  hasRetainedPreviousFlow,
} from "@/lib/flow-status";
import {
  type FlowNode,
  type FlowEdge,
  type ProcessFlow,
  type Confidence,
  type AutomationPotential,
  type HandoffItem,
  type ToolUsage,
  type HeavyArea,
  type KeyFindingKind,
  type KeyFindings,
  actorList,
  deriveAutomationCandidates,
  deriveBottlenecks,
  deriveConfidenceCounts,
  deriveDecisionBranches,
  deriveHandoffs,
  deriveHeavyAreas,
  deriveKeyFindings,
  deriveToolUsage,
  getNodeMap,
  pluralize,
  uniqueStrings,
} from "@/features/insights/insights-derivations";

type ProcessInsightsTabProps = {
  processId: Id<"processes">;
  completedConversationCount: number;
  canGenerate: boolean;
  isActive: boolean;
  onOpenProcessFlow: (nodeId?: string) => void;
  /** Recommendations — technical and non-technical — live on their own tab. */
  onOpenRecommendations?: () => void;
};

type AutomationOpportunity = NonNullable<
  ProcessFlow["insights"]["automationOpportunityDetails"]
>[number];

const CATEGORY_LABELS: Record<FlowNode["category"], string> = {
  start: "Start",
  end: "End",
  action: "Action",
  decision: "Decision",
  handoff: "Handoff",
  wait: "Wait",
};

const AUTOMATION_LABELS: Record<
  AutomationPotential,
  { label: string; className: string; rank: number }
> = {
  high: {
    label: "High",
    className: STATUS_TONE_CHIP[automationPotentialTone.high],
    rank: 3,
  },
  medium: {
    label: "Medium",
    className: STATUS_TONE_CHIP[automationPotentialTone.medium],
    rank: 2,
  },
  low: {
    label: "Low",
    className: STATUS_TONE_CHIP[automationPotentialTone.low],
    rank: 1,
  },
  none: {
    label: "None",
    className: STATUS_TONE_CHIP[automationPotentialTone.none],
    rank: 0,
  },
};

const CONFIDENCE_LABELS: Record<
  Confidence,
  { label: string; detail: string; className: string }
> = {
  high: {
    label: "High",
    detail: "confirmed",
    className: STATUS_TONE_CHIP[confidenceTone.high],
  },
  medium: {
    label: "Medium",
    detail: "single clear source",
    className: STATUS_TONE_CHIP[confidenceTone.medium],
  },
  low: {
    label: "Low",
    detail: "inferred or weak",
    className: STATUS_TONE_CHIP[confidenceTone.low],
  },
};

/** A nested item inside an insight section. */
const INSET_ITEM = cardVariants({ variant: "inset", padding: "sm" });

function MetricTile({
  icon: Icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  detail?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        cardVariants({ padding: "sm" }),
        accent && "border-org-accent-border bg-org-accent-selected",
      )}
    >
      <SectionLabel render={<div />} className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 break-words">{label}</span>
      </SectionLabel>
      <p className="mt-1 break-words text-lg font-semibold tabular-nums">
        {value}
      </p>
      {detail && (
        <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
          {detail}
        </p>
      )}
    </div>
  );
}

function LoadingInsights() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="grid gap-3 @2xl/detail:grid-cols-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
      <div className="grid gap-4 @4xl/detail:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

function InlineNotice({
  icon: Icon,
  title,
  children,
  action,
  tone = "warning",
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  tone?: "warning" | "destructive";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3 text-sm @md/detail:flex-row @md/detail:items-start @md/detail:justify-between",
        STATUS_TONE_SURFACE[tone],
        tone === "destructive" && STATUS_TONE_TEXT.destructive,
      )}
      role={tone === "destructive" ? "alert" : "status"}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Icon
          className={cn("mt-0.5 size-4 shrink-0", STATUS_TONE_TEXT[tone])}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="font-medium">{title}</p>
          <div className="mt-1 text-xs leading-5">{children}</div>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function GenerateFlowButton({
  canGenerate,
  hasCompletedConversations,
  isGenerating,
  label,
  onGenerate,
  onOpenProcessFlow,
}: {
  canGenerate: boolean;
  hasCompletedConversations: boolean;
  isGenerating: boolean;
  label: string;
  onGenerate: () => void;
  onOpenProcessFlow: () => void;
}) {
  if (!canGenerate) {
    return (
      <Button variant="outline" className="gap-2" onClick={onOpenProcessFlow}>
        <GitBranch className="size-4" aria-hidden />
        View Flow
      </Button>
    );
  }

  return (
    <Button
      className="gap-2"
      onClick={onGenerate}
      disabled={isGenerating || !hasCompletedConversations}
    >
      {isGenerating ? (
        <Spinner />
      ) : (
        <RefreshCw className="size-4" aria-hidden />
      )}
      {isGenerating ? "Starting…" : label}
    </Button>
  );
}

function InsightSection({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count?: string;
  children: React.ReactNode;
}) {
  const headingId = `insights-${title
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <section
      aria-labelledby={headingId}
      className={cardVariants({ padding: "none" })}
    >
      <div className="flex min-w-0 items-center justify-between gap-3 border-b px-4 py-3">
        <h3
          id={headingId}
          className="flex min-w-0 items-center gap-2 text-sm font-semibold"
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 break-words">{title}</span>
        </h3>
        {count && (
          <Badge
            variant="outline"
            className="h-auto max-w-[58%] shrink-0 whitespace-normal text-right leading-4"
          >
            {count}
          </Badge>
        )}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

const FINDING_ICONS: Record<KeyFindingKind, LucideIcon> = {
  bottleneck: FileWarning,
  automation: Bot,
  knowledge_risk: KeyRound,
  weak_evidence: ShieldAlert,
  handoff_hotspot: ArrowRightLeft,
};

/**
 * What to look at first. The counts below say how big the process is; this
 * says where a reviewer should start, each finding with one way in.
 */
function KeyFindingsSummary({
  result,
  onOpenNode,
  onOpenRecommendations,
  onOpenProcessFlow,
}: {
  result: KeyFindings;
  onOpenNode: (nodeId: string) => void;
  onOpenRecommendations?: () => void;
  onOpenProcessFlow: () => void;
}) {
  return (
    <section
      aria-labelledby="insights-key-findings"
      className={cardVariants({ padding: "none" })}
    >
      <h3
        id="insights-key-findings"
        className="border-b px-4 py-3 text-sm font-semibold"
      >
        Key findings
      </h3>
      {result.state === "findings" ? (
        <ul className="divide-y">
          {result.findings.map((finding) => {
            const Icon = FINDING_ICONS[finding.kind];
            const nodeId = finding.nodeId;
            const action =
              finding.kind === "automation" && onOpenRecommendations ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={onOpenRecommendations}
                >
                  Open Recommendations
                  <ArrowUpRight className="size-3.5" aria-hidden />
                </Button>
              ) : nodeId ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  data-flow-node-id={nodeId}
                  onClick={() => onOpenNode(nodeId)}
                >
                  Show in flow
                  <ArrowRight className="size-3.5" aria-hidden />
                </Button>
              ) : null;
            return (
              <li
                key={finding.kind}
                className="flex flex-col gap-3 px-4 py-3 @xl/detail:flex-row @xl/detail:items-start @xl/detail:justify-between"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <Icon
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">
                      {finding.title}
                    </p>
                    <p className="mt-0.5 break-words text-xs leading-5 text-muted-foreground">
                      {finding.detail}
                    </p>
                  </div>
                </div>
                {action && <div className="shrink-0 pl-6 @xl/detail:pl-0">{action}</div>}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-col gap-3 px-4 py-3 text-sm @xl/detail:flex-row @xl/detail:items-start @xl/detail:justify-between">
          <p className="min-w-0 text-muted-foreground">
            {result.state === "not_described"
              ? "No step in this flow has been described yet, so there are no findings to report. Regenerate the flow to describe its steps."
              : "No bottlenecks, knowledge risks, weak evidence or recommended automations were reported in this analysis. That reflects what contributors described, not proof the process has no issues."}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={onOpenProcessFlow}
          >
            <GitBranch className="size-3.5" aria-hidden />
            View Flow
          </Button>
        </div>
      )}
    </section>
  );
}

function SectionEmpty({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function PillList({
  values,
  variant = "secondary",
}: {
  values: string[];
  variant?: "secondary" | "outline";
}) {
  if (values.length === 0) {
    return <span className="text-xs text-muted-foreground">None listed</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <Badge
          key={value}
          variant={variant}
          className="h-auto min-h-5 max-w-full whitespace-normal break-words text-left"
        >
          {value}
        </Badge>
      ))}
    </div>
  );
}

function NodeBadge({ node }: { node: FlowNode }) {
  return (
    <Badge variant="outline" className="h-auto whitespace-normal break-words">
      {CATEGORY_LABELS[node.category]}
    </Badge>
  );
}

export function FlowNodeLink({
  nodeId,
  label,
  onOpenNode,
  compact = false,
}: {
  nodeId: string;
  label: string;
  onOpenNode: (nodeId: string) => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "focus-ring group inline-flex max-w-full items-center gap-1.5 text-left font-medium text-foreground transition-colors hover:text-org-accent",
        compact
          ? "min-h-7 rounded-full border px-2.5 py-1 text-xs"
          : "min-h-8 rounded-md -ml-1 px-1 text-sm",
      )}
      onClick={() => onOpenNode(nodeId)}
      aria-label={`Open ${label} in Process Flow`}
      data-flow-node-id={nodeId}
    >
      <span className="min-w-0 break-words">{label}</span>
      <ArrowUpRight
        className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transform-none"
        aria-hidden="true"
      />
    </button>
  );
}

function HandoffsSection({
  items,
  onOpenNode,
}: {
  items: HandoffItem[];
  onOpenNode: (nodeId: string) => void;
}) {
  // The derived count, the same one the Process Flow bar shows. The stored
  // insights.handoffCount only counts steps categorised as handoffs, so it
  // reads lower on the same flow and looked like the two disagreeing.
  return (
    <InsightSection
      icon={ArrowRightLeft}
      title="Handoffs"
      count={pluralize(items.length, "handoff")}
    >
      {items.length === 0 ? (
        <SectionEmpty message="No handoff steps or actor-change edges are present in this generated flow." />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className={INSET_ITEM}>
              <div className="grid gap-3 @2xl/detail:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] @2xl/detail:items-start">
                <div className="min-w-0">
                  <SectionLabel>
                    Source step
                  </SectionLabel>
                  <FlowNodeLink
                    nodeId={item.source.id}
                    label={item.source.label}
                    onOpenNode={onOpenNode}
                  />
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {actorList(item.source)}
                  </p>
                </div>
                <ArrowRight className="hidden size-4 text-muted-foreground @2xl/detail:block" />
                <div className="min-w-0">
                  <SectionLabel>
                    Target step
                  </SectionLabel>
                  <FlowNodeLink
                    nodeId={item.target.id}
                    label={item.target.label}
                    onOpenNode={onOpenNode}
                  />
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {actorList(item.target)}
                  </p>
                </div>
              </div>
              <div className="mt-3 space-y-2 border-t pt-3">
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Actors involved
                  </p>
                  <PillList values={item.actors} />
                </div>
                {item.edge?.label && (
                  <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                    <Badge
                      variant="outline"
                      className="h-auto whitespace-normal"
                    >
                      {item.edge.label}
                    </Badge>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </InsightSection>
  );
}

function ToolsSection({
  tools,
  heavyAreas,
  reportedToolCount,
  onOpenNode,
}: {
  tools: ToolUsage[];
  heavyAreas: HeavyArea[];
  reportedToolCount: number;
  onOpenNode: (nodeId: string) => void;
}) {
  return (
    <InsightSection
      icon={Monitor}
      title="Tools And Systems"
      count={pluralize(reportedToolCount, "tool")}
    >
      <div className="space-y-4">
        {tools.length === 0 ? (
          <SectionEmpty message="No tools or systems are attached to the generated flow nodes." />
        ) : (
          <div className="space-y-3">
            {tools.map((tool) => (
              <div
                key={tool.name}
                className="border-b pb-3 last:border-b-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-words text-sm font-medium">{tool.name}</p>
                  <Badge variant="secondary">
                    {pluralize(tool.steps.length, "step")}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tool.steps.map((step) => (
                    <FlowNodeLink
                      key={`${tool.name}-${step.id}`}
                      nodeId={step.id}
                      label={step.label}
                      onOpenNode={onOpenNode}
                      compact
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className={INSET_ITEM}>
          <SectionLabel>
            Tool-heavy or handoff-heavy areas
          </SectionLabel>
          {heavyAreas.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No concentrated tool or handoff areas were detected.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {heavyAreas.slice(0, 6).map((area) => (
                <div key={area.node.id} className="min-w-0">
                  <FlowNodeLink
                    nodeId={area.node.id}
                    label={area.node.label}
                    onOpenNode={onOpenNode}
                  />
                  <p className="text-xs text-muted-foreground">
                    {pluralize(area.toolCount, "tool")} and{" "}
                    {pluralize(area.handoffSignals, "handoff signal")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </InsightSection>
  );
}

function BottlenecksSection({
  nodes,
  onOpenNode,
}: {
  nodes: FlowNode[];
  onOpenNode: (nodeId: string) => void;
}) {
  return (
    <InsightSection
      icon={FileWarning}
      title="Bottlenecks"
      count={pluralize(nodes.length, "step")}
    >
      {nodes.length === 0 ? (
        <SectionEmpty message="No bottleneck nodes are marked in this generated flow." />
      ) : (
        <div className="space-y-3">
          {nodes.map((node) => (
            <div key={node.id} className={INSET_ITEM}>
              <div className="flex flex-wrap items-center gap-2">
                <FlowNodeLink
                  nodeId={node.id}
                  label={node.label}
                  onOpenNode={onOpenNode}
                />
                <NodeBadge node={node} />
                <Badge
                  variant="outline"
                  className={CONFIDENCE_LABELS[node.confidence].className}
                >
                  {CONFIDENCE_LABELS[node.confidence].label} confidence
                </Badge>
              </div>
              <div className="mt-3 grid gap-3 @2xl/detail:grid-cols-3">
                <DetailBlock label="Pain points">
                  <BulletList
                    items={node.painPoints}
                    empty="No pain point text attached"
                  />
                </DetailBlock>
                <DetailBlock label="Duration signals">
                  <p className="break-words text-sm text-muted-foreground">
                    {node.estimatedDuration ?? "No duration signal attached"}
                  </p>
                </DetailBlock>
                <DetailBlock label="Sources">
                  <PillList values={node.sources} variant="outline" />
                </DetailBlock>
              </div>
            </div>
          ))}
        </div>
      )}
    </InsightSection>
  );
}

function AutomationSection({
  opportunityDetails,
  flowLevelCount,
  isAnalysed,
  candidates,
  onOpenNode,
  onOpenRecommendations,
}: {
  opportunityDetails?: AutomationOpportunity[];
  /** Same value the Automation tile and the Process Flow bottom bar show. */
  flowLevelCount: number;
  /** False when the analysis fell back to flagging automatable-looking steps. */
  isAnalysed: boolean;
  candidates: FlowNode[];
  onOpenNode: (nodeId: string) => void;
  onOpenRecommendations?: () => void;
}) {
  // Insights answers "where should we look"; the Recommendations tab answers
  // "what should we change". The recommendations live there so the same list
  // is not maintained in two places — what stays here is the automation signal:
  // the technical recommendations, and which steps look automatable.
  const titles = (opportunityDetails ?? []).map(
    (opportunity) => opportunity.title,
  );
  return (
    <InsightSection
      icon={Bot}
      title="Automation Opportunities"
      count={`${flowLevelCount} recommended · ${pluralize(candidates.length, "automatable step")}`}
    >
      <div className="space-y-4">
        {/* Reported apart, never summed: a flow-level recommendation cites the
            steps it covers, so most are already counted among the node-level
            candidates. Adding the two produced a total larger than the number
            of distinct findings. */}
        <div className={INSET_ITEM}>
          <SectionLabel>
            Potential automations
          </SectionLabel>
          {!isAnalysed ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Recommendations for this run are still being worked out, or
              didn&apos;t finish. The Recommendations tab shows which.
            </p>
          ) : titles.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No technical changes were recommended. Non-technical changes are
              on the Recommendations tab.
            </p>
          ) : (
            <>
              <ul className="mt-2 space-y-1">
                {titles.map((title) => (
                  <li key={title} className="text-sm text-muted-foreground">
                    {title}
                  </li>
                ))}
              </ul>
              {onOpenRecommendations && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 gap-1.5"
                  onClick={onOpenRecommendations}
                >
                  Open Recommendations
                  <ArrowUpRight className="size-3.5" />
                </Button>
              )}
            </>
          )}
        </div>

        {candidates.length === 0 ? (
          <SectionEmpty message="No node-level automation potential is marked above none." />
        ) : (
          <div className="space-y-3">
            {candidates.map((node) => (
              <div key={node.id} className={INSET_ITEM}>
                <div className="flex flex-wrap items-center gap-2">
                  <FlowNodeLink
                    nodeId={node.id}
                    label={node.label}
                    onOpenNode={onOpenNode}
                  />
                  <Badge
                    variant="outline"
                    className={
                      AUTOMATION_LABELS[node.automationPotential].className
                    }
                  >
                    {AUTOMATION_LABELS[node.automationPotential].label}{" "}
                    potential
                  </Badge>
                </div>
                {(node.tools.length > 0 || node.sources.length > 0) && (
                  <div className="mt-3 space-y-2">
                    {node.tools.length > 0 && (
                      <PillList values={node.tools} variant="outline" />
                    )}
                    {node.sources.length > 0 && (
                      <PillList values={node.sources} variant="outline" />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </InsightSection>
  );
}

function TribalKnowledgeSection({
  nodes,
  onOpenNode,
}: {
  nodes: FlowNode[];
  onOpenNode: (nodeId: string) => void;
}) {
  return (
    <InsightSection
      icon={KeyRound}
      title="Tribal Knowledge Risk"
      count={pluralize(nodes.length, "step")}
    >
      {nodes.length === 0 ? (
        <SectionEmpty message="No flow nodes are marked as tribal knowledge risks." />
      ) : (
        <div className="space-y-3">
          {nodes.map((node) => (
            <div key={node.id} className={INSET_ITEM}>
              <div className="flex flex-wrap items-center gap-2">
                <FlowNodeLink
                  nodeId={node.id}
                  label={node.label}
                  onOpenNode={onOpenNode}
                />
                <Badge
                  variant="outline"
                  className={CONFIDENCE_LABELS[node.confidence].className}
                >
                  {CONFIDENCE_LABELS[node.confidence].label} confidence
                </Badge>
              </div>
              <div className="mt-3 grid gap-3 @xl/detail:grid-cols-2">
                <DetailBlock label="Risk indicators">
                  <BulletList
                    items={node.riskIndicators}
                    empty="No risk indicator text attached"
                  />
                </DetailBlock>
                <DetailBlock label="Sources">
                  <PillList values={node.sources} variant="outline" />
                </DetailBlock>
              </div>
            </div>
          ))}
        </div>
      )}
    </InsightSection>
  );
}

function DecisionPointsSection({
  nodes,
  edges,
  onOpenNode,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  onOpenNode: (nodeId: string) => void;
}) {
  const nodeMap = getNodeMap(nodes);
  const decisionNodes = nodes.filter((node) => node.category === "decision");

  return (
    <InsightSection
      icon={Split}
      title="Decision Points"
      count={pluralize(decisionNodes.length, "decision")}
    >
      {decisionNodes.length === 0 ? (
        <SectionEmpty message="No decision nodes are present in this generated flow." />
      ) : (
        <div className="space-y-3">
          {decisionNodes.map((node) => {
            const branches = deriveDecisionBranches(node, edges);
            return (
              <div key={node.id} className={INSET_ITEM}>
                <div className="flex flex-wrap items-center gap-2">
                  <FlowNodeLink
                    nodeId={node.id}
                    label={node.label}
                    onOpenNode={onOpenNode}
                  />
                  <Badge
                    variant="outline"
                    className={CONFIDENCE_LABELS[node.confidence].className}
                  >
                    {CONFIDENCE_LABELS[node.confidence].label} confidence
                  </Badge>
                </div>
                {branches.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No branch edges are attached to this decision.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {branches.map((edge) => {
                      const target = nodeMap.get(edge.target);
                      return (
                        <div
                          key={edge.id}
                          className={cardVariants({
                            padding: "none",
                            className:
                              "flex min-w-0 flex-col gap-1 p-2 text-sm @3xl/detail:flex-row @3xl/detail:items-center @3xl/detail:justify-between",
                          })}
                        >
                          <div className="min-w-0">
                            <p className="break-words font-medium">
                              {edge.label ?? edge.type}
                            </p>
                            {target ? (
                              <FlowNodeLink
                                nodeId={target.id}
                                label={`To ${target.label}`}
                                onOpenNode={onOpenNode}
                                compact
                              />
                            ) : (
                              <p className="break-words text-xs text-muted-foreground">
                                To {edge.target}
                              </p>
                            )}
                          </div>
                          <Badge variant="outline" className="w-fit">
                            {edge.isHappyPath ? "Happy path" : "Exception path"}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </InsightSection>
  );
}

function EvidenceCoverageSection({
  nodes,
  completedConversationCount,
  flowConversationCount,
  onOpenNode,
}: {
  nodes: FlowNode[];
  completedConversationCount: number;
  flowConversationCount: number;
  onOpenNode: (nodeId: string) => void;
}) {
  const counts = deriveConfidenceCounts(nodes);
  const allSources = uniqueStrings(nodes.flatMap((node) => node.sources));
  const lowConfidenceNodes = nodes.filter((node) => node.confidence === "low");
  const totalNodes = Math.max(nodes.length, 1);

  return (
    <InsightSection
      icon={ShieldAlert}
      title="Evidence Coverage"
      count={`${flowConversationCount} of ${completedConversationCount} completed contributions`}
    >
      <div className="grid gap-4 @4xl/detail:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <div>
            <SectionLabel>
              Confidence distribution
            </SectionLabel>
            <div className="mt-3 space-y-3">
              {(["high", "medium", "low"] as const).map((confidence) => {
                const count = counts[confidence];
                const percent = Math.round((count / totalNodes) * 100);
                return (
                  <div key={confidence}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span>{CONFIDENCE_LABELS[confidence].label}</span>
                      <span className="text-muted-foreground">
                        {count} nodes, {percent}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-org-accent"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={INSET_ITEM}>
            <SectionLabel>
              Low-confidence nodes
            </SectionLabel>
            {lowConfidenceNodes.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No low-confidence nodes are marked.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {lowConfidenceNodes.map((node) => (
                  <div key={node.id} className="min-w-0">
                    <FlowNodeLink
                      nodeId={node.id}
                      label={node.label}
                      onOpenNode={onOpenNode}
                    />
                    <p className="break-words text-xs text-muted-foreground">
                      {node.sources.length > 0
                        ? node.sources.join(", ")
                        : "No source citation attached"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <SectionLabel>
            Source citations
          </SectionLabel>
          <div className="mt-3">
            {allSources.length === 0 ? (
              <SectionEmpty message="No source citations are attached to the generated nodes." />
            ) : (
              <PillList values={allSources} variant="outline" />
            )}
          </div>
        </div>
      </div>
    </InsightSection>
  );
}

function DetailBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <SectionLabel className="mb-1.5">
        {label}
      </SectionLabel>
      {children}
    </div>
  );
}

function BulletList({
  items,
  empty,
  className,
}: {
  items: string[];
  empty?: string;
  className?: string;
}) {
  const values = uniqueStrings(items);

  if (values.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        {empty ?? "None listed"}
      </p>
    );
  }

  return (
    <ul className={cn("space-y-1.5", className)}>
      {values.map((item) => (
        <li
          key={item}
          className="flex min-w-0 items-start gap-2 text-sm text-muted-foreground"
        >
          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
          <span className="min-w-0 break-words">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function ProcessInsightsTab({
  processId,
  completedConversationCount,
  canGenerate,
  isActive,
  onOpenProcessFlow,
  onOpenRecommendations,
}: ProcessInsightsTabProps) {
  const flow = useQuery(
    api.processFlows.getProcessFlow,
    isActive ? { processId } : "skip",
  );
  const generateFlow = useAction(api.processFlows.generateProcessFlow);
  const [isGenerating, setIsGenerating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const hasCompletedConversations = completedConversationCount > 0;
  const handleGenerate = useCallback(async () => {
    if (!canGenerate || !hasCompletedConversations) return;

    setIsGenerating(true);
    setActionError(null);
    try {
      await generateFlow({ processId });
    } catch {
      setActionError("Failed to start flow generation. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  }, [canGenerate, generateFlow, hasCompletedConversations, processId]);

  if (flow === undefined) return <LoadingInsights />;

  if (flow === null) {
    return (
      <div className="p-4 md:p-6">
        <EmptyState
          icon={GitBranch}
          title="No flow data yet"
          description="Generate the process flow before reviewing process-level insights."
          className="min-h-[22rem]"
          action={
            <div className="flex flex-col items-center gap-2">
              <GenerateFlowButton
                canGenerate={canGenerate}
                hasCompletedConversations={hasCompletedConversations}
                isGenerating={isGenerating}
                label="Generate Process Flow"
                onGenerate={handleGenerate}
                onOpenProcessFlow={onOpenProcessFlow}
              />
              {!hasCompletedConversations && canGenerate && (
                <p className="text-xs text-muted-foreground">
                  Complete at least one contribution first.
                </p>
              )}
              {actionError && (
                <p className="max-w-sm text-xs text-destructive" role="alert">
                  {actionError}
                </p>
              )}
            </div>
          }
        />
      </div>
    );
  }

  // Both stages, not just `status`. Insights are computed from step details —
  // tools, bottlenecks, automation opportunities — none of which exist until the
  // detail batches and the automation pass have run, so rendering when the graph
  // lands would show a tab full of zeroes.
  const stage = flowStage(flow);
  if (stage === "graph" || stage === "details") {
    const progress = flowDetailProgress(flow);
    return (
      <div className="p-4 md:p-6">
        <LoadingState
          className="min-h-[22rem]"
          title="Generating process insights"
          description={
            stage === "graph"
              ? "The flow is being generated from completed contributions. Insights will appear once the flow is ready."
              : progress
                ? `Describing each step and identifying automation opportunities — ${progress.completed} of ${progress.total} steps done.`
                : "Describing each step and identifying automation opportunities."
          }
        />
      </div>
    );
  }

  // A failed refresh keeps the previous flow, and its insights are a complete
  // earlier generation rather than a half-built one — so fall through and render
  // them under a banner. Only a first-ever failure has nothing to show.
  const showingRetained = hasRetainedPreviousFlow(flow, flow.nodes.length);
  if (stage === "failed" && !showingRetained) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <EmptyState
          icon={AlertCircle}
          title="Flow generation failed"
          description={
            flow.errorMessage ??
            "The generated flow is required before process insights can be shown."
          }
          className="min-h-[22rem]"
          action={
            <div className="flex flex-col items-center gap-2">
              <GenerateFlowButton
                canGenerate={canGenerate}
                hasCompletedConversations={hasCompletedConversations}
                isGenerating={isGenerating}
                label="Try Again"
                onGenerate={handleGenerate}
                onOpenProcessFlow={onOpenProcessFlow}
              />
              {actionError && (
                <p className="max-w-sm text-xs text-destructive" role="alert">
                  {actionError}
                </p>
              )}
            </div>
          }
        />
      </div>
    );
  }

  if (flow.nodes.length === 0) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <EmptyState
          icon={Workflow}
          title="Flow has no mapped steps"
          description="Regenerate the process flow to build insights from nodes, edges, and flow-level recommendations."
          className="min-h-[22rem]"
          action={
            <GenerateFlowButton
              canGenerate={canGenerate}
              hasCompletedConversations={hasCompletedConversations}
              isGenerating={isGenerating}
              label="Regenerate Flow"
              onGenerate={handleGenerate}
              onOpenProcessFlow={onOpenProcessFlow}
            />
          }
        />
      </div>
    );
  }

  const isStale =
    flow.stale || completedConversationCount > flow.conversationCount;
  const handoffs = deriveHandoffs(flow.nodes, flow.edges);
  const tools = deriveToolUsage(flow.nodes);
  const heavyAreas = deriveHeavyAreas(flow.nodes, handoffs);
  const bottlenecks = deriveBottlenecks(flow);
  const automationCandidates = deriveAutomationCandidates(flow.nodes);
  const keyFindings = deriveKeyFindings(flow, handoffs);
  // The flow-level count the Process Flow bottom bar shows, computed once here so
  // the tile and the section badge cannot drift from each other or from the bar.
  // `automationOpportunities` is the field to read: `deriveFlowInsights` fills it
  // 1:1 from `automationOpportunityDetails` when the analysis ran, and from the
  // automatable-looking steps when it did not, so it is always populated.
  const flowLevelAutomationCount = flow.insights.automationOpportunities.length;
  const automationUnreviewed =
    flow.insights.automationOpportunitiesSource === "derived";
  const tribalKnowledgeNodes = flow.nodes.filter(
    (node) => node.isTribalKnowledge,
  );
  const decisionCount = flow.nodes.filter(
    (node) => node.category === "decision",
  ).length;
  const lowConfidenceCount = flow.nodes.filter(
    (node) => node.confidence === "low",
  ).length;
  const uniquePainPoints = uniqueStrings(
    flow.nodes.flatMap((node) => node.painPoints),
  );
  const nodeMap = getNodeMap(flow.nodes);
  const criticalPathNodes = flow.insights.criticalPath.flatMap((nodeId) => {
    const node = nodeMap.get(nodeId);
    return node ? [node] : [];
  });

  return (
    <div className="min-h-full bg-muted/20">
      <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
        {/* The tab is labelled by the process tab strip; this keeps the
            section headings below in a sensible outline. */}
        <h2 className="sr-only">Process insights</h2>

        <KeyFindingsSummary
          result={keyFindings}
          onOpenNode={onOpenProcessFlow}
          onOpenRecommendations={onOpenRecommendations}
          onOpenProcessFlow={() => onOpenProcessFlow()}
        />

        {showingRetained && (
          <InlineNotice
            icon={AlertCircle}
            title="Couldn't refresh — showing the previous version"
            action={
              <GenerateFlowButton
                canGenerate={canGenerate}
                hasCompletedConversations={hasCompletedConversations}
                isGenerating={isGenerating}
                label="Try Again"
                onGenerate={handleGenerate}
                onOpenProcessFlow={onOpenProcessFlow}
              />
            }
          >
            {flow.errorMessage ?? "The last generation did not complete."} These
            insights come from the previous generation, which covered{" "}
            {flow.conversationCount} completed contributions.
          </InlineNotice>
        )}

        {!showingRetained && flowHasIncompleteDetails(flow) && (
          <InlineNotice
            icon={FileWarning}
            title="Some steps could not be described"
            action={
              <GenerateFlowButton
                canGenerate={canGenerate}
                hasCompletedConversations={hasCompletedConversations}
                isGenerating={isGenerating}
                label="Regenerate"
                onGenerate={handleGenerate}
                onOpenProcessFlow={onOpenProcessFlow}
              />
            }
          >
            {flow.detailErrorMessage ??
              "Not every step in this flow has a description."}{" "}
            The diagram and the metrics below cover only the steps that were
            described, so treat the counts as a floor rather than a total.
            {flow.insights.automationOpportunitiesSource === "derived" && (
              <>
                {" "}
                Automation opportunities were not analysed for this run — what
                is listed is the steps that looked automatable, not reviewed
                opportunities.
              </>
            )}
          </InlineNotice>
        )}

        {isStale && (
          <InlineNotice
            icon={AlertCircle}
            title="Insights may be based on stale flow data"
            action={
              <GenerateFlowButton
                canGenerate={canGenerate}
                hasCompletedConversations={hasCompletedConversations}
                isGenerating={isGenerating}
                label="Refresh"
                onGenerate={handleGenerate}
                onOpenProcessFlow={onOpenProcessFlow}
              />
            }
          >
            {/* Two different reasons reach this notice, and asserting the
                count one when the counts are equal reads as a bug. Say which
                one it actually is. */}
            {completedConversationCount === flow.conversationCount
              ? "This process has been updated since the flow was generated. Refresh the flow before using these insights for review."
              : `The generated flow includes ${flow.conversationCount} completed contributions, while this process currently has ${completedConversationCount}. Refresh the flow before using these insights for review.`}
          </InlineNotice>
        )}

        {actionError && (
          <InlineNotice
            icon={AlertCircle}
            title="Refresh did not start"
            tone="destructive"
          >
            {actionError}
          </InlineNotice>
        )}

        {/* Columns follow the detail panel, not the viewport: at 1280px with the
            sidebar and tree open, the panel is only about 670px wide. Compact,
            because the findings above are what to read first. */}
        <div
          role="group"
          aria-label="Process metrics"
          className="grid gap-2 @xs/detail:grid-cols-2 @4xl/detail:grid-cols-4"
        >
          <MetricTile
            icon={Users}
            label="Evidence"
            value={flow.conversationCount}
            detail={`${flow.conversationCount} of ${completedConversationCount} completed contributions`}
            accent
          />
          <MetricTile
            icon={Workflow}
            label="Mapped Steps"
            value={flow.nodes.length}
            detail={`${pluralize(flow.edges.length, "connection")} mapped`}
          />
          <MetricTile
            icon={ArrowRightLeft}
            label="Handoffs"
            value={handoffs.length}
            detail="Where work changes hands between people or roles"
          />
          <MetricTile
            icon={Monitor}
            label="Tools"
            value={flow.insights.toolCount}
            detail={`${pluralize(tools.length, "unique tool")} derived from nodes`}
          />
          <MetricTile
            icon={Split}
            label="Decisions"
            value={decisionCount}
            detail="Branching or conditional nodes"
          />
          <MetricTile
            icon={FileWarning}
            label="Bottlenecks"
            value={bottlenecks.length}
            detail={`${pluralize(uniquePainPoints.length, "pain point")} attached`}
          />
          <MetricTile
            icon={Bot}
            label="Automations"
            value={flowLevelAutomationCount}
            detail={
              automationUnreviewed
                ? "Possible only — not analysed"
                : "Recommended automations"
            }
          />
          <MetricTile
            icon={ShieldAlert}
            label="Low Confidence"
            value={lowConfidenceCount}
            detail="Nodes marked inferred or weak"
          />
        </div>

        <div className="grid gap-4 @4xl/detail:grid-cols-2">
          <HandoffsSection
            items={handoffs}
            onOpenNode={onOpenProcessFlow}
          />
          <ToolsSection
            tools={tools}
            heavyAreas={heavyAreas}
            reportedToolCount={flow.insights.toolCount}
            onOpenNode={onOpenProcessFlow}
          />
        </div>

        <div className="grid gap-4 @4xl/detail:grid-cols-2">
          <BottlenecksSection
            nodes={bottlenecks}
            onOpenNode={onOpenProcessFlow}
          />
          <AutomationSection
            opportunityDetails={flow.insights.automationOpportunityDetails}
            flowLevelCount={flowLevelAutomationCount}
            isAnalysed={!automationUnreviewed}
            candidates={automationCandidates}
            onOpenNode={onOpenProcessFlow}
            onOpenRecommendations={onOpenRecommendations}
          />
        </div>

        <div className="grid gap-4 @4xl/detail:grid-cols-2">
          <TribalKnowledgeSection
            nodes={tribalKnowledgeNodes}
            onOpenNode={onOpenProcessFlow}
          />
          <DecisionPointsSection
            nodes={flow.nodes}
            edges={flow.edges}
            onOpenNode={onOpenProcessFlow}
          />
        </div>

        <EvidenceCoverageSection
          nodes={flow.nodes}
          completedConversationCount={completedConversationCount}
          flowConversationCount={flow.conversationCount}
          onOpenNode={onOpenProcessFlow}
        />

        {flow.insights.totalEstimatedDuration && (
          <div
            className={cardVariants({
              padding: "sm",
              className:
                "flex flex-wrap items-center gap-2 text-sm text-muted-foreground",
            })}
          >
            <Timer className="size-4 shrink-0" aria-hidden />
            <span className="font-medium text-foreground">
              Estimated duration:
            </span>
            <span className="break-words">
              {flow.insights.totalEstimatedDuration}
            </span>
          </div>
        )}

        {criticalPathNodes.length > 0 && (
          <div className={cardVariants({ padding: "sm" })}>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Workflow className="size-4 text-muted-foreground" aria-hidden />
              Critical path
            </div>
            <div className="flex flex-wrap gap-2">
              {criticalPathNodes.map((node) => (
                <FlowNodeLink
                  key={node.id}
                  nodeId={node.id}
                  label={node.label}
                  onOpenNode={onOpenProcessFlow}
                  compact
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

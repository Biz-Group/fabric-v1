"use client";

import {
  X,
  AlertTriangle,
  KeyRound,
  Bot,
  Clock,
  Users,
  Monitor,
  MessageSquareWarning,
  MessageSquareText,
  ShieldAlert,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  automationPotentialTone,
  confidenceTone,
  STATUS_TONE_CHIP,
  STATUS_TONE_TEXT,
} from "@/features/status/status-meta";
import { CATEGORY_CONFIG } from "./process-flow-nodes";
import type { ReadFlowNode } from "./use-process-flow-layout";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

type FlowEdge = Doc<"processFlows">["edges"][number];
type FlowNode = ReadFlowNode;

interface ProcessFlowDetailPanelProps {
  node: FlowNode;
  edges: FlowEdge[];
  allNodes: FlowNode[];
  onClose: () => void;
  onNavigate: (nodeId: string) => void;
  onOpenConversation?: (conversationId: Id<"conversations">) => void;
  /** Re-requests this step's description. Absent for viewers. */
  onRetryDetail?: () => void | Promise<void>;
  isRetryingDetail?: boolean;
}

const AUTOMATION_LABELS = {
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "None",
} as const;

const CONFIDENCE_LABELS = {
  high: "High — confirmed by multiple sources",
  medium: "Medium — single clear source",
  low: "Low — inferred or vague",
} as const;

export function ProcessFlowDetailPanel({
  node,
  edges,
  allNodes,
  onClose,
  onNavigate,
  onOpenConversation,
  onRetryDetail,
  isRetryingDetail = false,
}: ProcessFlowDetailPanelProps) {
  const config = CATEGORY_CONFIG[node.category];
  const { Icon } = config;

  // Absent means a legacy flow, detailed inline by the single call.
  const detailStatus = node.detailStatus ?? "ready";
  const isDetailed = detailStatus === "ready";
  const detailPending =
    detailStatus === "pending" || detailStatus === "generating";

  // Find connected nodes
  const incomingEdges = edges.filter((e) => e.target === node.id);
  const outgoingEdges = edges.filter((e) => e.source === node.id);
  const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
  const linkedSources = new Set(
    onOpenConversation
      ? (node.sourceConversations ?? []).map((source) => source.source)
      : [],
  );
  const unlinkedSources = node.sources.filter(
    (source) => !linkedSources.has(source),
  );

  const automationTone = automationPotentialTone[node.automationPotential];
  const confidenceTextClass =
    STATUS_TONE_TEXT[confidenceTone[node.confidence]];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background md:w-full">
      {/* Header */}
      <div className="flex items-start gap-2 border-b border-border p-4">
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            config.iconBg,
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-sm font-medium leading-tight">
            {node.label}
          </h3>
          <div className="mt-1 flex flex-wrap gap-1">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-1.5 py-0.5 text-2xs font-medium",
                config.badgeClass,
              )}
            >
              {config.label}
            </span>
            {/* Withheld until described: these flags are assessments, and a
                node still being written carries defaults nobody assessed. */}
            {isDetailed && node.isBottleneck && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-destructive-subtle px-1.5 py-0.5 text-2xs font-medium text-destructive">
                <AlertTriangle className="size-2.5" />
                Bottleneck
              </span>
            )}
            {isDetailed && node.isTribalKnowledge && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-warning-subtle px-1.5 py-0.5 text-2xs font-medium text-warning">
                <KeyRound className="size-2.5" />
                Tribal Knowledge
              </span>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={onClose}
          aria-label="Close node details"
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 p-4">
          {/* Description, or why there isn't one yet. The connections below stay
              available in every state — the topology is settled even while the
              descriptions are still being written. */}
          {isDetailed ? (
            <div>
              <p className="break-words text-sm leading-relaxed text-muted-foreground">
                {node.description}
              </p>
            </div>
          ) : detailPending ? (
            <div className="text-muted-foreground flex items-start gap-2 text-sm">
              <Spinner className="mt-0.5" />
              <p>Describing this step from what contributors said…</p>
            </div>
          ) : (
            <div className={cardVariants({ variant: "inset", padding: "sm", className: "space-y-2" })}>
              <div className="flex items-start gap-2">
                <AlertCircle className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">No description</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {node.detailErrorMessage ??
                      "This step could not be described."}
                  </p>
                </div>
              </div>
              {onRetryDetail && (
                // One step, not the whole flow: regenerating to recover a
                // single description would re-describe every other step and
                // re-run the automation analysis.
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-full gap-1.5 text-xs"
                  onClick={() => void onRetryDetail()}
                  disabled={isRetryingDetail}
                >
                  {isRetryingDetail ? (
                    <Spinner className="size-3" />
                  ) : (
                    <RefreshCw className="size-3" />
                  )}
                  {isRetryingDetail ? "Retrying" : "Retry this step"}
                </Button>
              )}
            </div>
          )}

          {/* Actors */}
          {node.actors.length > 0 && (
            <Section icon={Users} title="Actors">
              <div className="flex flex-wrap gap-1">
                {node.actors.map((actor) => (
                  <Badge
                    key={actor}
                    variant="secondary"
                    className="h-auto max-w-full whitespace-normal break-words text-xs"
                  >
                    {actor}
                  </Badge>
                ))}
              </div>
            </Section>
          )}

          {/* Tools */}
          {node.tools.length > 0 && (
            <Section icon={Monitor} title="Tools & Systems">
              <div className="flex flex-wrap gap-1">
                {node.tools.map((tool) => (
                  <Badge
                    key={tool}
                    variant="outline"
                    className="h-auto max-w-full whitespace-normal break-words text-xs"
                  >
                    {tool}
                  </Badge>
                ))}
              </div>
            </Section>
          )}

          {/* Duration */}
          {node.estimatedDuration && (
            <Section icon={Clock} title="Estimated Duration">
              <p className="text-sm">{node.estimatedDuration}</p>
            </Section>
          )}

          {/* Automation Potential. Hidden until described — these two render a
              value for every node, so a placeholder would read as an assessment
              rather than an absence. */}
          {isDetailed && (
            <Section icon={Bot} title="Automation Potential">
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                  STATUS_TONE_CHIP[automationTone],
                )}
              >
                {AUTOMATION_LABELS[node.automationPotential]}
              </span>
            </Section>
          )}

          {/* Confidence */}
          {isDetailed && (
            <Section icon={Users} title="Confidence">
              <p className={cn("text-xs", confidenceTextClass)}>
                {CONFIDENCE_LABELS[node.confidence]}
              </p>
            </Section>
          )}

          {/* Pain Points */}
          {node.painPoints.length > 0 && (
            <Section icon={MessageSquareWarning} title="Pain Points">
              <ul className="space-y-1">
                {node.painPoints.map((pp, i) => (
                  <li
                    key={i}
                    className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground"
                  >
                    <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-destructive" />
                    <span className="min-w-0 break-words">{pp}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Risk Indicators */}
          {node.riskIndicators.length > 0 && (
            <Section icon={ShieldAlert} title="Risk Indicators">
              <ul className="space-y-1">
                {node.riskIndicators.map((risk, i) => (
                  <li
                    key={i}
                    className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground"
                  >
                    <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-warning" />
                    <span className="min-w-0 break-words">{risk}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Sources */}
          {node.sources.length > 0 && (
            <Section icon={Users} title="Sources">
              <div className="space-y-1">
                {onOpenConversation &&
                  node.sourceConversations?.map((source) => (
                    <button
                      type="button"
                      key={source.conversationId}
                      className="focus-ring-inset group flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-org-accent-subtle hover:text-foreground"
                      onClick={() => onOpenConversation(source.conversationId)}
                      aria-label={`Open source contribution: ${source.source}`}
                    >
                      <MessageSquareText
                        className="size-3.5 shrink-0 text-org-accent"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 break-words">
                        {source.source}
                      </span>
                      <ArrowRight
                        className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                        aria-hidden="true"
                      />
                    </button>
                  ))}
                {unlinkedSources.map((source) => (
                  <p
                    key={source}
                    className="break-words px-2 text-xs text-muted-foreground"
                  >
                    {source}
                  </p>
                ))}
              </div>
            </Section>
          )}

          {/* Connections */}
          {(incomingEdges.length > 0 || outgoingEdges.length > 0) && (
            <div className="space-y-2 border-t border-border pt-4">
              <SectionLabel render={<h4 />}>Connections</SectionLabel>
              {incomingEdges.map((edge) => {
                const sourceNode = nodeMap.get(edge.source);
                if (!sourceNode) return null;
                return (
                  <button
                    key={edge.id}
                    onClick={() => onNavigate(edge.source)}
                    className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-org-accent-subtle focus-ring-inset"
                    aria-label={`Navigate to source node ${sourceNode.label}`}
                  >
                    <ArrowLeft className="size-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      From: {sourceNode.label}
                    </span>
                    {edge.label && (
                      <span className="ml-auto max-w-24 shrink-0 truncate text-2xs italic text-muted-foreground">
                        {edge.label}
                      </span>
                    )}
                  </button>
                );
              })}
              {outgoingEdges.map((edge) => {
                const targetNode = nodeMap.get(edge.target);
                if (!targetNode) return null;
                return (
                  <button
                    key={edge.id}
                    onClick={() => onNavigate(edge.target)}
                    className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-org-accent-subtle focus-ring-inset"
                    aria-label={`Navigate to target node ${targetNode.label}`}
                  >
                    <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      To: {targetNode.label}
                    </span>
                    {edge.label && (
                      <span className="ml-auto max-w-24 shrink-0 truncate text-2xs italic text-muted-foreground">
                        {edge.label}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Small helper for consistent section rendering
function Section({
  icon: IconComp,
  title,
  children,
}: {
  icon: React.ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
  }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <h4 className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <IconComp className="size-3 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">{title}</span>
      </h4>
      {children}
    </div>
  );
}

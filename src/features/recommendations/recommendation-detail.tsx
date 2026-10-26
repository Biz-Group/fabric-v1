"use client";

import { useEffect, useMemo, useState, type Ref } from "react";
import { useMutation, useQuery } from "convex/react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  CornerDownRight,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { toAutomationOpportunity } from "../../../convex/lib/recommendationStage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SectionLabel } from "@/components/ui/section-label";
import { Textarea } from "@/components/ui/textarea";
import { copyTextToClipboard } from "@/lib/clipboard";
import { describeError } from "@/lib/user-error-message";
import { cn } from "@/lib/utils";
import {
  type BriefCoverage,
  type BriefOverview,
  composeOpportunityBrief,
} from "@/features/automations/opportunity-brief";
import type { FlowEdge, FlowNode } from "@/features/insights/insights-derivations";
import type { StatusTone } from "@/features/status/status-meta";
import { composeChangePlan } from "./change-plan";
import {
  CAUSE_BASIS_LABEL,
  DECISION_LABEL,
  DECISION_TONE,
  DISMISS_REASON_LABEL,
  DISMISS_REASONS,
  EFFORT_TONE,
  INTERVENTION_LABEL,
  interviewsLabel,
  isTechnical,
  VALUE_TONE,
  type ClientRecommendation,
  type DecisionStatus,
  type DismissReason,
} from "./recommendation-meta";

const markdownComponents: Components = {
  h1: () => null, // The title is already the panel heading.
  h2: ({ children }) => (
    <SectionLabel render={<h4 />} className="mt-5 mb-2 text-foreground first:mt-0">
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

export type DetailFlow = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  criticalPath: string[];
};

type DetailProps = {
  recommendation: ClientRecommendation;
  canDecide: boolean;
  flow: DetailFlow;
  processName: string;
  departmentName?: string | null;
  functionName?: string | null;
  overview: BriefOverview | null;
  coverage: BriefCoverage | null;
  headingRef: Ref<HTMLHeadingElement>;
  onBack: () => void;
  onShowStep?: (nodeId: string) => void;
  /** The change a follow-on builds on, and the follow-ons built on this one. */
  related?: {
    buildsOn: ClientRecommendation | null;
    followOns: ClientRecommendation[];
  };
  onSelectRecommendation?: (id: string) => void;
};

export function RecommendationDetail(props: DetailProps) {
  const { recommendation } = props;
  return (
    <article className="p-4 sm:p-6">
      <Button
        size="sm"
        variant="ghost"
        className="mb-3 -ml-2 gap-1.5 @3xl/detail:hidden"
        onClick={props.onBack}
      >
        <ArrowLeft className="size-3.5" />
        All recommendations
      </Button>
      {recommendation.content && recommendation.scores ? (
        <CurrentRecommendation
          {...props}
          content={recommendation.content}
          scores={recommendation.scores}
        />
      ) : (
        <LegacySuggestion {...props} />
      )}
    </article>
  );
}

function CurrentRecommendation({
  recommendation,
  content,
  scores,
  canDecide,
  flow,
  processName,
  departmentName,
  functionName,
  overview,
  coverage,
  headingRef,
  onShowStep,
  related,
  onSelectRecommendation,
}: DetailProps & {
  content: NonNullable<ClientRecommendation["content"]>;
  scores: NonNullable<ClientRecommendation["scores"]>;
}) {
  const stepLabels = useMemo(
    () => new Map(flow.nodes.map((node) => [node.id, node.label])),
    [flow.nodes],
  );
  const steps = recommendation.nodeIds.filter((id) => stepLabels.has(id));
  const technical = isTechnical(content.intervention);
  const superseded = recommendation.lifecycle !== "active";
  // Read once per opened recommendation; the review date only needs the day.
  const [today] = useState(() => Date.now());

  const plan = useMemo(() => {
    if (!technical) {
      return composeChangePlan({
        recommendation: { ...recommendation, content },
        stepLabels,
        processName,
        today,
      });
    }
    const opportunity = toAutomationOpportunity({
      title: recommendation.title,
      nodeIds: recommendation.nodeIds,
      content,
      scores,
    });
    return opportunity
      ? composeOpportunityBrief({
          opportunity,
          nodes: flow.nodes,
          edges: flow.edges,
          criticalPath: flow.criticalPath,
          processName,
          departmentName,
          functionName,
          overview,
          coverage,
        })
      : null;
  }, [
    technical,
    today,
    recommendation,
    content,
    scores,
    stepLabels,
    flow,
    processName,
    departmentName,
    functionName,
    overview,
    coverage,
  ]);

  return (
    <>
      <div className="min-w-0">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-base font-semibold leading-6 focus:outline-none"
        >
          {recommendation.title}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="text-2xs">
            {INTERVENTION_LABEL[content.intervention]}
          </Badge>
          <Badge tone={technical ? "info" : "success"} className="text-2xs">
            {technical ? "Technical" : "Non-technical"}
          </Badge>
          {recommendation.decisionStatus !== "new" ? (
            <Badge tone={DECISION_TONE[recommendation.decisionStatus]} className="text-2xs">
              {DECISION_LABEL[recommendation.decisionStatus]}
              {recommendation.dismissReason
                ? ` · ${DISMISS_REASON_LABEL[recommendation.dismissReason]}`
                : ""}
            </Badge>
          ) : null}
        </div>
        {superseded ? (
          <p className="mt-2 text-xs text-muted-foreground">
            The latest analysis did not return this recommendation. It is kept
            because someone had made a decision about it.
          </p>
        ) : null}
        <RelatedLinks related={related} onSelect={onSelectRecommendation} />
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <ScoreBlock
          label="Value"
          level={scores.value.level}
          tone={VALUE_TONE[scores.value.level]}
          reasons={scores.value.reasons}
        />
        <ScoreBlock
          label="Effort"
          level={scores.effort.level}
          tone={EFFORT_TONE[scores.effort.level]}
          reasons={scores.effort.reasons}
        />
        <div className="min-w-0 rounded-md border px-3 py-2">
          <dt className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            Evidence
          </dt>
          <dd className="mt-0.5 text-sm font-medium">
            {interviewsLabel(scores.evidence.interviews)}
          </dd>
          <dd className="mt-1 text-2xs text-muted-foreground">
            {scores.evidence.contributors === 1
              ? "One person's account — worth confirming with another."
              : `${scores.evidence.contributors} people described these steps.`}
          </dd>
        </div>
      </dl>

      <DecisionControls
        recommendation={recommendation}
        canDecide={canDecide && !superseded}
      />

      <div className="mt-6 max-w-3xl space-y-6">
        <Section title="The problem">
          <Prose>{content.problem}</Prose>
          {steps.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {steps.map((id) =>
                onShowStep ? (
                  <Button
                    key={id}
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    onClick={() => onShowStep(id)}
                  >
                    {stepLabels.get(id)}
                    <ChevronRight className="size-3" />
                  </Button>
                ) : (
                  <Badge key={id} variant="outline">
                    {stepLabels.get(id)}
                  </Badge>
                ),
              )}
            </div>
          ) : null}
        </Section>

        <Section title="Why it happens">
          <Prose>{content.cause || "Not known yet."}</Prose>
          <p className="mt-1 text-xs text-muted-foreground">
            {CAUSE_BASIS_LABEL[content.causeBasis]}
          </p>
        </Section>

        <Section title="What to change">
          <Prose>{content.proposedChange}</Prose>
          {content.supportingInterventions.length > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Alongside:{" "}
              {content.supportingInterventions
                .map((rung) => INTERVENTION_LABEL[rung].toLowerCase())
                .join(", ")}
            </p>
          ) : null}
          {content.whyNotSimpler ? (
            <div className="mt-3 rounded-md border bg-muted/40 px-3 py-2">
              <p className="text-xs font-medium">Why not something simpler</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {content.whyNotSimpler}
              </p>
            </div>
          ) : null}
        </Section>

        <Section title="Try it">
          <Prose>
            {content.pilot.what || "Agree a small, time-boxed trial with the people affected."}
          </Prose>
          <p className="mt-2 text-sm">
            <span className="font-medium">Measure: </span>
            <span className="text-muted-foreground">
              {content.pilot.measure || "Agree one observable measure before starting."}
            </span>
          </p>
        </Section>

        {related && related.followOns.length > 0 ? (
          <Section title="Next step">
            <p className="text-sm text-muted-foreground">
              Once this is in place, a technical change can build on it. It is
              decided on its own.
            </p>
            <ul className="mt-3 space-y-2">
              {related.followOns.map((followOn) => (
                <li key={followOn._id}>
                  <NextStepCard
                    recommendation={followOn}
                    onSelect={onSelectRecommendation}
                  />
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title="People affected">
          {scores.peopleAffected.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {scores.peopleAffected.map((person) => (
                <Badge key={person} variant="outline">
                  {person}
                </Badge>
              ))}
            </div>
          ) : (
            <Prose>The interviews did not name the roles on these steps.</Prose>
          )}
        </Section>

        {content.openQuestions.length > 0 || content.risks.length > 0 ? (
          <Section title="What we don't know">
            <BulletList items={content.openQuestions} />
            {content.risks.length > 0 ? (
              <>
                <p className="mt-3 text-xs font-medium">What could go wrong</p>
                <BulletList items={content.risks} />
              </>
            ) : null}
          </Section>
        ) : null}

        {plan ? (
          <Section title={technical ? "Build brief" : "Change plan"}>
            <p className="text-sm text-muted-foreground">
              {technical
                ? "Paste this into Copilot Studio's agent builder as the description of what to build."
                : "Who is affected, the pilot, the measure, when to review it, and how to undo it — ready to share."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <CopyButton
                markdown={plan.body}
                label={technical ? "Copy for Copilot Studio" : "Copy change plan"}
              />
            </div>
            <Collapsible className="mt-3">
              <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                <ChevronRight className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
                Preview
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-3 rounded-md border px-4 py-3">
                  <ReactMarkdown components={markdownComponents}>
                    {plan.body}
                  </ReactMarkdown>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </Section>
        ) : null}

        <Activity recommendation={recommendation} />
      </div>
    </>
  );
}

/** An automation suggestion from before recommendations, with its V0 brief. */
function LegacySuggestion({
  recommendation,
  flow,
  processName,
  departmentName,
  functionName,
  overview,
  coverage,
  headingRef,
}: DetailProps) {
  const brief = useMemo(
    () =>
      recommendation.legacy
        ? composeOpportunityBrief({
            opportunity: recommendation.legacy,
            nodes: flow.nodes,
            edges: flow.edges,
            criticalPath: flow.criticalPath,
            processName,
            departmentName,
            functionName,
            overview,
            coverage,
          })
        : null,
    [recommendation.legacy, flow, processName, departmentName, functionName, overview, coverage],
  );

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold leading-6 focus:outline-none"
          >
            {recommendation.title}
          </h2>
          <p className="mt-1.5 text-xs text-muted-foreground">
            An earlier automation suggestion, made before recommendations covered
            non-technical changes. Read-only.
          </p>
        </div>
        {brief ? <CopyButton markdown={brief.body} label="Copy" /> : null}
      </div>
      {brief ? (
        <div className="mt-5 max-w-3xl">
          <ReactMarkdown components={markdownComponents}>{brief.body}</ReactMarkdown>
        </div>
      ) : null}
    </>
  );
}

/**
 * A technical follow-on builds on a simpler change; the two are decided
 * separately, so the follow-on links back to it here and the parent lists its
 * follow-ons under "Next step".
 */
function RelatedLinks({
  related,
  onSelect,
}: {
  related?: DetailProps["related"];
  onSelect?: (id: string) => void;
}) {
  if (!related?.buildsOn) return null;
  const link = (rec: ClientRecommendation) =>
    onSelect ? (
      <button
        type="button"
        className="font-medium text-foreground underline-offset-2 hover:underline focus-ring"
        onClick={() => onSelect(rec._id)}
      >
        {rec.title}
      </button>
    ) : (
      <span className="font-medium text-foreground">{rec.title}</span>
    );
  return (
    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
      {related.buildsOn ? (
        <p>
          Builds on {link(related.buildsOn)} — do that first.
        </p>
      ) : null}
    </div>
  );
}

function NextStepCard({
  recommendation,
  onSelect,
}: {
  recommendation: ClientRecommendation;
  onSelect?: (id: string) => void;
}) {
  const content = recommendation.content;
  const body = (
    <>
      <span className="flex flex-wrap items-center gap-1.5">
        <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">{recommendation.title}</span>
        {content ? (
          <Badge tone="info" className="text-2xs">
            {INTERVENTION_LABEL[content.intervention]}
          </Badge>
        ) : null}
        {recommendation.decisionStatus !== "new" ? (
          <Badge tone={DECISION_TONE[recommendation.decisionStatus]} className="text-2xs">
            {DECISION_LABEL[recommendation.decisionStatus]}
          </Badge>
        ) : null}
      </span>
      {content ? (
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {content.proposedChange}
        </span>
      ) : null}
      {recommendation.scores ? (
        <span className="mt-1 block text-2xs text-muted-foreground">
          Effort {recommendation.scores.effort.level}
        </span>
      ) : null}
    </>
  );
  return onSelect ? (
    <button
      type="button"
      onClick={() => onSelect(recommendation._id)}
      className="block w-full rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-ring"
    >
      {body}
    </button>
  ) : (
    <div className="rounded-md border px-3 py-2">{body}</div>
  );
}

function ScoreBlock({
  label,
  level,
  tone,
  reasons,
}: {
  label: string;
  level: string;
  tone: StatusTone;
  reasons: string[];
}) {
  return (
    <div className="min-w-0 rounded-md border px-3 py-2">
      <dt className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5">
        <Badge tone={tone} className="text-2xs capitalize">
          {level}
        </Badge>
      </dd>
      {reasons.length > 0 ? (
        <dd className="mt-1 text-2xs leading-4 text-muted-foreground">
          {reasons.join(" · ")}
        </dd>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <SectionLabel render={<h3 />} className="mb-1.5 text-foreground">
        {title}
      </SectionLabel>
      {children}
    </section>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return <p className="break-words text-sm leading-6 text-muted-foreground">{children}</p>;
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="ml-4 list-disc space-y-1 text-sm leading-6 text-muted-foreground">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

const ACTIONS: Record<DecisionStatus, Array<{ to: DecisionStatus; label: string }>> = {
  new: [
    { to: "shortlisted", label: "Shortlist" },
    { to: "in_progress", label: "Start" },
  ],
  shortlisted: [
    { to: "in_progress", label: "Start" },
    { to: "new", label: "Remove from shortlist" },
  ],
  in_progress: [
    { to: "done", label: "Mark done" },
    { to: "shortlisted", label: "Pause" },
  ],
  done: [{ to: "in_progress", label: "Reopen" }],
  dismissed: [{ to: "new", label: "Reopen" }],
};

function DecisionControls({
  recommendation,
  canDecide,
}: {
  recommendation: ClientRecommendation;
  canDecide: boolean;
}) {
  const setDecision = useMutation(api.recommendations.setRecommendationDecision);
  const [pending, setPending] = useState<DecisionStatus | null>(null);
  const [dismissOpen, setDismissOpen] = useState(false);
  // A new key per opening gives the dialog a fresh, empty form.
  const [dismissKey, setDismissKey] = useState(0);

  if (!canDecide) return null;

  const decide = async (to: DecisionStatus) => {
    setPending(to);
    try {
      await setDecision({ recommendationId: recommendation._id, to });
    } catch (error) {
      toast.error(describeError(error, "Could not update this recommendation."));
    } finally {
      setPending(null);
    }
  };

  const current = recommendation.decisionStatus;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {ACTIONS[current].map((action, index) => (
        <Button
          key={action.to}
          size="sm"
          variant={index === 0 ? "default" : "outline"}
          disabled={pending !== null}
          onClick={() => void decide(action.to)}
        >
          {pending === action.to ? "Saving…" : action.label}
        </Button>
      ))}
      {current !== "dismissed" ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending !== null}
          onClick={() => {
            setDismissKey((key) => key + 1);
            setDismissOpen(true);
          }}
        >
          Dismiss…
        </Button>
      ) : null}
      <DismissDialog
        key={dismissKey}
        open={dismissOpen}
        onOpenChange={setDismissOpen}
        recommendation={recommendation}
      />
    </div>
  );
}

function DismissDialog({
  open,
  onOpenChange,
  recommendation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recommendation: ClientRecommendation;
}) {
  const setDecision = useMutation(api.recommendations.setRecommendationDecision);
  const [reason, setReason] = useState<DismissReason | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!reason) return;
    setSaving(true);
    try {
      await setDecision({
        recommendationId: recommendation._id,
        to: "dismissed",
        reason,
        note: note.trim() || undefined,
      });
      onOpenChange(false);
    } catch (error) {
      toast.error(describeError(error, "Could not dismiss this recommendation."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dismiss recommendation</DialogTitle>
          <DialogDescription>
            Fabric will not suggest it again unless the evidence changes. You can
            reopen it later.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-1.5 py-1">
          <legend className="mb-1.5 text-sm font-medium">Reason</legend>
          {DISMISS_REASONS.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50",
                reason === option.value && "border-primary bg-muted/60",
              )}
            >
              <input
                type="radio"
                name="dismiss-reason"
                value={option.value}
                checked={reason === option.value}
                onChange={() => setReason(option.value)}
                className="accent-primary"
              />
              {option.label}
            </label>
          ))}
        </fieldset>
        <div className="space-y-1.5">
          <label htmlFor="dismiss-note" className="text-sm font-medium">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id="dismiss-note"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything the next person should know"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!reason || saving}>
            {saving ? "Dismissing…" : "Dismiss"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// History and rating
// ---------------------------------------------------------------------------

function Activity({ recommendation }: { recommendation: ClientRecommendation }) {
  const activity = useQuery(api.recommendations.getRecommendationActivity, {
    recommendationId: recommendation._id,
  });
  const rate = useMutation(api.recommendations.rateRecommendation);

  const submitRating = async (useful: boolean) => {
    try {
      await rate({ recommendationId: recommendation._id, useful });
    } catch (error) {
      toast.error(describeError(error, "Could not save your rating."));
    }
  };

  return (
    <section className="border-t pt-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Was this useful?</span>
        <Button
          size="icon-sm"
          variant={activity?.ratings.mine === true ? "default" : "outline"}
          aria-label="Useful"
          aria-pressed={activity?.ratings.mine === true}
          disabled={activity === undefined}
          onClick={() => void submitRating(true)}
        >
          <ThumbsUp className="size-3.5" />
        </Button>
        <Button
          size="icon-sm"
          variant={activity?.ratings.mine === false ? "default" : "outline"}
          aria-label="Not useful"
          aria-pressed={activity?.ratings.mine === false}
          disabled={activity === undefined}
          onClick={() => void submitRating(false)}
        >
          <ThumbsDown className="size-3.5" />
        </Button>
        {activity && activity.ratings.useful + activity.ratings.notUseful > 0 ? (
          <span className="text-xs text-muted-foreground">
            {activity.ratings.useful} useful · {activity.ratings.notUseful} not useful
          </span>
        ) : null}
      </div>

      {activity && activity.history.length > 0 ? (
        <div className="mt-4">
          <SectionLabel render={<h3 />} className="mb-1.5 text-foreground">
            History
          </SectionLabel>
          <ol className="space-y-1.5 text-xs text-muted-foreground">
            {activity.history.map((entry) => (
              <li key={entry._id}>
                <span className="text-foreground">{entry.actorName}</span>{" "}
                {entry.to === "dismissed"
                  ? `dismissed it${entry.reason ? ` (${DISMISS_REASON_LABEL[entry.reason].toLowerCase()})` : ""}`
                  : `moved it to ${DECISION_LABEL[entry.to].toLowerCase()}`}{" "}
                ·{" "}
                {new Date(entry.createdAt).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
                {entry.note ? <span className="block italic">“{entry.note}”</span> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function CopyButton({ markdown, label }: { markdown: string; label: string }) {
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
      {state === "copied" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {state === "copied"
        ? "Copied"
        : state === "failed"
          ? "Copy failed — select the text"
          : label}
    </Button>
  );
}

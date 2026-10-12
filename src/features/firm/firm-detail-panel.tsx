"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Building2,
  ExternalLink,
  Globe,
  Layers,
  Quote,
  UserRound,
  Users,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  entityIdOf,
  linksAcross,
  nodeKind,
  nodeLabel,
  procNodeId,
  summarizeDepartment,
  type DirectedLink,
  type FirmGraphEdge,
  type FirmModel,
  type FirmNodeKind,
} from "./firm-graph";

export type OwnerCandidate = {
  membershipId: Id<"memberships">;
  name: string;
  jobTitle: string | null;
};

type FirmDetailPanelProps = {
  model: FirmModel;
  /** Exactly one of these is set. */
  nodeId?: string;
  edge?: FirmGraphEdge;
  isGap: (departmentId: string) => boolean;
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
  processHref: (processId: string, nodeId?: string) => string;
  /** Admins only. */
  ownerCandidates?: OwnerCandidate[];
  onSetOwner?: (
    processId: Id<"processes">,
    ownerMembershipId: Id<"memberships"> | null,
  ) => void;
};

const KIND_ICON: Record<FirmNodeKind, LucideIcon> = {
  function: Layers,
  department: Building2,
  process: Workflow,
  external: Globe,
  outside: Globe,
};

const KIND_LABEL: Record<FirmNodeKind, string> = {
  function: "Function",
  department: "Department",
  process: "Process",
  external: "Outside party",
  outside: "Outside the organisation",
};

const CONFIDENCE_CLASS = {
  high: "text-green-600 dark:text-green-400",
  medium: "text-yellow-600 dark:text-yellow-400",
  low: "text-red-600 dark:text-red-400",
} as const;

const NO_OWNER = "none";

export function FirmDetailPanel(props: FirmDetailPanelProps) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      {props.edge ? (
        <EdgeDetail {...props} edge={props.edge} />
      ) : props.nodeId ? (
        <NodeDetail {...props} nodeId={props.nodeId} />
      ) : null}
    </div>
  );
}

function PanelHeader({
  icon: Icon,
  title,
  eyebrow,
  subtitle,
  onClose,
}: {
  icon: LucideIcon;
  title: React.ReactNode;
  eyebrow: string;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start gap-2 border-b border-border p-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-org-accent-subtle text-org-accent">
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {eyebrow}
        </p>
        <h3 className="break-words text-sm font-medium leading-tight">
          {title}
        </h3>
        {subtitle && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        aria-label="Close details"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
        {title}
      </h4>
      {children}
    </section>
  );
}

function breadcrumb(model: FirmModel, nodeId: string): string | undefined {
  const [, ...ancestors] = model.ancestors(nodeId);
  const labels = ancestors
    .filter((id) => id !== "outside")
    .map((id) => nodeLabel(model, id));
  return labels.length > 0 ? labels.join(" · ") : undefined;
}

function NodeDetail({
  model,
  nodeId,
  isGap,
  onClose,
  onSelectNode,
  processHref,
  ownerCandidates,
  onSetOwner,
}: FirmDetailPanelProps & { nodeId: string }) {
  const kind = nodeKind(nodeId);
  const { outbound, inbound } = linksAcross(model, nodeId);
  const process =
    kind === "process" ? model.processById.get(entityIdOf(nodeId)) : undefined;
  const departmentId = kind === "department" ? entityIdOf(nodeId) : null;

  return (
    <>
      <PanelHeader
        icon={KIND_ICON[kind]}
        eyebrow={KIND_LABEL[kind]}
        title={nodeLabel(model, nodeId)}
        subtitle={breadcrumb(model, nodeId)}
        onClose={onClose}
      />
      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {process && (
          <>
            <Section title="Accountable owner" icon={UserRound}>
              {onSetOwner && ownerCandidates ? (
                <Select
                  value={process.owner?.membershipId ?? NO_OWNER}
                  items={[
                    { value: NO_OWNER, label: "No owner" },
                    ...ownerCandidates.map((candidate) => ({
                      value: candidate.membershipId,
                      label: candidate.name,
                    })),
                  ]}
                  onValueChange={(value) =>
                    onSetOwner(
                      process._id,
                      !value || value === NO_OWNER
                        ? null
                        : (value as Id<"memberships">),
                    )
                  }
                >
                  <SelectTrigger className="w-full" aria-label="Accountable owner">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_OWNER}>No owner</SelectItem>
                    {ownerCandidates.map((candidate) => (
                      <SelectItem
                        key={candidate.membershipId}
                        value={candidate.membershipId}
                      >
                        {candidate.name}
                        {candidate.jobTitle && (
                          <span className="ml-1 text-muted-foreground">
                            · {candidate.jobTitle}
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : process.owner ? (
                <p className="text-sm">
                  {process.owner.name}
                  {process.owner.jobTitle && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {process.owner.jobTitle}
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  Nobody is accountable for this process yet.
                </p>
              )}
            </Section>

            <Section title="Who does the work" icon={Users}>
              {process.roles.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {process.roles.map((role) => (
                    <Badge key={role.name} variant="secondary">
                      {role.name}
                      <span className="ml-1 text-muted-foreground">
                        {role.stepCount} {role.stepCount === 1 ? "step" : "steps"}
                      </span>
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {process.mapped
                    ? "The flow doesn't name who performs its steps."
                    : "Appears once this process has a mapped flow."}
                </p>
              )}
            </Section>

            {process.resolutionStatus === "failed" && (
              <p className="flex items-start gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                This process&apos;s handoffs could not be read. An admin can
                rebuild the map to try again.
              </p>
            )}

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              render={<Link href={processHref(process._id)} />}
            >
              <Workflow className="h-3.5 w-3.5" />
              Open process flow
            </Button>
          </>
        )}

        {departmentId && (
          <DepartmentProcesses
            model={model}
            departmentId={departmentId}
            gap={isGap(departmentId)}
            onSelectNode={onSelectNode}
          />
        )}

        <LinkGroups
          title="Hands work to"
          icon={ArrowRight}
          links={outbound}
          farEnd={(link) => link.to}
          model={model}
          onSelectNode={onSelectNode}
          processHref={processHref}
          empty={
            kind === "external"
              ? "Nothing goes to this party."
              : "No outgoing handoffs found yet."
          }
        />
        <LinkGroups
          title="Receives work from"
          icon={ArrowLeft}
          links={inbound}
          farEnd={(link) => link.from}
          model={model}
          onSelectNode={onSelectNode}
          processHref={processHref}
          empty={
            kind === "external"
              ? "Nothing comes from this party."
              : "No incoming handoffs found yet."
          }
        />
      </div>
    </>
  );
}

function DepartmentProcesses({
  model,
  departmentId,
  gap,
  onSelectNode,
}: {
  model: FirmModel;
  departmentId: string;
  gap: boolean;
  onSelectNode: (nodeId: string) => void;
}) {
  const summary = summarizeDepartment(model, departmentId);
  const processes = model.data.processes.filter(
    (p) => p.departmentId === departmentId,
  );
  return (
    <Section title={`Processes (${summary.mappedCount} of ${summary.processCount} mapped)`} icon={Workflow}>
      {gap && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Other teams hand work here {summary.inboundCount}{" "}
          {summary.inboundCount === 1 ? "time" : "times"}, but nothing in this
          department has been mapped. Interviewing it would close the gap.
        </p>
      )}
      {processes.length === 0 ? (
        <p className="text-xs text-muted-foreground">No processes yet.</p>
      ) : (
        <ul className="space-y-1">
          {processes.map((process) => (
            <li key={process._id}>
              <button
                type="button"
                onClick={() => onSelectNode(procNodeId(process._id))}
                className="org-focus-ring flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <span
                  className={cn(
                    "truncate",
                    !process.mapped && "text-muted-foreground",
                  )}
                >
                  {process.name}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[11px]",
                    process.owner
                      ? "text-muted-foreground"
                      : "text-amber-700 dark:text-amber-400",
                  )}
                >
                  {process.owner?.name ?? "No owner"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Links grouped by whoever is at the other end. */
function LinkGroups({
  title,
  icon,
  links,
  farEnd,
  model,
  onSelectNode,
  processHref,
  empty,
}: {
  title: string;
  icon: LucideIcon;
  links: DirectedLink[];
  farEnd: (link: DirectedLink) => string;
  model: FirmModel;
  onSelectNode: (nodeId: string) => void;
  processHref: (processId: string, nodeId?: string) => string;
  empty: string;
}) {
  const groups = new Map<string, DirectedLink[]>();
  for (const link of links) {
    const key = farEnd(link);
    groups.set(key, [...(groups.get(key) ?? []), link]);
  }
  const ordered = Array.from(groups.entries()).sort(
    (a, b) => b[1].length - a[1].length,
  );

  return (
    <Section title={`${title} (${links.length})`} icon={icon}>
      {ordered.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-3">
          {ordered.map(([counterpartId, group]) => (
            <div key={counterpartId} className="rounded-lg border border-border">
              <button
                type="button"
                onClick={() => onSelectNode(counterpartId)}
                className="org-focus-ring flex w-full items-center gap-1.5 rounded-t-lg border-b border-border bg-muted/40 px-3 py-2 text-left text-sm font-medium hover:bg-muted"
              >
                {(() => {
                  const Icon = KIND_ICON[nodeKind(counterpartId)];
                  return (
                    <Icon
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  );
                })()}
                <span className="truncate">{nodeLabel(model, counterpartId)}</span>
              </button>
              <ul className="divide-y divide-border">
                {group.map((link) => (
                  <li key={link.link._id} className="p-3">
                    <LinkEvidence
                      model={model}
                      directed={link}
                      processHref={processHref}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function LinkEvidence({
  model,
  directed,
  processHref,
}: {
  model: FirmModel;
  directed: DirectedLink;
  processHref: (processId: string, nodeId?: string) => string;
}) {
  const { link } = directed;
  const reporter = model.processById.get(link.sourceProcessId);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-sm font-medium">{link.label}</span>
        {link.kind === "dependency" && (
          <Badge variant="outline" className="text-[10px]">
            dependency
          </Badge>
        )}
        {link.review === "proposed" && (
          <Badge variant="secondary" className="text-[10px]">
            proposed
          </Badge>
        )}
        <span className={cn("text-[10px]", CONFIDENCE_CLASS[link.confidence])}>
          {link.confidence} confidence
        </span>
      </div>
      {link.evidence.map((quote) => (
        <p
          key={quote}
          className="flex gap-1.5 text-xs italic leading-relaxed text-muted-foreground"
        >
          <Quote className="mt-0.5 h-3 w-3 shrink-0 not-italic" aria-hidden />
          <span>{quote}</span>
        </p>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          {link.contributors.length > 0
            ? `Described by ${link.contributors.join(", ")}`
            : "From the mapped flow"}
          {reporter && ` · reported in ${reporter.name}`}
        </span>
        {reporter && (
          <Link
            href={processHref(link.sourceProcessId, link.nodeIds[0])}
            className="org-focus-ring inline-flex items-center gap-0.5 rounded font-medium text-foreground hover:underline"
          >
            View step
            <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}

function EdgeDetail({
  model,
  edge,
  onClose,
  onSelectNode,
  processHref,
}: FirmDetailPanelProps & { edge: FirmGraphEdge }) {
  return (
    <>
      <PanelHeader
        icon={ArrowRight}
        eyebrow={[
          edge.bidirectional ? "Two-way exchange" : "Handoff",
          edge.corroborated ? "both sides agree" : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        title={
          <>
            {nodeLabel(model, edge.source)}
            {edge.bidirectional ? (
              <ArrowLeftRight className="mx-1 inline h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ArrowRight className="mx-1 inline h-3.5 w-3.5 text-muted-foreground" />
            )}
            {nodeLabel(model, edge.target)}
          </>
        }
        subtitle={`${edge.links.length} ${edge.links.length === 1 ? "link" : "links"} found in interviews`}
        onClose={onClose}
      />
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <div className="flex flex-wrap gap-1.5">
          {[edge.source, edge.target].map((id) => (
            <Button
              key={id}
              variant="outline"
              size="xs"
              onClick={() => onSelectNode(id)}
            >
              {nodeLabel(model, id)}
            </Button>
          ))}
        </div>
        <ul className="space-y-3">
          {edge.links.map((link) => (
            <li key={link.link._id} className="rounded-lg border border-border p-3">
              {edge.bidirectional && (
                <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  {nodeLabel(model, link.from)}
                  <ArrowRight className="h-3 w-3" aria-hidden />
                  {nodeLabel(model, link.to)}
                </p>
              )}
              <LinkEvidence model={model} directed={link} processHref={processHref} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/** For the view: the workbench deep link needs the full function/department path. */
export function processSelection(
  model: FirmModel,
  processId: string,
): { fn: string; dept: string; proc: string } | null {
  const process = model.processById.get(processId);
  if (!process) return null;
  const department = model.departmentById.get(process.departmentId);
  if (!department) return null;
  return { fn: department.functionId, dept: department._id, proc: processId };
}

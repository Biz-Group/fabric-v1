"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  AlertTriangle,
  Building2,
  Globe,
  Layers,
  Loader2,
  UserRound,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  DepartmentSummary,
  FirmConfidence,
  FirmNodeKind,
} from "./firm-graph";
import {
  FIRM_EDGE_LABEL_HEIGHT,
  roundedOrthogonalPath,
  type FirmEdgeRoute,
} from "./firm-layout";

export type FirmNodeData = {
  kind: FirmNodeKind;
  label: string;
  /** The selected node, or one directly connected to it. */
  focused: boolean;
  dimmed: boolean;
  /** Department card (department level). */
  summary?: DepartmentSummary;
  /** Others hand work here but nothing inside is mapped. */
  gap?: boolean;
  /** Process card. */
  owner?: string | null;
  topRole?: string | null;
  mapped?: boolean;
  resolving?: boolean;
  /** Container frame. */
  childCount?: number;
};

export type FirmFlowNode = Node<FirmNodeData>;

export type FirmEdgeData = {
  /** ELK's route and label box, in flow coordinates. */
  route?: FirmEdgeRoute;
  labelText: string | null;
  linkCount: number;
  corroborated: boolean;
  confidence: FirmConfidence;
  proposed: boolean;
  highlighted: boolean;
  dimmed: boolean;
  showLabel: boolean;
};

export type FirmFlowEdge = Edge<FirmEdgeData, "firm">;

const HANDLE_CLASS =
  "pointer-events-none !h-px !w-px !border-0 !bg-transparent !opacity-0";

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Left} className={HANDLE_CLASS} />
      <Handle type="source" position={Position.Right} className={HANDLE_CLASS} />
    </>
  );
}

const CARD_BASE =
  "h-full w-full rounded-xl border border-border bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.06),0_8px_22px_rgba(15,23,42,0.04)] transition-[border-color,box-shadow,opacity] duration-200 motion-reduce:transition-none";

function cardState(data: FirmNodeData, selected: boolean) {
  return cn(
    selected &&
      "ring-2 ring-org-accent-border shadow-[0_12px_30px_rgba(15,23,42,0.12)]",
    !selected && data.focused && "ring-2 ring-org-accent-ring/35",
    !selected && !data.dimmed && "hover:shadow-[0_8px_24px_rgba(15,23,42,0.10)]",
    data.dimmed && "opacity-35",
  );
}

// ---------------------------------------------------------------------------
// Containers: functions, departments at process level, and the outside band.
// ---------------------------------------------------------------------------

const CONTAINER_STYLE: Record<
  "function" | "department" | "outside",
  { frame: string; Icon: typeof Layers }
> = {
  function: {
    frame: "rounded-2xl border border-border bg-muted/35",
    Icon: Layers,
  },
  department: {
    frame: "rounded-xl border border-dashed border-border bg-background/70",
    Icon: Building2,
  },
  outside: {
    frame:
      "rounded-2xl border border-dashed border-sky-500/40 bg-sky-500/[0.04]",
    Icon: Globe,
  },
};

function FirmContainerNode({ data, selected }: NodeProps<FirmFlowNode>) {
  const style =
    CONTAINER_STYLE[
      data.kind === "function" || data.kind === "outside"
        ? data.kind
        : "department"
    ];
  const { Icon } = style;
  return (
    <>
      <Handles />
      <div
        className={cn(
          "h-full w-full transition-[box-shadow,opacity] duration-200",
          style.frame,
          selected && "ring-2 ring-org-accent-border",
          !selected && data.focused && "ring-2 ring-org-accent-ring/30",
        )}
      >
        <div className="flex h-9 items-center gap-1.5 px-3">
          <Icon
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span
            className={cn(
              "truncate",
              data.kind === "department"
                ? "text-xs font-medium text-foreground/80"
                : "text-xs font-semibold uppercase tracking-wide text-muted-foreground",
            )}
            title={data.label}
          >
            {data.label}
          </span>
          {data.gap && (
            <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
              Unmapped
            </span>
          )}
        </div>
        {data.kind === "department" && data.childCount === 0 && (
          <p className="px-3 text-[11px] text-muted-foreground">
            No processes yet
          </p>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Leaves
// ---------------------------------------------------------------------------

function FirmDepartmentNode({ data, selected }: NodeProps<FirmFlowNode>) {
  const summary = data.summary;
  return (
    <>
      <Handles />
      <div
        className={cn(
          CARD_BASE,
          "flex flex-col justify-between border-l-4 border-l-violet-500 p-3",
          data.gap && "border-l-amber-500",
          cardState(data, selected),
        )}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div
              className="line-clamp-2 break-words text-sm font-medium leading-tight"
              title={data.label}
            >
              {data.label}
            </div>
          </div>
          {data.gap && (
            <AlertTriangle
              className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
              aria-label="Others depend on this team, but nothing here is mapped"
            />
          )}
        </div>
        {summary && summary.processCount === 0 && (
          <p className="text-[11px] text-muted-foreground">No processes yet</p>
        )}
        {summary && summary.processCount > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-[10px]">
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground">
              {summary.mappedCount}/{summary.processCount} mapped
            </span>
            {summary.inboundCount > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground">
                {summary.inboundCount} in
              </span>
            )}
            {summary.outboundCount > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground">
                {summary.outboundCount} out
              </span>
            )}
            {summary.unownedCount > 0 && summary.processCount > 0 && (
              <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-700 dark:text-amber-400">
                {summary.unownedCount} unowned
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function FirmProcessNode({ data, selected }: NodeProps<FirmFlowNode>) {
  return (
    <>
      <Handles />
      <div
        className={cn(
          CARD_BASE,
          "flex flex-col justify-between px-3 py-2",
          !data.mapped && "border-dashed bg-card/60",
          cardState(data, selected),
        )}
      >
        <div className="flex items-start gap-1.5">
          <div
            className={cn(
              "line-clamp-2 min-w-0 flex-1 break-words text-[13px] font-medium leading-tight",
              !data.mapped && "text-muted-foreground",
            )}
            title={data.label}
          >
            {data.label}
          </div>
          {data.resolving && (
            <Loader2
              className="h-3 w-3 shrink-0 animate-spin text-muted-foreground"
              aria-label="Reading handoffs"
            />
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
          {data.owner ? (
            <span className="inline-flex min-w-0 items-center gap-0.5">
              <UserRound className="h-2.5 w-2.5 shrink-0" aria-hidden />
              <span className="truncate">{data.owner}</span>
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-amber-700 dark:text-amber-400">
              <UserRound className="h-2.5 w-2.5" aria-hidden />
              No owner
            </span>
          )}
          {data.topRole && (
            <span className="inline-flex min-w-0 items-center gap-0.5">
              <Users className="h-2.5 w-2.5 shrink-0" aria-hidden />
              <span className="truncate">{data.topRole}</span>
            </span>
          )}
          {!data.mapped && !data.resolving && (
            <span className="shrink-0">Not mapped</span>
          )}
        </div>
      </div>
    </>
  );
}

function FirmExternalNode({ data, selected }: NodeProps<FirmFlowNode>) {
  return (
    <>
      <Handles />
      <div
        className={cn(
          CARD_BASE,
          "flex items-center gap-2 rounded-full border-sky-500/30 px-3",
          cardState(data, selected),
        )}
      >
        <Globe
          className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400"
          aria-hidden
        />
        <span className="truncate text-xs font-medium" title={data.label}>
          {data.label}
        </span>
      </div>
    </>
  );
}

export const firmNodeTypes = {
  container: memo(FirmContainerNode),
  department: memo(FirmDepartmentNode),
  process: memo(FirmProcessNode),
  external: memo(FirmExternalNode),
} as const;

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

function FirmEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerStart,
  markerEnd,
  data,
}: EdgeProps<FirmFlowEdge>) {
  if (!data) return null;
  const route = data.route;
  let path: string;
  let labelBox: { x: number; y: number; width?: number };
  if (route && route.points.length >= 2) {
    // ELK's own route: it was laid out around the cards and the labels.
    path = roundedOrthogonalPath(route.points);
    if (route.label) {
      labelBox = route.label;
    } else {
      // A big map lays out without labels; a focused edge still gets one, at
      // the middle of its route.
      const middle = route.points[Math.floor(route.points.length / 2)];
      const before = route.points[Math.floor(route.points.length / 2) - 1];
      labelBox = {
        x: (middle.x + before.x) / 2,
        y: (middle.y + before.y) / 2 - FIRM_EDGE_LABEL_HEIGHT / 2,
      };
    }
  } else {
    // No route means the layout ran without edges (see layoutFirmGraph).
    const [bezier, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
    });
    path = bezier;
    labelBox = { x: labelX, y: labelY - FIRM_EDGE_LABEL_HEIGHT / 2 };
  }
  const width = 1.25 + Math.min(data.linkCount, 6) * 0.45;
  const stroke = data.highlighted
    ? "var(--org-accent)"
    : "var(--color-muted-foreground)";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={16}
        style={{
          stroke,
          strokeWidth: data.highlighted ? width + 0.5 : width,
          strokeDasharray: data.proposed ? "6 4" : undefined,
          opacity: data.dimmed ? 0.12 : data.highlighted ? 0.95 : 0.45,
          transition: "opacity 200ms, stroke 200ms",
        }}
      />
      {data.showLabel && !data.dimmed && data.labelText && (
        <EdgeLabelRenderer>
          <div
            className={cn(
              "nodrag nopan pointer-events-none absolute flex items-center justify-center whitespace-nowrap rounded-md border bg-background px-1.5 text-[10px] font-medium leading-none shadow-sm",
              data.highlighted
                ? "border-org-accent-border text-foreground"
                : "border-border text-muted-foreground",
            )}
            style={{
              height: FIRM_EDGE_LABEL_HEIGHT,
              // ELK reserved exactly this box; without one, centre on the point.
              ...(labelBox.width !== undefined
                ? {
                    width: labelBox.width,
                    transform: `translate(${labelBox.x}px, ${labelBox.y}px)`,
                  }
                : {
                    transform: `translate(-50%, 0) translate(${labelBox.x}px, ${labelBox.y}px)`,
                  }),
            }}
          >
            {data.labelText}
            {data.corroborated && (
              <span className="ml-1 text-org-accent" title="Both sides describe this handoff">
                ⇄
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const firmEdgeTypes = {
  firm: memo(FirmEdgeComponent),
} as const;

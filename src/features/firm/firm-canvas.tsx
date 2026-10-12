"use client";

import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import type { ELK } from "elkjs/lib/elk-api";
import { Loader2, Maximize, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  buildFirmGraph,
  entityIdOf,
  firmStats,
  focusNeighborhood,
  summarizeDepartment,
  type FirmGraph,
  type FirmLevel,
  type FirmModel,
} from "./firm-graph";
import {
  firmEdgeLabelText,
  layoutFirmGraph,
  type FirmLayoutResult,
} from "./firm-layout";
import {
  firmEdgeTypes,
  firmNodeTypes,
  type FirmFlowEdge,
  type FirmFlowNode,
} from "./firm-nodes";

export type FirmSelection =
  | { type: "node"; id: string }
  | { type: "edge"; id: string }
  | null;

type FirmCanvasProps = {
  model: FirmModel;
  level: FirmLevel;
  selection: FirmSelection;
  onSelect: (selection: FirmSelection) => void;
};

/**
 * Edge labels are drawn for every edge only on maps small enough to read.
 * Decided per graph, not per selection, because ELK reserves room for the
 * labels it is given — focusing an edge must not re-run the layout.
 */
const ALWAYS_LABEL_EDGE_LIMIT = 30;

function labelsAlwaysShown(graph: FirmGraph): boolean {
  return graph.edges.length <= ALWAYS_LABEL_EDGE_LIMIT;
}

// One ELK per tab, loaded on first use: it is ~1.5 MB and only this page
// needs it.
let elkPromise: Promise<ELK> | null = null;
function loadElk(): Promise<ELK> {
  elkPromise ??= import("elkjs/lib/elk.bundled.js").then(
    ({ default: ElkConstructor }) => new ElkConstructor(),
  );
  return elkPromise;
}

function useFirmLayout(graph: FirmGraph) {
  const [result, setResult] = useState<{
    graph: FirmGraph;
    layout: FirmLayoutResult;
  } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadElk()
      .then((elk) =>
        layoutFirmGraph(graph, elk, {
          withLabels: labelsAlwaysShown(graph),
        }),
      )
      .then((layout) => {
        if (cancelled) return;
        setResult({ graph, layout });
        setError(false);
      })
      .catch((layoutError) => {
        console.error("Firm view layout failed", layoutError);
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [graph]);

  // The previous layout stays on screen while a new one is computed, so a
  // reactive update never flashes the canvas blank.
  return { result, pending: result?.graph !== graph && !error, error };
}

function FirmCanvasInner({
  model,
  level,
  selection,
  onSelect,
}: FirmCanvasProps) {
  const isMobile = useIsMobile();
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const graph = useMemo(() => buildFirmGraph(model, level), [model, level]);
  const { result, pending, error } = useFirmLayout(graph);
  const gapDepartments = useMemo(
    () => new Set(firmStats(model).gaps.map((gap) => gap.departmentId)),
    [model],
  );

  const laidOut = result?.graph;
  const focus = useMemo(() => {
    if (!laidOut || !selection) return null;
    if (selection.type === "node") {
      return focusNeighborhood(laidOut, selection.id);
    }
    const edge = laidOut.edges.find((e) => e.id === selection.id);
    if (!edge) return null;
    return {
      nodeIds: new Set([edge.source, edge.target]),
      edgeIds: new Set([edge.id]),
    };
  }, [laidOut, selection]);

  const nodes = useMemo<FirmFlowNode[]>(() => {
    if (!result) return [];
    const { graph: current, layout } = result;
    const childCount = new Map<string, number>();
    for (const node of current.nodes) {
      if (node.parentId) {
        childCount.set(node.parentId, (childCount.get(node.parentId) ?? 0) + 1);
      }
    }
    return current.nodes.flatMap((node): FirmFlowNode[] => {
      const box = layout.boxes.get(node.id);
      if (!box) return [];
      const process =
        node.kind === "process"
          ? model.processById.get(entityIdOf(node.id))
          : undefined;
      const isDepartment = node.kind === "department";
      return [
        {
          id: node.id,
          type: node.container ? "container" : node.kind,
          position: { x: box.x, y: box.y },
          parentId: node.parentId,
          style: { width: box.width, height: box.height },
          draggable: false,
          connectable: false,
          selected: selection?.type === "node" && selection.id === node.id,
          data: {
            kind: node.kind,
            label: node.label,
            focused: focus?.nodeIds.has(node.id) ?? false,
            dimmed:
              focus !== null && !node.container && !focus.nodeIds.has(node.id),
            gap: isDepartment && gapDepartments.has(entityIdOf(node.id)),
            summary:
              isDepartment && !node.container
                ? summarizeDepartment(model, entityIdOf(node.id))
                : undefined,
            owner: process?.owner?.name ?? null,
            topRole: process?.roles[0]?.name ?? null,
            mapped: process?.mapped,
            resolving:
              process?.resolutionStatus === "queued" ||
              process?.resolutionStatus === "resolving",
            childCount: childCount.get(node.id) ?? 0,
          },
        },
      ];
    });
  }, [result, model, selection, focus, gapDepartments]);

  const edges = useMemo<FirmFlowEdge[]>(() => {
    if (!result) return [];
    const showAll = labelsAlwaysShown(result.graph);
    return result.graph.edges.map((edge) => {
      const highlighted = focus?.edgeIds.has(edge.id) ?? false;
      const marker = {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color: highlighted
          ? "var(--org-accent)"
          : "var(--color-muted-foreground)",
      };
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "firm",
        selected: selection?.type === "edge" && selection.id === edge.id,
        markerEnd: marker,
        markerStart: edge.bidirectional ? marker : undefined,
        data: {
          route: result.layout.routes.get(edge.id),
          labelText: firmEdgeLabelText(edge),
          linkCount: edge.links.length,
          corroborated: edge.corroborated,
          confidence: edge.confidence,
          proposed: edge.proposed,
          highlighted,
          dimmed: focus !== null && !highlighted,
          showLabel: showAll || highlighted,
        },
      };
    });
  }, [result, focus, selection]);

  // Frame the map whenever its shape changes — new level, new links — but not
  // when only the selection moves.
  const framedLayout = useRef<FirmLayoutResult | null>(null);
  useEffect(() => {
    if (!result || framedLayout.current === result.layout) return;
    framedLayout.current = result.layout;
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.08, maxZoom: 1, duration: 300 });
    });
    return () => cancelAnimationFrame(frame);
  }, [result, fitView]);

  if (error && !result) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        The map could not be drawn. Refresh the page to try again.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={firmNodeTypes}
        edgeTypes={firmEdgeTypes}
        onNodeClick={(_, node) => onSelect({ type: "node", id: node.id })}
        onEdgeClick={(_, edge) => onSelect({ type: "edge", id: edge.id })}
        onPaneClick={() => onSelect(null)}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable
        edgesFocusable
        edgesReconnectable={false}
        deleteKeyCode={null}
        panOnDrag
        zoomOnScroll={!isMobile}
        zoomOnPinch
        selectNodesOnDrag={false}
        proOptions={{ hideAttribution: true }}
        aria-label="Firm view: every function, department, process and handoff"
      >
        <Background
          gap={24}
          size={0.75}
          color="var(--color-border)"
          className="!bg-background opacity-55"
        />
        {!isMobile && (
          <MiniMap
            style={{ width: 160, height: 104 }}
            bgColor="var(--color-card)"
            maskStrokeColor="var(--org-accent)"
            nodeColor={(node) =>
              node.type === "container"
                ? "transparent"
                : "var(--color-muted-foreground)"
            }
            nodeStrokeColor={(node) =>
              node.type === "container" ? "var(--color-border)" : "transparent"
            }
            pannable
            zoomable
          />
        )}
        <Panel position="bottom-left" className="!m-3">
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-background/95 p-0.5 shadow-sm">
            <CanvasButton label="Zoom out" onClick={() => void zoomOut()}>
              <Minus className="h-4 w-4" />
            </CanvasButton>
            <CanvasButton label="Zoom in" onClick={() => void zoomIn()}>
              <Plus className="h-4 w-4" />
            </CanvasButton>
            <CanvasButton
              label="Fit map"
              onClick={() =>
                void fitView({ padding: 0.08, maxZoom: 1, duration: 300 })
              }
            >
              <Maximize className="h-4 w-4" />
            </CanvasButton>
          </div>
        </Panel>
      </ReactFlow>
      {(pending || !result) && (
        <div className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-background/95 px-2.5 py-1 text-xs text-muted-foreground shadow-sm">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Laying out the map…
        </div>
      )}
    </div>
  );
}

function CanvasButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function FirmCanvas(props: FirmCanvasProps) {
  return (
    <ReactFlowProvider>
      <FirmCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

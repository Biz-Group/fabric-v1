"use client";

import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Loader2,
  Network,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { useWorkspaceRoutes } from "@/features/shell/use-workspace-routes";
import { buildSelectionQuery } from "@/features/workbench/use-selection-params";
import {
  buildFirmGraph,
  buildFirmModel,
  deptNodeId,
  entityIdOf,
  firmStats,
  nodeKind,
  type FirmLevel,
  type FirmStats,
} from "./firm-graph";
import type { FirmSelection } from "./firm-canvas";
import { FirmDetailPanel, processSelection } from "./firm-detail-panel";

const FirmCanvas = lazy(() => import("./firm-canvas"));

export function FirmView() {
  const data = useQuery(api.firmMap.getFirmMap);
  const ownerCandidates = useQuery(
    api.firmMap.listOwnerCandidates,
    data?.canManage ? {} : "skip",
  );
  const requestBuild = useMutation(api.firmMap.requestFirmMapBuild);
  const setProcessOwner = useMutation(api.firmMap.setProcessOwner);
  const routes = useWorkspaceRoutes();
  const isMobile = useIsMobile();

  const [level, setLevelState] = useState<FirmLevel>("department");
  const [selection, setSelection] = useState<FirmSelection>(null);
  const [building, setBuilding] = useState(false);

  const model = useMemo(() => (data ? buildFirmModel(data) : null), [data]);
  const stats = useMemo(() => (model ? firmStats(model) : null), [model]);
  const graph = useMemo(
    () => (model ? buildFirmGraph(model, level) : null),
    [model, level],
  );
  const gapIds = useMemo(
    () => new Set(stats?.gaps.map((gap) => gap.departmentId) ?? []),
    [stats],
  );

  const setLevel = useCallback(
    (next: FirmLevel) => {
      setLevelState(next);
      setSelection((current) => {
        if (!current || current.type === "edge") return null;
        // A process has no card of its own at department level; keep its
        // department in focus instead of dropping the selection.
        if (next === "department" && nodeKind(current.id) === "process") {
          const process = model?.processById.get(entityIdOf(current.id));
          return process
            ? { type: "node", id: deptNodeId(process.departmentId) }
            : null;
        }
        return current;
      });
    },
    [model],
  );

  const selectNode = useCallback(
    (nodeId: string) => {
      if (nodeKind(nodeId) === "process" && level === "department") {
        setLevelState("process");
      }
      setSelection({ type: "node", id: nodeId });
    },
    [level],
  );

  const processHref = useCallback(
    (processId: string, nodeId?: string) => {
      const path = model ? processSelection(model, processId) : null;
      if (!path) return routes.withWorkspacePath("/");
      const query = buildSelectionQuery(new URLSearchParams(), {
        fn: path.fn as Id<"functions">,
        dept: path.dept as Id<"departments">,
        proc: path.proc as Id<"processes">,
        tab: 2,
        node: nodeId ?? null,
      });
      return `${routes.withWorkspacePath("/")}?${query}`;
    },
    [model, routes],
  );

  const handleBuild = async (force: boolean) => {
    setBuilding(true);
    try {
      await requestBuild({ force });
      toast.success(
        force
          ? "Rebuilding the firm map from every mapped process."
          : "Building the firm map. Handoffs appear as each process is read.",
      );
    } catch {
      toast.error("We could not start building the firm map. Please try again.");
    } finally {
      setBuilding(false);
    }
  };

  const handleSetOwner = async (
    processId: Id<"processes">,
    ownerMembershipId: Id<"memberships"> | null,
  ) => {
    try {
      await setProcessOwner({ processId, ownerMembershipId });
    } catch {
      toast.error("We could not update the owner. Please try again.");
    }
  };

  if (data === undefined || !model || !stats || !graph) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2
          className="h-6 w-6 animate-spin text-muted-foreground"
          aria-label="Loading the firm view"
        />
      </div>
    );
  }

  if (data.functions.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          icon={Network}
          title="Nothing to map yet"
          description="Add your functions, departments and processes, then interview the people who run them. The firm view draws itself from what they describe."
          action={
            <Button render={<a href={routes.appHref} />} variant="outline">
              Go to processes
            </Button>
          }
          className="max-w-md"
        />
      </div>
    );
  }

  const selectedEdge =
    selection?.type === "edge"
      ? graph.edges.find((edge) => edge.id === selection.id)
      : undefined;
  const panelOpen =
    (selection?.type === "node" &&
      graph.nodes.some((node) => node.id === selection.id)) ||
    selectedEdge !== undefined;

  const panel = panelOpen ? (
    <FirmDetailPanel
      model={model}
      nodeId={selection?.type === "node" ? selection.id : undefined}
      edge={selectedEdge}
      isGap={(departmentId) => gapIds.has(departmentId)}
      onClose={() => setSelection(null)}
      onSelectNode={selectNode}
      processHref={processHref}
      ownerCandidates={data.canManage ? ownerCandidates : undefined}
      onSetOwner={data.canManage ? handleSetOwner : undefined}
    />
  ) : null;

  const inFlight = data.resolution.queued + data.resolution.resolving;
  const neverBuilt =
    inFlight + data.resolution.ready + data.resolution.failed === 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <FirmHeader
        stats={stats}
        level={level}
        onLevelChange={setLevel}
        canManage={data.canManage}
        inFlight={inFlight}
        failed={data.resolution.failed}
        neverBuilt={neverBuilt}
        building={building}
        onBuild={handleBuild}
        onSelectGap={(departmentId) => selectNode(deptNodeId(departmentId))}
        truncated={data.truncated.processes || data.truncated.links}
      />
      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <FirmCanvas
              model={model}
              level={level}
              selection={selection}
              onSelect={(next) =>
                next?.type === "node" ? selectNode(next.id) : setSelection(next)
              }
            />
          </Suspense>
        </div>
        {!isMobile && panel && (
          <aside className="w-[380px] shrink-0 border-l border-border">
            {panel}
          </aside>
        )}
      </div>
      {isMobile && (
        <Sheet
          open={panel !== null}
          onOpenChange={(open) => {
            if (!open) setSelection(null);
          }}
        >
          <SheetContent
            side="bottom"
            className="h-[70vh] p-0"
            showCloseButton={false}
          >
            <SheetTitle className="sr-only">Details</SheetTitle>
            {panel}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

function FirmHeader({
  stats,
  level,
  onLevelChange,
  canManage,
  inFlight,
  failed,
  neverBuilt,
  building,
  onBuild,
  onSelectGap,
  truncated,
}: {
  stats: FirmStats;
  level: FirmLevel;
  onLevelChange: (level: FirmLevel) => void;
  canManage: boolean;
  inFlight: number;
  failed: number;
  neverBuilt: boolean;
  building: boolean;
  onBuild: (force: boolean) => void;
  onSelectGap: (departmentId: string) => void;
  truncated: boolean;
}) {
  const figures: Array<{ label: string; value: string; warn?: boolean }> = [
    {
      label: "processes mapped",
      value: `${stats.mappedCount} of ${stats.processCount}`,
    },
    { label: "handoffs", value: String(stats.handoffCount) },
    { label: "cross-department", value: String(stats.crossDepartmentCount) },
    { label: "outside parties", value: String(stats.externalCount) },
    {
      label: "without an owner",
      value: String(stats.unownedCount),
      warn: stats.unownedCount > 0,
    },
  ];

  return (
    <div className="space-y-3 border-b border-border px-4 py-3 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          {figures.map((figure) => (
            <div key={figure.label} className="flex items-baseline gap-1.5">
              <dt className="sr-only">{figure.label}</dt>
              <dd
                className={cn(
                  "text-lg font-semibold tabular-nums",
                  figure.warn && "text-amber-700 dark:text-amber-400",
                )}
              >
                {figure.value}
              </dd>
              <span aria-hidden className="text-xs text-muted-foreground">
                {figure.label}
              </span>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Level of detail"
            className="flex items-center rounded-lg border border-border p-0.5"
          >
            {(["department", "process"] as const).map((option) => (
              <Button
                key={option}
                role="radio"
                aria-checked={level === option}
                variant={level === option ? "secondary" : "ghost"}
                size="xs"
                onClick={() => onLevelChange(option)}
              >
                {option === "department" ? "Departments" : "Processes"}
              </Button>
            ))}
          </div>
          {canManage && (
            <Button
              variant={neverBuilt ? "default" : "outline"}
              size="sm"
              disabled={building || inFlight > 0}
              onClick={() => onBuild(!neverBuilt && failed === 0)}
            >
              {inFlight > 0 ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : neverBuilt ? (
                <Sparkles className="h-3.5 w-3.5" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {inFlight > 0
                ? `Reading ${inFlight} ${inFlight === 1 ? "process" : "processes"}…`
                : neverBuilt
                  ? "Build firm map"
                  : failed > 0
                    ? `Retry ${failed} failed`
                    : "Rebuild"}
            </Button>
          )}
        </div>
      </div>

      {neverBuilt && (
        <p className="text-sm text-muted-foreground">
          {canManage
            ? "This is your organisation's structure. Build the firm map to read every handoff your teams have described in interviews and draw it here, with the evidence behind it."
            : "This is your organisation's structure. Handoffs appear here as processes are mapped."}
        </p>
      )}

      {stats.gaps.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="inline-flex items-center gap-1 font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            Others depend on these teams, but nothing there is mapped:
          </span>
          {stats.gaps.slice(0, 6).map((gap) => (
            <button
              key={gap.departmentId}
              type="button"
              onClick={() => onSelectGap(gap.departmentId)}
              className="org-focus-ring rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-800 hover:bg-amber-500/20 dark:text-amber-300"
            >
              {gap.name} · {gap.inboundCount}
            </button>
          ))}
        </div>
      )}

      {truncated && (
        <p className="text-xs text-muted-foreground" role="status">
          This organisation is larger than the map can show at once; some
          processes or links are not drawn.
        </p>
      )}
    </div>
  );
}

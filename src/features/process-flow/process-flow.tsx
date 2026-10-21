"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  Panel,
  ViewportPortal,
  useReactFlow,
  useViewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery } from "convex/react";
import { useAction } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  GitBranch,
  AlertCircle,
  Maximize2,
  Minimize2,
  Sparkles,
  RefreshCw,
  BarChart3,
  Bot,
  ArrowRightLeft,
  Wrench,
  Clock,
  AlertTriangle,
  Minus,
  Plus,
  Scan,
  LocateFixed,
  Map as MapIcon,
  MapPinned,
  ArrowRight,
  ArrowDown,
  Network,
  UsersRound,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { SectionLabel } from "@/components/ui/section-label";
import { LoadingState, Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  flowDetailProgress,
  flowStage,
  hasRetainedPreviousFlow,
} from "@/lib/flow-status";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { nodeTypes } from "./process-flow-nodes";
import { edgeTypes } from "./process-flow-edges";
import { deriveFlowFocus, type FlowFocus } from "./flow-focus";
import { useProcessFlowLayout } from "@/features/process-flow/use-process-flow-layout";
import { ProcessFlowDetailPanel } from "./process-flow-detail-panel";
import { resolveFlowNodeId } from "./flow-navigation";
import {
  resolveEntryViewportTransform,
  resolveFlowEntryNodeId,
} from "./flow-viewport";
import {
  resolveFreshFlowSourceConversations,
  type FlowConversationForSources,
} from "./flow-sources";
import {
  deriveFlowSpotlights,
  type FlowSpotlight,
  type FlowSpotlightMap,
  type FlowSpotlightMode,
} from "./flow-spotlight";
import { useFlowViewPreferences } from "./flow-view-preferences";
import {
  FLOW_NODE_WIDTH,
  flowNodeHeight,
  toggleOwnerGrouping,
  type FlowDirection,
  type FlowGrouping,
  type FlowLayoutLane,
} from "./flow-layout";
import {
  isFlowNavigationKey,
  resolveConnectedNodeInDirection,
} from "./flow-keyboard-navigation";
import hoverStyles from "./process-flow-hover.module.css";
import {
  noConversationsMessage,
  type PendingConversationCounts,
} from "./pending-conversations";

const DETAIL_PANEL_MIN_WIDTH = 288;
const DETAIL_PANEL_DEFAULT_WIDTH = 320;
const DETAIL_PANEL_MAX_WIDTH = 480;

const POPUP_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * Whether a key event comes from inside an open menu, dialog or sheet, which
 * owns its own Escape. A popup that wraps the flow itself doesn't count.
 */
function isInsideOtherPopup(target: EventTarget | null, flow: Element | null) {
  if (!(target instanceof Element)) return false;
  const popup = target.closest(POPUP_SELECTOR);
  return popup !== null && !(flow && popup.contains(flow));
}

interface ProcessFlowProps {
  processId: Id<"processes">;
  conversationCount: number;
  /** Contributions not yet usable: still processing, or awaiting labels. */
  pendingConversations: PendingConversationCounts;
  /** Contributors and admins can generate, refresh and retry; viewers can't. */
  canEdit: boolean;
  selectedNodeId: string | null;
  onSelectedNodeChange: (nodeId: string | null) => void;
  onOpenConversation: (conversationId: Id<"conversations">) => void;
  onOpenInsights: () => void;
  conversations: FlowConversationForSources[];
}

function ProcessFlowInner({
  processId,
  conversationCount,
  pendingConversations,
  canEdit,
  selectedNodeId,
  onSelectedNodeChange,
  onOpenConversation,
  onOpenInsights,
  conversations,
}: ProcessFlowProps) {
  const isMobile = useIsMobile();
  const flow = useQuery(api.processFlows.getProcessFlow, { processId });
  const generateFlow = useAction(api.processFlows.generateProcessFlow);
  const retryNodeDetail = useAction(api.processFlows.retryNodeDetail);
  const reduceMotion = useReducedMotion();
  const [viewPreferences, setViewPreferences] = useFlowViewPreferences();
  const [retryingNodeId, setRetryingNodeId] = useState<string | null>(null);
  const [spotlightState, setSpotlightState] = useState<{
    processId: Id<"processes">;
    mode: FlowSpotlightMode;
  } | null>(null);
  const spotlights = useMemo(
    () => (flow ? deriveFlowSpotlights(flow) : null),
    [flow],
  );
  const storedSpotlightMode =
    spotlightState?.processId === processId ? spotlightState.mode : null;
  const storedSpotlight =
    storedSpotlightMode && spotlights ? spotlights[storedSpotlightMode] : null;
  const activeSpotlight =
    storedSpotlight && storedSpotlight.nodeIds.size > 0
      ? storedSpotlight
      : null;
  const activeSpotlightMode = activeSpotlight?.mode ?? null;
  const { nodes, edges, lanes } = useProcessFlowLayout(
    flow,
    selectedNodeId,
    reduceMotion ?? false,
    activeSpotlight,
    viewPreferences.direction,
    viewPreferences.grouping,
  );
  const {
    fitView,
    getZoom,
    setCenter,
    setViewport,
    viewportInitialized,
    zoomIn,
    zoomOut,
  } = useReactFlow();
  const { zoom } = useViewport();

  const [isGenerating, setIsGenerating] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showMinimap, setShowMinimap] = useState(true);
  const [detailPanelWidth, setDetailPanelWidth] = useState(
    DETAIL_PANEL_DEFAULT_WIDTH,
  );
  const [viewerWidth, setViewerWidth] = useState(0);
  const [keyboardAnnouncement, setKeyboardAnnouncement] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const lastInitialFrameKey = useRef<string | null>(null);
  const lastSelectionFrameKey = useRef<string | null>(null);
  const spotlightFitTimeout = useRef<number | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const fullscreenToggleRef = useRef<HTMLButtonElement | null>(null);
  const wasFullscreen = useRef(isFullscreen);

  const maxDetailPanelWidth =
    viewerWidth > 0
      ? Math.max(
          DETAIL_PANEL_MIN_WIDTH,
          Math.min(
            DETAIL_PANEL_MAX_WIDTH,
            viewerWidth * 0.46,
            viewerWidth - 360,
          ),
        )
      : DETAIL_PANEL_MAX_WIDTH;
  const effectiveDetailPanelWidth = Math.min(
    detailPanelWidth,
    maxDetailPanelWidth,
  );

  const clearTransientHover = useCallback(() => {
    const root = canvasRef.current;
    if (!root) return;
    for (const element of root.querySelectorAll(
      `.${hoverStyles.nodeActive}, .${hoverStyles.edgeActive}`,
    )) {
      element.classList.remove(hoverStyles.nodeActive, hoverStyles.edgeActive);
    }
  }, []);

  const applyTransientHover = useCallback(
    (focus: FlowFocus) => {
      const root = canvasRef.current;
      if (!root) return;
      clearTransientHover();

      for (const element of root.querySelectorAll<HTMLElement>(
        ".react-flow__node[data-id]",
      )) {
        if (focus.nodeIds.has(element.dataset.id ?? "")) {
          element.classList.add(hoverStyles.nodeActive);
        }
      }
      for (const element of root.querySelectorAll<SVGElement>(
        ".react-flow__edge[data-id]",
      )) {
        if (focus.edgeIds.has(element.dataset.id ?? "")) {
          element.classList.add(hoverStyles.edgeActive);
        }
      }
    },
    [clearTransientHover],
  );

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const updateWidth = () => {
      setViewerWidth(Math.round(viewer.getBoundingClientRect().width));
    };
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewer);
    return () => observer.disconnect();
  }, [flow?.status]);

  const focusFlowNode = useCallback((nodeId: string) => {
    window.requestAnimationFrame(() => {
      const nodeElement = Array.from(
        canvasRef.current?.querySelectorAll<HTMLElement>(
          ".react-flow__node[data-id]",
        ) ?? [],
      ).find((element) => element.dataset.id === nodeId);
      nodeElement?.focus({ preventScroll: true });
    });
  }, []);

  const selectedFlowNode = selectedNodeId
    ? (flow?.nodes.find((n) => n.id === selectedNodeId) ?? null)
    : null;
  const selectedNode = selectedFlowNode
    ? {
        ...selectedFlowNode,
        sourceConversations: resolveFreshFlowSourceConversations(
          selectedFlowNode.sources,
          {
            stale: flow?.stale ?? true,
            conversationCount: flow?.conversationCount ?? 0,
          },
          conversations,
        ),
      }
    : null;

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setActionError(null);
    try {
      await generateFlow({ processId });
    } catch {
      setActionError("Failed to start flow generation. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  }, [generateFlow, processId]);

  const handleRetryNodeDetail = useCallback(
    async (nodeId: string) => {
      setRetryingNodeId(nodeId);
      setActionError(null);
      try {
        await retryNodeDetail({ processId, nodeId });
      } catch {
        setActionError("Could not retry this step. Please try again.");
      } finally {
        // The node's own status carries the spinner from here; this only covers
        // the round trip that queues the work.
        setRetryingNodeId(null);
      }
    },
    [processId, retryNodeDetail],
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: { id: string }) => {
      clearTransientHover();
      onSelectedNodeChange(selectedNodeId === node.id ? null : node.id);
    },
    [clearTransientHover, onSelectedNodeChange, selectedNodeId],
  );

  const handlePaneClick = useCallback(() => {
    clearTransientHover();
    onSelectedNodeChange(null);
  }, [clearTransientHover, onSelectedNodeChange]);

  const handleCloseDetails = useCallback(() => {
    const nodeId = selectedNodeId;
    clearTransientHover();
    onSelectedNodeChange(null);
    if (!nodeId) return;

    window.setTimeout(() => focusFlowNode(nodeId), reduceMotion ? 0 : 180);
  }, [
    clearTransientHover,
    focusFlowNode,
    onSelectedNodeChange,
    reduceMotion,
    selectedNodeId,
  ]);

  const handleNodeMouseEnter = useCallback(
    (_event: React.MouseEvent, node: { id: string }) => {
      applyTransientHover(
        deriveFlowFocus({
          edges: flow?.edges ?? [],
          hoveredNodeId: node.id,
        }),
      );
    },
    [applyTransientHover, flow?.edges],
  );

  const handleNodeMouseLeave = useCallback(() => {
    clearTransientHover();
  }, [clearTransientHover]);

  const handleEdgeMouseEnter = useCallback(
    (_event: React.MouseEvent, edge: { id: string }) => {
      applyTransientHover(
        deriveFlowFocus({
          edges: flow?.edges ?? [],
          hoveredEdgeId: edge.id,
        }),
      );
    },
    [applyTransientHover, flow?.edges],
  );

  const handleEdgeMouseLeave = useCallback(() => {
    clearTransientHover();
  }, [clearTransientHover]);

  const handleNavigateToNode = useCallback(
    (nodeId: string) => {
      onSelectedNodeChange(nodeId);
    },
    [onSelectedNodeChange],
  );

  const isStale = flow?.status === "ready" && flow.stale;
  const hasNewerConversations =
    flow?.status === "ready" && conversationCount > flow.conversationCount;

  // Detail generation updates node descriptions in-place. Keeping the
  // viewport keyed to topology means those content/status updates no longer
  // pull the user back to a fit-all view while they are reading the graph.
  const topologyKey = useMemo(() => {
    if (!flow) return `${processId}:empty`;
    const nodeKey = flow.nodes
      .map((node) => `${node.id}:${node.category}`)
      .join("|");
    const edgeKey = flow.edges
      .map((edge) => `${edge.source}>${edge.target}`)
      .join("|");
    return `${processId}:${flow.generatedAt}:${nodeKey}:${edgeKey}`;
  }, [flow, processId]);
  const entryNodeId = resolveFlowEntryNodeId(nodes, edges);
  const entryNode = entryNodeId
    ? nodes.find((node) => node.id === entryNodeId)
    : undefined;
  // Keep the load-framing effect tied to stable geometry primitives. Detail
  // descriptions can stream in after topology, but must not cancel framing.
  const entryNodeX = entryNode?.position.x;
  const entryNodeY = entryNode?.position.y;
  const entryNodeCategory = entryNode?.data.category;

  const viewportDuration = reduceMotion ? 0 : 250;
  const centerNode = useCallback(
    (nodeId: string, minimumZoom = 0.9) => {
      const targetNode = nodes.find((node) => node.id === nodeId);
      if (!targetNode) return;

      const nodeHeight = targetNode.data.category === "decision" ? 100 : 120;
      void setCenter(
        targetNode.position.x + 140,
        targetNode.position.y + nodeHeight / 2,
        {
          zoom: Math.max(getZoom(), minimumZoom),
          duration: viewportDuration,
        },
      );
    },
    [getZoom, nodes, setCenter, viewportDuration],
  );

  const handleFitAll = useCallback(() => {
    void fitView({
      padding: 0.16,
      maxZoom: 1,
      duration: viewportDuration,
    });
  }, [fitView, viewportDuration]);

  const handleCenterSelected = useCallback(() => {
    if (selectedNodeId) centerNode(selectedNodeId);
  }, [centerNode, selectedNodeId]);

  const handleFlowKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;

      if (event.key === "Escape") {
        // Portaled popups (the step sheet, the layout menu) still bubble
        // through the viewer in React; they close themselves first.
        if (
          !(event.target instanceof Node) ||
          !viewerRef.current?.contains(event.target)
        )
          return;
        clearTransientHover();
        if (selectedNodeId) {
          event.preventDefault();
          event.stopPropagation();
          handleCloseDetails();
          setKeyboardAnnouncement("Step details closed.");
        }
        // Otherwise it bubbles on, and leaves fullscreen if that's open.
        return;
      }

      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const nodeElement = target.closest<HTMLElement>(
        ".react-flow__node[data-id]",
      );
      if (!nodeElement || !canvasRef.current?.contains(nodeElement)) return;

      const currentNodeId = nodeElement.dataset.id;
      if (!currentNodeId) return;

      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        clearTransientHover();
        onSelectedNodeChange(currentNodeId);
        const nodeLabel = nodes.find((node) => node.id === currentNodeId)?.data
          .label;
        setKeyboardAnnouncement(
          nodeLabel
            ? `Opened details for ${nodeLabel}.`
            : "Step details opened.",
        );
        return;
      }

      if (!isFlowNavigationKey(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const nextNodeId = resolveConnectedNodeInDirection({
        currentNodeId,
        key: event.key,
        nodes,
        edges,
      });
      if (!nextNodeId) {
        setKeyboardAnnouncement("No connected step in that direction.");
        return;
      }

      focusFlowNode(nextNodeId);
      const nextNodeLabel = nodes.find((node) => node.id === nextNodeId)?.data
        .label;
      setKeyboardAnnouncement(
        nextNodeLabel
          ? `Focused connected step ${nextNodeLabel}. Press Enter for details.`
          : "Focused connected step. Press Enter for details.",
      );
    },
    [
      clearTransientHover,
      edges,
      focusFlowNode,
      handleCloseDetails,
      nodes,
      onSelectedNodeChange,
      selectedNodeId,
    ],
  );

  // Fullscreen covers the whole workbench, so Escape leaves it wherever focus
  // is, including the insights bar or nowhere after a pane click. Step details
  // close first. Listening on window lets menus, tooltips and dialogs, which
  // handle Escape on document, claim it before this sees it.
  useEffect(() => {
    if (!isFullscreen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        isInsideOtherPopup(event.target, viewerRef.current)
      )
        return;

      event.preventDefault();
      clearTransientHover();
      if (selectedNodeId) {
        handleCloseDetails();
        setKeyboardAnnouncement("Step details closed.");
        return;
      }
      setIsFullscreen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearTransientHover, handleCloseDetails, isFullscreen, selectedNodeId]);

  // Entering or leaving fullscreen keeps focus on the toggle, wherever the
  // switch came from, so keyboard users don't land back at the page start.
  useEffect(() => {
    if (wasFullscreen.current === isFullscreen) return;
    wasFullscreen.current = isFullscreen;
    fullscreenToggleRef.current?.focus();
  }, [isFullscreen]);

  const handleDetailPanelResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = effectiveDetailPanelWidth;

      const handlePointerMove = (pointerEvent: PointerEvent) => {
        const nextWidth = Math.min(
          maxDetailPanelWidth,
          Math.max(
            DETAIL_PANEL_MIN_WIDTH,
            startWidth + startX - pointerEvent.clientX,
          ),
        );
        setDetailPanelWidth(Math.round(nextWidth));
      };
      const stopResizing = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResizing);
        window.removeEventListener("pointercancel", stopResizing);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResizing);
      window.addEventListener("pointercancel", stopResizing);
    },
    [effectiveDetailPanelWidth, maxDetailPanelWidth],
  );

  const handleDetailPanelResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      let nextWidth: number | null = null;
      if (event.key === "ArrowLeft") {
        nextWidth = effectiveDetailPanelWidth + 16;
      } else if (event.key === "ArrowRight") {
        nextWidth = effectiveDetailPanelWidth - 16;
      } else if (event.key === "Home") {
        nextWidth = DETAIL_PANEL_MIN_WIDTH;
      } else if (event.key === "End") {
        nextWidth = maxDetailPanelWidth;
      }
      if (nextWidth === null) return;

      event.preventDefault();
      event.stopPropagation();
      setDetailPanelWidth(
        Math.round(
          Math.min(
            maxDetailPanelWidth,
            Math.max(DETAIL_PANEL_MIN_WIDTH, nextWidth),
          ),
        ),
      );
    },
    [effectiveDetailPanelWidth, maxDetailPanelWidth],
  );

  const handleDirectionChange = useCallback(
    (direction: FlowDirection) => {
      if (direction === viewPreferences.direction) return;
      clearTransientHover();
      setViewPreferences({ ...viewPreferences, direction });
    },
    [clearTransientHover, setViewPreferences, viewPreferences],
  );

  const handleGroupingChange = useCallback(
    (grouping: FlowGrouping) => {
      if (grouping === viewPreferences.grouping) return;
      clearTransientHover();
      setViewPreferences({ ...viewPreferences, grouping });
    },
    [clearTransientHover, setViewPreferences, viewPreferences],
  );

  const handleSpotlightChange = useCallback(
    (mode: FlowSpotlightMode | null) => {
      if (spotlightFitTimeout.current !== null) {
        window.clearTimeout(spotlightFitTimeout.current);
        spotlightFitTimeout.current = null;
      }
      clearTransientHover();

      if (mode === null || mode === activeSpotlightMode) {
        setSpotlightState(null);
        return;
      }

      const nextSpotlight = spotlights?.[mode];
      if (!nextSpotlight || nextSpotlight.nodeIds.size === 0) return;
      setSpotlightState({ processId, mode });
      const matchingNodes = Array.from(nextSpotlight.nodeIds, (id) => ({ id }));
      // Let the active-status row settle before measuring the available canvas.
      // Clearing first cancels this callback, so clear never changes viewport.
      spotlightFitTimeout.current = window.setTimeout(() => {
        spotlightFitTimeout.current = null;
        void fitView({
          nodes: matchingNodes,
          padding: 0.3,
          maxZoom: 1.05,
          duration: viewportDuration,
        });
      }, 0);
    },
    [
      activeSpotlightMode,
      clearTransientHover,
      fitView,
      processId,
      spotlights,
      viewportDuration,
    ],
  );

  useEffect(() => () => {
    if (spotlightFitTimeout.current !== null) {
      window.clearTimeout(spotlightFitTimeout.current);
    }
  });

  useEffect(() => {
    if (
      !viewportInitialized ||
      !entryNodeId ||
      entryNodeX === undefined ||
      entryNodeY === undefined ||
      !entryNodeCategory
    )
      return;

    const frameKey = `${topologyKey}:${viewPreferences.direction}:${viewPreferences.grouping}:${isFullscreen ? "fullscreen" : "embedded"}`;
    if (selectedNodeId) {
      lastInitialFrameKey.current = frameKey;
      return;
    }
    if (lastInitialFrameKey.current === frameKey) return;

    const timeout = window.setTimeout(
      () => {
        const canvas = canvasRef.current?.getBoundingClientRect();
        if (!canvas || canvas.width <= 0 || canvas.height <= 0) return;

        lastInitialFrameKey.current = frameKey;
        void setViewport(
          resolveEntryViewportTransform({
            node: {
              position: { x: entryNodeX, y: entryNodeY },
              width: FLOW_NODE_WIDTH,
              height: flowNodeHeight(entryNodeCategory),
            },
            viewport: { width: canvas.width, height: canvas.height },
            direction: viewPreferences.direction,
          }),
          { duration: viewportDuration },
        );
      },
      isFullscreen ? 80 : 0,
    );
    return () => window.clearTimeout(timeout);
  }, [
    entryNodeCategory,
    entryNodeId,
    entryNodeX,
    entryNodeY,
    isFullscreen,
    selectedNodeId,
    setViewport,
    topologyKey,
    viewerWidth,
    viewPreferences.direction,
    viewPreferences.grouping,
    viewportInitialized,
    viewportDuration,
  ]);

  useEffect(() => {
    if (!viewportInitialized || !selectedNodeId) {
      lastSelectionFrameKey.current = null;
      return;
    }

    const resolvedNodeId = resolveFlowNodeId(nodes, selectedNodeId);
    if (!resolvedNodeId) {
      lastInitialFrameKey.current = null;
      onSelectedNodeChange(null);
      return;
    }

    const frameKey = `${topologyKey}:${viewPreferences.direction}:${viewPreferences.grouping}:${resolvedNodeId}:${isFullscreen ? "fullscreen" : "embedded"}:${isMobile ? "sheet" : effectiveDetailPanelWidth}`;
    if (lastSelectionFrameKey.current === frameKey) return;

    // The desktop canvas changes width as the detail panel opens or resizes.
    // Let the shell settle, then center inside the usable canvas beside it.
    const timeout = window.setTimeout(
      () => {
        lastSelectionFrameKey.current = frameKey;
        centerNode(resolvedNodeId);
      },
      isMobile || reduceMotion ? 0 : 220,
    );
    return () => window.clearTimeout(timeout);
  }, [
    centerNode,
    effectiveDetailPanelWidth,
    isFullscreen,
    isMobile,
    nodes,
    onSelectedNodeChange,
    reduceMotion,
    selectedNodeId,
    topologyKey,
    viewPreferences.direction,
    viewPreferences.grouping,
    viewportInitialized,
  ]);

  // Empty state: no flow generated yet
  if (flow === undefined) {
    return (
      <LoadingScreen
        fullScreen={false}
        message="Loading process flow…"
        className="min-h-0 flex-1 border-0 bg-transparent"
      />
    );
  }

  if (flow === null) {
    return (
      <FlowEmptyState
        onGenerate={canEdit ? handleGenerate : undefined}
        isGenerating={isGenerating}
        hasConversations={conversationCount > 0}
        pendingConversations={pendingConversations}
        actionError={actionError}
      />
    );
  }

  // Only the graph stage blocks. Once the topology exists there is a diagram
  // worth looking at, and each node reports its own progress — so the wait
  // happens with the process on screen instead of behind a spinner.
  const stage = flowStage(flow);
  const detailProgress = flowDetailProgress(flow);
  if (stage === "graph") {
    return (
      <LoadingState
        variant="plain"
        className="flex-1"
        title="Generating process flow…"
        description="Analyzing contributions and mapping the process structure"
      />
    );
  }

  // A failed refresh keeps whatever flow was there before, so fall through and
  // render it with a banner. Only a first-ever generation that fails has nothing
  // underneath, and that is the one case that gets the error page.
  const showingRetained = hasRetainedPreviousFlow(flow, flow.nodes.length);
  if (stage === "failed" && !showingRetained) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <div className="flex flex-col items-center gap-3">
          <AlertCircle className="size-10 text-muted-foreground/40" />
          <div className="text-center">
            <p className="text-sm font-medium">Flow generation failed</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {flow.errorMessage ?? "An unexpected error occurred."}
            </p>
          </div>
          {actionError && (
            <p
              className="max-w-sm text-center text-xs text-destructive"
              role="alert"
            >
              {actionError}
            </p>
          )}
          {canEdit && (
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={isGenerating}
              className="gap-2"
            >
              {isGenerating ? (
                <Spinner className="size-4" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Try Again
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Ready state: render the flow
  // TypeScript cannot carry the earlier null checks back into the memo that
  // derives these controls. The fallback is unreachable at runtime, but keeps
  // this render boundary honest if the query shape changes later.
  const visibleSpotlights = spotlights ?? deriveFlowSpotlights(flow);

  return (
    <TooltipProvider delay={250}>
      {/* One element for both modes: swapping wrapper components remounted the
          canvas, which reset the viewport and dropped focus from the toggle. */}
      <div
        className={
          isFullscreen
            ? "fixed inset-0 z-fullscreen flex flex-col bg-background"
            : "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        }
      >
        <div
          ref={viewerRef}
          className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
          onKeyDownCapture={handleFlowKeyDown}
        >
          {/* Detail progress. Non-blocking by design: the diagram is usable while
            the descriptions land, and this says how much is still coming so an
            unfinished step reads as unfinished rather than empty. */}
          {stage === "details" && (
            <div className="absolute top-3 left-3 right-12 z-10 md:right-auto">
              <div className="border-border bg-card/90 flex max-w-full flex-wrap items-center gap-2 rounded-lg border px-3 py-1.5 text-xs backdrop-blur-sm">
                <Spinner className="size-3 text-org-accent" />
                <span className="text-muted-foreground">
                  {detailProgress
                    ? `Describing steps — ${detailProgress.completed} of ${detailProgress.total}`
                    : "Describing steps"}
                </span>
              </div>
            </div>
          )}

          {/* A refresh that failed. Louder than the staleness banner because the
            user asked for something and did not get it — but the flow below is
            their real previous version, not a broken one. */}
          {showingRetained && (
            // The card underneath keeps the translucent dark-mode tint opaque
            // over the canvas.
            <div className="absolute top-3 left-3 right-12 z-10 rounded-lg bg-card md:right-auto">
              <div className="flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-warning-border bg-warning-subtle px-3 py-1.5 text-xs text-warning">
                <AlertCircle className="size-3 shrink-0" />
                <span>Couldn&apos;t refresh — showing the previous version</span>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-xs"
                    onClick={handleGenerate}
                    disabled={isGenerating}
                  >
                    {isGenerating ? (
                      <Spinner className="size-3" />
                    ) : (
                      <RefreshCw className="size-3" />
                    )}
                    Try Again
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Staleness banner */}
          {stage !== "details" &&
            !showingRetained &&
            (isStale || hasNewerConversations) && (
              <div className="absolute left-3 right-12 top-3 z-10 rounded-lg bg-card md:right-auto">
                <div className="flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-warning-border bg-warning-subtle px-3 py-1.5 text-xs text-warning">
                  <span>New evidence available</span>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-2 text-xs"
                      onClick={handleGenerate}
                      disabled={isGenerating}
                    >
                      {isGenerating ? (
                        <Spinner className="size-3" />
                      ) : (
                        <RefreshCw className="size-3" />
                      )}
                      Refresh
                    </Button>
                  )}
                </div>
              </div>
            )}

          {actionError && (
            <div
              className="absolute left-3 top-14 z-10 max-w-sm rounded-lg border border-destructive/30 bg-background px-3 py-2 text-xs text-destructive shadow-sm"
              role="alert"
            >
              {actionError}
            </div>
          )}

          {/* React Flow canvas. A size container, so the controls inside fit
              the canvas: full width on phones, beside the tree on desktop, and
              narrower again while the step panel is open. */}
          <div
            ref={canvasRef}
            className="@container h-full min-h-0 min-w-0 flex-1 transition-[margin-right] duration-200 ease-out motion-reduce:transition-none"
            style={
              !isMobile
                ? {
                    marginRight: selectedNode ? effectiveDetailPanelWidth : 0,
                  }
                : undefined
            }
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={handleNodeClick}
              onNodeMouseEnter={handleNodeMouseEnter}
              onNodeMouseLeave={handleNodeMouseLeave}
              onEdgeMouseEnter={handleEdgeMouseEnter}
              onEdgeMouseLeave={handleEdgeMouseLeave}
              onPaneClick={handlePaneClick}
              minZoom={0.3}
              maxZoom={2}
              nodesDraggable={false}
              nodesConnectable={false}
              nodesFocusable
              edgesFocusable
              edgesReconnectable={false}
              deleteKeyCode={null}
              autoPanOnNodeFocus
              panOnDrag
              zoomOnScroll={!isMobile}
              zoomOnPinch
              selectNodesOnDrag={false}
              proOptions={{ hideAttribution: true }}
              aria-label="Interactive process map"
              ariaLabelConfig={{
                "node.a11yDescription.default":
                  "Use arrow keys to move to a directly connected step. Press Enter to open step details. Press Escape to close details.",
                "node.a11yDescription.keyboardDisabled":
                  "Press Enter to open step details.",
                "controls.ariaLabel": "Process map viewport controls",
                "minimap.ariaLabel": "Process map overview",
              }}
            >
              <Background
                gap={24}
                size={0.75}
                color="var(--color-border)"
                className="!bg-background opacity-55"
              />

              {viewPreferences.grouping === "owner" && (
                <OwnerLaneBackdrop
                  lanes={lanes}
                  direction={viewPreferences.direction}
                />
              )}

              {viewPreferences.grouping === "owner" && (
                <Panel position="top-right" className="!m-3 max-w-72">
                  <div className="rounded-xl border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur-md">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <UsersRound
                        className="size-3.5 text-org-accent"
                        aria-hidden
                      />
                      Owner lanes
                    </div>
                    <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
                      A reading aid, not ownership data. Multi-actor steps
                      appear in Shared; unfinished steps stay in Awaiting
                      details. Choose Process view to turn it off.
                    </p>
                  </div>
                </Panel>
              )}

              <p className="sr-only" role="status" aria-live="polite">
                {`Process shown ${viewPreferences.direction === "horizontal" ? "left to right" : "top to bottom"}${viewPreferences.grouping === "owner" ? ` in ${lanes.length} owner lanes` : " without grouping"}.`}
              </p>
              <p
                className="sr-only"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {keyboardAnnouncement}
              </p>

              <ViewportToolbar
                zoom={zoom}
                selectedNodeId={selectedNodeId}
                showMinimap={showMinimap}
                canShowMinimap={!isMobile}
                isFullscreen={isFullscreen}
                direction={viewPreferences.direction}
                grouping={viewPreferences.grouping}
                onZoomOut={() => void zoomOut({ duration: viewportDuration })}
                onZoomIn={() => void zoomIn({ duration: viewportDuration })}
                onFitAll={handleFitAll}
                onCenterSelected={handleCenterSelected}
                onToggleMinimap={() => setShowMinimap((visible) => !visible)}
                fullscreenToggleRef={fullscreenToggleRef}
                onToggleFullscreen={() => setIsFullscreen((value) => !value)}
                onDirectionChange={handleDirectionChange}
                onGroupingChange={handleGroupingChange}
              />

              {!isMobile && showMinimap && (
                <MiniMap
                  nodeColor={(n) => {
                    const colors: Record<string, string> = {
                      start: "#10b981",
                      end: "#64748b",
                      action: "#3b82f6",
                      decision: "#f59e0b",
                      handoff: "#8b5cf6",
                      wait: "#f97316",
                    };
                    if (activeSpotlight && !n.data.spotlighted) {
                      return "var(--color-muted)";
                    }
                    return colors[n.type ?? "action"] ?? "#3b82f6";
                  }}
                  nodeStrokeColor={(node) =>
                    node.selected || node.data.spotlighted
                      ? "var(--org-accent)"
                      : "color-mix(in oklch, var(--foreground) 28%, transparent)"
                  }
                  nodeStrokeWidth={10}
                  nodeBorderRadius={6}
                  pannable
                  zoomable
                  zoomStep={8}
                  // React Flow reads these inline dimensions when calculating
                  // its SVG viewBox. CSS-only sizing leaves the internal SVG at
                  // the 200×150 default and lets the viewport mask escape the
                  // smaller visible frame.
                  style={{ width: 144, height: 96 }}
                  ariaLabel="Process map overview. Drag to pan or scroll to zoom."
                  // Where the toolbar and the minimap can't sit side by side
                  // (toolbar + 176px), lift the minimap clear of the toolbar.
                  className="!m-3 !overflow-hidden !rounded-xl !border !border-border !bg-card/95 !shadow-lg @max-xl:!mb-18 pointer-coarse:@max-3xl:!mb-18"
                  bgColor="var(--color-card)"
                  maskColor="color-mix(in oklch, var(--background) 34%, transparent)"
                  maskStrokeColor="var(--org-accent)"
                  maskStrokeWidth={2}
                  offsetScale={8}
                />
              )}
            </ReactFlow>
          </div>

          {/* Detail panel (desktop). This shell owns motion, elevation and
              resizing; the existing detail component remains content-only. */}
          <AnimatePresence initial={false}>
            {selectedNode && !isMobile && (
              <motion.aside
                id="process-flow-detail-panel"
                aria-label={`Details for ${selectedNode.label}`}
                className="absolute right-0 top-0 z-20 h-full overflow-visible border-l border-border/80 bg-background shadow-[-12px_0_32px_-20px_rgba(15,23,42,0.35)]"
                style={{ width: effectiveDetailPanelWidth }}
                initial={reduceMotion ? false : { x: 24, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={reduceMotion ? { opacity: 1 } : { x: 24, opacity: 0 }}
                transition={{
                  duration: reduceMotion ? 0 : 0.2,
                  ease: "easeOut",
                }}
              >
                <DesktopPanelResizeHandle
                  width={effectiveDetailPanelWidth}
                  maxWidth={maxDetailPanelWidth}
                  onPointerDown={handleDetailPanelResizeStart}
                  onKeyDown={handleDetailPanelResizeKeyDown}
                />
                <ProcessFlowDetailPanel
                  node={selectedNode}
                  edges={flow.edges}
                  allNodes={flow.nodes}
                  onClose={handleCloseDetails}
                  onNavigate={handleNavigateToNode}
                  onRetryDetail={
                    canEdit
                      ? () => handleRetryNodeDetail(selectedNode.id)
                      : undefined
                  }
                  isRetryingDetail={retryingNodeId === selectedNode.id}
                  onOpenConversation={onOpenConversation}
                />
              </motion.aside>
            )}
          </AnimatePresence>

          {/* Detail panel (mobile — bottom Sheet) */}
          {isMobile && (
            <Sheet
              open={!!selectedNode}
              onOpenChange={(open) => {
                if (!open) handleCloseDetails();
              }}
            >
              <SheetContent
                side="bottom"
                className="h-[60vh] p-0"
                showCloseButton={false}
              >
                <SheetTitle className="sr-only">Node details</SheetTitle>
                {selectedNode && (
                  <ProcessFlowDetailPanel
                    node={selectedNode}
                    edges={flow.edges}
                    allNodes={flow.nodes}
                    onClose={handleCloseDetails}
                    onNavigate={handleNavigateToNode}
                    onRetryDetail={
                    canEdit
                      ? () => handleRetryNodeDetail(selectedNode.id)
                      : undefined
                  }
                    isRetryingDetail={retryingNodeId === selectedNode.id}
                    onOpenConversation={onOpenConversation}
                  />
                )}
              </SheetContent>
            </Sheet>
          )}
        </div>

        {/* Insights bar at bottom */}
        <InsightsBar
          insights={flow.insights}
          nodeCount={flow.nodes.length}
          spotlights={visibleSpotlights}
          activeSpotlight={activeSpotlight}
          onSpotlightChange={handleSpotlightChange}
          onOpenInsights={onOpenInsights}
        />
      </div>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function OwnerLaneBackdrop({
  lanes,
  direction,
}: {
  lanes: FlowLayoutLane[];
  direction: FlowDirection;
}) {
  return (
    <ViewportPortal>
      {lanes.map((lane, index) => (
        <div
          key={lane.id}
          className={cn(
            "pointer-events-none absolute -z-10 rounded-2xl border",
            lane.kind === "shared"
              ? "border-org-accent-border bg-org-accent-subtle/45"
              : lane.kind === "pending"
                ? "border-dashed border-border bg-muted/10"
                : index % 2 === 0
                  ? "border-border/70 bg-muted/25"
                  : "border-border/60 bg-card/35",
          )}
          style={{
            left: lane.position.x,
            top: lane.position.y,
            width: lane.width,
            height: lane.height,
          }}
          aria-hidden
        >
          <SectionLabel
            render={<span />}
            size="sm"
            className="absolute left-4 top-3 max-w-[calc(100%-2rem)] truncate"
          >
            {lane.label}
          </SectionLabel>
          {direction === "vertical" && (
            <SectionLabel
              render={<span />}
              size="sm"
              className="absolute bottom-3 left-4 max-w-[calc(100%-2rem)] truncate rounded-full border border-border/70 bg-card/90 px-2 py-1 shadow-sm"
            >
              {lane.label}
            </SectionLabel>
          )}
        </div>
      ))}
    </ViewportPortal>
  );
}

// 28px under a mouse, 40px under a finger.
const TOOLBAR_BUTTON_CLASS =
  "rounded-lg text-muted-foreground hover:bg-org-accent-subtle hover:text-foreground";

function ToolbarButton({
  label,
  shortcut,
  pressed,
  disabled,
  buttonRef,
  onClick,
  children,
}: {
  label: string;
  /** A key that does the same thing: announced, and shown in the tooltip. */
  shortcut?: { key: string; label: string };
  pressed?: boolean;
  disabled?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={buttonRef}
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(
              TOOLBAR_BUTTON_CLASS,
              pressed &&
                "bg-org-accent-selected text-org-accent-selected-foreground",
            )}
            aria-label={label}
            aria-keyshortcuts={shortcut?.key}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent side="top">
        {label}
        {shortcut && <span className="opacity-70">{shortcut.label}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Direction and grouping as one menu, for canvases too narrow to show them
 * inline. Each choice closes the menu, like the toolbar buttons it stands in
 * for.
 */
function LayoutMenu({
  direction,
  grouping,
  className,
  onDirectionChange,
  onGroupingChange,
}: {
  direction: FlowDirection;
  grouping: FlowGrouping;
  className?: string;
  onDirectionChange: (direction: FlowDirection) => void;
  onGroupingChange: (grouping: FlowGrouping) => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={cn(TOOLBAR_BUTTON_CLASS, className)}
                  aria-label="Layout options"
                >
                  <SlidersHorizontal aria-hidden />
                </Button>
              }
            />
          }
        />
        <TooltipContent side="top">Layout options</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-auto min-w-52"
      >
        <DropdownMenuRadioGroup
          value={direction}
          onValueChange={(value: FlowDirection) => onDirectionChange(value)}
        >
          <DropdownMenuLabel>Direction</DropdownMenuLabel>
          <DropdownMenuRadioItem
            value="horizontal"
            closeOnClick
          >
            <ArrowRight aria-hidden />
            Horizontal layout
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="vertical"
            closeOnClick
          >
            <ArrowDown aria-hidden />
            Vertical layout
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={grouping}
          onValueChange={(value: FlowGrouping) => onGroupingChange(value)}
        >
          <DropdownMenuLabel>Grouping</DropdownMenuLabel>
          <DropdownMenuRadioItem
            value="process"
            closeOnClick
          >
            <Network aria-hidden />
            Process view
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="owner"
            closeOnClick
          >
            <UsersRound aria-hidden />
            Owner lanes
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ViewportToolbar({
  zoom,
  selectedNodeId,
  showMinimap,
  canShowMinimap,
  isFullscreen,
  direction,
  grouping,
  onZoomOut,
  onZoomIn,
  onFitAll,
  onCenterSelected,
  onToggleMinimap,
  fullscreenToggleRef,
  onToggleFullscreen,
  onDirectionChange,
  onGroupingChange,
}: {
  zoom: number;
  selectedNodeId: string | null;
  showMinimap: boolean;
  canShowMinimap: boolean;
  isFullscreen: boolean;
  direction: FlowDirection;
  grouping: FlowGrouping;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitAll: () => void;
  onCenterSelected: () => void;
  onToggleMinimap: () => void;
  fullscreenToggleRef: React.Ref<HTMLButtonElement>;
  onToggleFullscreen: () => void;
  onDirectionChange: (direction: FlowDirection) => void;
  onGroupingChange: (grouping: FlowGrouping) => void;
}) {
  // Sized to the canvas container, not the viewport. Inline, everything is
  // about 390px wide with a mouse and 510px with 40px touch targets, so
  // direction and grouping fold into the layout menu below 28rem (mouse) or
  // 36rem (touch). Touch also drops the zoom readout below 28rem, which keeps
  // one row at about 295px for a 360px phone's 334px canvas. Wrapping is only
  // the last resort for anything narrower.
  return (
    <Panel position="bottom-left" className="!m-3">
      <div
        className="flex flex-wrap items-center gap-0.5 rounded-xl border border-border bg-card/95 p-1 shadow-lg backdrop-blur-md"
        role="toolbar"
        aria-label="Process map viewport"
      >
        <ToolbarButton label="Zoom out" onClick={onZoomOut}>
          <Minus aria-hidden />
        </ToolbarButton>
        <output
          className="min-w-11 px-1 text-center text-2xs font-medium tabular-nums text-muted-foreground @max-xs:hidden pointer-coarse:@max-md:hidden"
          aria-label={`Current zoom ${Math.round(zoom * 100)} percent`}
        >
          {Math.round(zoom * 100)}%
        </output>
        <ToolbarButton label="Zoom in" onClick={onZoomIn}>
          <Plus aria-hidden />
        </ToolbarButton>

        <div className="mx-1 h-5 w-px bg-border" aria-hidden />

        <ToolbarButton label="Fit entire process" onClick={onFitAll}>
          <Scan aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label="Center selected step"
          disabled={!selectedNodeId}
          onClick={onCenterSelected}
        >
          <LocateFixed aria-hidden />
        </ToolbarButton>

        <div className="mx-1 h-5 w-px bg-border" aria-hidden />

        <div
          className="hidden items-center gap-0.5 @md:flex pointer-coarse:@max-xl:hidden"
          role="group"
          aria-label="Flow direction"
        >
          <ToolbarButton
            label="Horizontal layout"
            pressed={direction === "horizontal"}
            onClick={() => onDirectionChange("horizontal")}
          >
            <ArrowRight aria-hidden />
          </ToolbarButton>
          <ToolbarButton
            label="Vertical layout"
            pressed={direction === "vertical"}
            onClick={() => onDirectionChange("vertical")}
          >
            <ArrowDown aria-hidden />
          </ToolbarButton>
        </div>

        <div
          className="hidden items-center gap-0.5 @md:flex pointer-coarse:@max-xl:hidden"
          role="group"
          aria-label="Flow grouping"
        >
          <ToolbarButton
            label="Process view"
            pressed={grouping === "process"}
            onClick={() => onGroupingChange("process")}
          >
            <Network aria-hidden />
          </ToolbarButton>
          <ToolbarButton
            label={
              grouping === "owner"
                ? "Turn off owner lanes"
                : "Turn on owner lanes — multi-actor steps use the Shared lane"
            }
            pressed={grouping === "owner"}
            onClick={() => onGroupingChange(toggleOwnerGrouping(grouping))}
          >
            <UsersRound aria-hidden />
          </ToolbarButton>
        </div>

        <LayoutMenu
          direction={direction}
          grouping={grouping}
          className="@md:hidden pointer-coarse:@max-xl:inline-flex"
          onDirectionChange={onDirectionChange}
          onGroupingChange={onGroupingChange}
        />

        {canShowMinimap && (
          <ToolbarButton
            label={showMinimap ? "Hide minimap" : "Show minimap"}
            pressed={showMinimap}
            onClick={onToggleMinimap}
          >
            {showMinimap ? <MapPinned aria-hidden /> : <MapIcon aria-hidden />}
          </ToolbarButton>
        )}

        <div className="mx-1 h-5 w-px bg-border" aria-hidden />

        <ToolbarButton
          label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          shortcut={isFullscreen ? { key: "Escape", label: "Esc" } : undefined}
          pressed={isFullscreen}
          buttonRef={fullscreenToggleRef}
          onClick={onToggleFullscreen}
        >
          {isFullscreen ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
        </ToolbarButton>
      </div>
    </Panel>
  );
}

function DesktopPanelResizeHandle({
  width,
  maxWidth,
  onPointerDown,
  onKeyDown,
}: {
  width: number;
  maxWidth: number;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
  onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label="Resize step details"
      aria-controls="process-flow-detail-panel"
      aria-orientation="vertical"
      aria-valuemin={DETAIL_PANEL_MIN_WIDTH}
      aria-valuemax={Math.round(maxWidth)}
      aria-valuenow={Math.round(width)}
      aria-valuetext={`${Math.round(width)} pixels wide`}
      className="group focus-ring absolute inset-y-0 -left-2 z-30 flex w-4 touch-none cursor-col-resize items-center justify-center rounded-sm"
      title="Drag to resize. Use Left and Right arrow keys for precise control."
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <span className="h-10 w-1 rounded-full bg-border transition-[height,background-color] group-hover:h-14 group-hover:bg-org-accent-border group-focus-visible:h-14 group-focus-visible:bg-org-accent motion-reduce:transition-none" />
    </div>
  );
}

function FlowEmptyState({
  onGenerate,
  isGenerating,
  hasConversations,
  pendingConversations,
  actionError,
}: {
  /** Absent for viewers, who can't generate. */
  onGenerate?: () => void;
  isGenerating: boolean;
  hasConversations: boolean;
  pendingConversations: PendingConversationCounts;
  actionError: string | null;
}) {
  return (
    <EmptyState
      variant="plain"
      titleAs="p"
      className="flex-1"
      icon={GitBranch}
      title="No process flow yet"
      description={
        onGenerate ? (
          <>Generate a visual flow diagram from this process&apos;s contributions.</>
        ) : (
          <>
            A contributor or admin can generate a flow diagram from this
            process&apos;s contributions.
          </>
        )
      }
      action={
        onGenerate && (
          <Button
            size="sm"
            onClick={onGenerate}
            disabled={isGenerating || !hasConversations}
            className="gap-2"
          >
            {isGenerating ? (
              <>
                <Spinner className="size-4" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                Generate Process Flow
              </>
            )}
          </Button>
        )
      }
    >
      {actionError && (
        <p className="max-w-sm text-xs text-destructive" role="alert">
          {actionError}
        </p>
      )}
      {!hasConversations && (
        <p className="max-w-[280px] text-center text-2xs text-muted-foreground">
          {noConversationsMessage(pendingConversations)}
        </p>
      )}
    </EmptyState>
  );
}

function InsightsBar({
  insights,
  nodeCount,
  spotlights,
  activeSpotlight,
  onSpotlightChange,
  onOpenInsights,
}: {
  insights: {
    totalEstimatedDuration?: string;
    handoffCount: number;
    toolCount: number;
    automationOpportunities: string[];
    automationOpportunitiesSource?: "ai" | "derived";
    topBottlenecks: string[];
  };
  nodeCount: number;
  spotlights: FlowSpotlightMap;
  activeSpotlight: FlowSpotlight | null;
  onSpotlightChange: (mode: FlowSpotlightMode | null) => void;
  onOpenInsights: () => void;
}) {
  // "Recommended automations" is the flow-level analysed list, a handful of
  // multi-step recommendations. The "automatable steps" spotlight is a
  // different measure — one entry per step whose automationPotential is above
  // none — so it reads far higher on the same flow. Wording them alike made
  // the two look like the same count disagreeing.
  //
  // The insights stage failing leaves behind placeholders that merely look
  // automatable. Absent means a legacy row from before the field existed, which
  // the Insights tab also reads as analysed — only an explicit "derived" is a
  // known-unreviewed list, and it must not be called a recommendation.
  const automationUnreviewed =
    insights.automationOpportunitiesSource === "derived";
  const automationCount = insights.automationOpportunities.length;

  return (
    <div className="shrink-0 border-t border-border bg-muted/30 px-4 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex items-center gap-1">
            <BarChart3 className="size-3" aria-hidden />
            {nodeCount} steps
          </span>
          {insights.totalEstimatedDuration && (
            <span className="flex items-center gap-1">
              <Clock className="size-3" aria-hidden />
              {insights.totalEstimatedDuration}
            </span>
          )}

          <div className="hidden h-5 w-px bg-border sm:block" aria-hidden />
          <div
            className="flex flex-wrap items-center gap-1"
            role="group"
            aria-label="Spotlight process findings"
          >
            <SpotlightButton
              spotlight={spotlights.bottlenecks}
              active={activeSpotlight?.mode === "bottlenecks"}
              icon={AlertTriangle}
              // A zero count is not a warning, so it stays neutral.
              tone={spotlights.bottlenecks.metricCount > 0 ? "danger" : "neutral"}
              onClick={() => onSpotlightChange("bottlenecks")}
            />
            <SpotlightButton
              spotlight={spotlights.handoffs}
              active={activeSpotlight?.mode === "handoffs"}
              icon={ArrowRightLeft}
              onClick={() => onSpotlightChange("handoffs")}
            />
            <SpotlightButton
              spotlight={spotlights.automation}
              active={activeSpotlight?.mode === "automation"}
              icon={Bot}
              tone={spotlights.automation.metricCount > 0 ? "success" : "neutral"}
              onClick={() => onSpotlightChange("automation")}
            />
            <SpotlightButton
              spotlight={spotlights.tools}
              active={activeSpotlight?.mode === "tools"}
              icon={Wrench}
              onClick={() => onSpotlightChange("tools")}
            />
          </div>

          {automationCount > 0 && (
            <span
              className={cn(
                "flex items-center gap-1",
                automationUnreviewed ? "text-muted-foreground" : "text-success",
              )}
              title={
                automationUnreviewed
                  ? "Automation was not analysed for this run — these are steps that looked automatable, not reviewed recommendations."
                  : undefined
              }
            >
              <Bot className="size-3" aria-hidden />
              {automationCount}{" "}
              {automationUnreviewed ? "possible" : "recommended"} automation
              {automationCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="focus-ring h-7 shrink-0 px-2 text-xs"
          onClick={onOpenInsights}
        >
          Open Insights
        </Button>
      </div>
      {activeSpotlight && (
        <p className="sr-only" role="status" aria-live="polite">
          {`${activeSpotlight.label} spotlight active on ${activeSpotlight.nodeIds.size} ${activeSpotlight.nodeIds.size === 1 ? "step" : "steps"}. Activate the button again to clear it.`}
        </p>
      )}
    </div>
  );
}

const SPOTLIGHT_TONE_CLASSES = {
  neutral: {
    inactive:
      "text-muted-foreground hover:border-border hover:bg-card hover:text-foreground",
    active:
      "border-org-accent-border bg-org-accent-selected text-org-accent-selected-foreground",
  },
  danger: {
    inactive:
      "text-destructive hover:border-destructive-border hover:bg-destructive-subtle",
    active: "border-destructive bg-destructive-subtle text-destructive",
  },
  success: {
    inactive: "text-success hover:border-success-border hover:bg-success-subtle",
    active: "border-success bg-success-subtle text-success",
  },
} as const;

function SpotlightButton({
  spotlight,
  active,
  icon: Icon,
  tone = "neutral",
  onClick,
}: {
  spotlight: FlowSpotlight;
  active: boolean;
  icon: LucideIcon;
  tone?: keyof typeof SPOTLIGHT_TONE_CLASSES;
  onClick: () => void;
}) {
  const matchCount = spotlight.nodeIds.size;
  const action = active ? "Clear" : "Spotlight";
  const disabled = matchCount === 0;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "focus-ring h-7 gap-1 rounded-full border border-transparent px-2 text-xs",
              SPOTLIGHT_TONE_CLASSES[tone][active ? "active" : "inactive"],
            )}
            aria-pressed={active}
            aria-label={`${action} ${spotlight.label}: ${spotlight.metricCount} ${spotlight.metricLabel}, ${matchCount} matching ${matchCount === 1 ? "step" : "steps"}`}
            disabled={disabled}
            onClick={onClick}
          >
            <Icon className="size-3" aria-hidden />
            <span className="tabular-nums">{spotlight.metricCount}</span>
            <span>{spotlight.metricLabel}</span>
          </Button>
        }
      />
      <TooltipContent side="top">
        {matchCount === 0
          ? "No matching steps"
          : `${active ? "Clear" : "Locate"} ${matchCount} matching ${matchCount === 1 ? "step" : "steps"}`}
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Exported wrapper with ReactFlowProvider
// ---------------------------------------------------------------------------

export function ProcessFlow(props: ProcessFlowProps) {
  return (
    <ReactFlowProvider>
      <ProcessFlowInner {...props} />
    </ReactFlowProvider>
  );
}

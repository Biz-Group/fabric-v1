type ViewportNode = {
  id: string;
  type?: string;
  data?: {
    category?: string;
  };
};

type ViewportEdge = {
  source: string;
  target: string;
};

type EntryViewportDirection = "horizontal" | "vertical";

type EntryViewportNode = {
  position: { x: number; y: number };
  width: number;
  height: number;
};

type EntryViewportSize = {
  width: number;
  height: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Places the entry card at the natural reading origin rather than centring a
 * large graph's bounds. Horizontal flows begin centre-left; vertical flows
 * begin top-centre. The transform is independent of live node detail updates.
 */
export function resolveEntryViewportTransform({
  node,
  viewport,
  direction,
  zoom = 0.92,
}: {
  node: EntryViewportNode;
  viewport: EntryViewportSize;
  direction: EntryViewportDirection;
  zoom?: number;
}) {
  const nodeCenterX = node.position.x + node.width / 2;
  const nodeCenterY = node.position.y + node.height / 2;
  const narrow = viewport.width < 640;

  const targetX =
    direction === "horizontal" && !narrow
      ? clamp(
          viewport.width * 0.22,
          (node.width * zoom) / 2 + 48,
          Math.min(360, viewport.width * 0.34),
        )
      : viewport.width / 2;
  const targetY =
    direction === "vertical"
      ? clamp(
          viewport.height * 0.2,
          (node.height * zoom) / 2 + 48,
          Math.min(220, viewport.height * 0.35),
        )
      : viewport.height / 2;

  return {
    x: targetX - nodeCenterX * zoom,
    y: targetY - nodeCenterY * zoom,
    zoom,
  };
}

/**
 * Finds the most useful entry point for opening a read-only process map.
 * Generated flows normally contain a start node; the zero-incoming fallback
 * also keeps legacy and partially generated flows navigable.
 */
export function resolveFlowEntryNodeId(
  nodes: ViewportNode[],
  edges: ViewportEdge[],
) {
  const explicitStart = nodes.find(
    (node) => node.type === "start" || node.data?.category === "start",
  );
  if (explicitStart) return explicitStart.id;

  const targets = new Set(edges.map((edge) => edge.target));
  return (
    nodes.find((node) => !targets.has(node.id))?.id ?? nodes[0]?.id ?? null
  );
}

/**
 * The last viewport the map chose for itself, so a later resize can repeat
 * it. Cleared as soon as the person pans, zooms or selects a step.
 */
export type AutomaticFlowFrame =
  | { mode: "entry"; width: number; height: number }
  | {
      mode: "fit";
      width: number;
      height: number;
      nodeIds?: string[];
      padding: number;
      maxZoom: number;
    };

const RESIZE_REFRAME_MIN_PX = 48;
const RESIZE_REFRAME_MIN_RATIO = 0.1;

function changedMaterially(previous: number, next: number) {
  return (
    Math.abs(next - previous) >=
    Math.max(RESIZE_REFRAME_MIN_PX, previous * RESIZE_REFRAME_MIN_RATIO)
  );
}

/**
 * Decides whether a canvas resize should repeat the last automatic frame.
 * Returns null when the person has taken over the view, or when the change
 * is too small to leave the frame stale (scrollbars, sub-pixel layout).
 */
export function resolveResizeReframe(
  frame: AutomaticFlowFrame | null,
  size: EntryViewportSize,
): AutomaticFlowFrame | null {
  if (!frame || size.width <= 0 || size.height <= 0) return null;
  if (
    !changedMaterially(frame.width, size.width) &&
    !changedMaterially(frame.height, size.height)
  ) {
    return null;
  }
  return { ...frame, width: size.width, height: size.height };
}

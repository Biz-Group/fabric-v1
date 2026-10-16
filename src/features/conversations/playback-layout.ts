// Layout rules for the Contributions tab's playback. Below `md` the list and
// the playback stack and scroll as one column inside the workbench's tab
// panel, so the playback can sit far below the list and its controls can
// scroll off screen.

type VerticalEdges = { top: number; bottom: number };

/** Where the playback controls sit relative to what's on screen. */
export type ControlsPosition = "visible" | "above" | "below";

/**
 * Reads the controls' IntersectionObserver entry. Out of view, the side is
 * judged against the middle of the viewport rather than its edges: the tab
 * scrolls inside the workbench, so the controls are clipped at the tab
 * panel's edge while still inside the viewport.
 */
export function controlsPositionFrom(
  entry: { isIntersecting: boolean; boundingClientRect: VerticalEdges },
  viewportHeight: number,
): ControlsPosition {
  if (entry.isIntersecting) return "visible";
  const { top, bottom } = entry.boundingClientRect;
  return (top + bottom) / 2 < viewportHeight / 2 ? "above" : "below";
}

/**
 * The docked mini-player shows while the controls are off screen and there's
 * something for it to control: audio playing, or the shown conversation's
 * audio paused. Paused counts, or pausing from the bar would remove the only
 * control within reach. Another conversation's paused audio doesn't.
 */
export function shouldDockMiniPlayer({
  controls,
  isPlaying,
  activeItemIsShown,
}: {
  controls: ControlsPosition;
  isPlaying: boolean;
  /** The loaded audio belongs to the conversation the panel shows. */
  activeItemIsShown: boolean;
}) {
  return controls !== "visible" && (isPlaying || activeItemIsShown);
}

/**
 * True when the playback panel starts below the list, i.e. the columns stack.
 * Read from layout rather than a media query, so it follows the grid's
 * breakpoint wherever that moves.
 */
export function isStackedBelow(list: VerticalEdges, panel: VerticalEdges) {
  return panel.top >= list.bottom - 1;
}

/** Smooth, unless the user has asked the system for reduced motion. */
function preferredScrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

/**
 * Brings `element` into view by scrolling only its nearest scrolling
 * ancestor, with its top at that ancestor's top ("start") or centred.
 * `scrollIntoView` would also scroll every `overflow: hidden` box above it and
 * the page itself, which can push the workbench header off a phone screen.
 * Does nothing for an element that isn't rendered (`display: none`).
 */
export function scrollIntoNearestScroller(
  element: HTMLElement,
  block: "start" | "center",
) {
  if (element.getClientRects().length === 0) return;
  const behavior = preferredScrollBehavior();

  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY !== "auto" && overflowY !== "scroll") continue;
    if (node.scrollHeight <= node.clientHeight) continue;

    const offset =
      element.getBoundingClientRect().top -
      node.getBoundingClientRect().top -
      node.clientTop;
    const centring =
      block === "center"
        ? Math.max(0, (node.clientHeight - element.offsetHeight) / 2)
        : 0;
    node.scrollTo({ top: node.scrollTop + offset - centring, behavior });
    return;
  }

  // Nothing between it and the page scrolls, so only the page can.
  element.scrollIntoView({ block, behavior });
}

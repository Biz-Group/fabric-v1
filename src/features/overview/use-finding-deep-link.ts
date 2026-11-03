"use client";

import { useEffect, useRef, type RefObject } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { clearFindingTarget, peekFindingTarget } from "@/features/workbench/deep-link-targets";

/** How long a finding stays highlighted after a citation jump. */
const HIGHLIGHT_MS = 2_500;

/**
 * Follows a `finding=` link (FR-5.3), e.g. from an AskFabric citation: once
 * the overview has rendered, scrolls to that finding inside `container`,
 * focuses it and highlights it briefly. The workbench captures the target on
 * mount (deep-link-targets.ts); the first visible copy of the row consumes it.
 *
 * Looks inside the container rather than the document because the workbench
 * can mount an overview in its desktop and phone layouts at once.
 */
export function useFindingDeepLink(container: RefObject<HTMLElement | null>, ready: boolean) {
  const reduceMotion = usePrefersReducedMotion();
  const done = useRef(false);

  useEffect(() => {
    const findingId = peekFindingTarget();
    if (done.current || !ready || !findingId || !container.current) return;
    const target = container.current.querySelector<HTMLElement>(`[data-finding-id="${CSS.escape(findingId)}"]`);
    // A hidden layout's copy leaves the target for the visible one.
    if (!target || target.offsetParent === null) return;
    done.current = true;
    clearFindingTarget();
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    target.focus({ preventScroll: true });
    target.dataset.highlighted = "true";
    // Not cleared on re-render: the highlight should fade on its own schedule.
    window.setTimeout(() => delete target.dataset.highlighted, HIGHLIGHT_MS);
  }, [container, ready, reduceMotion]);
}

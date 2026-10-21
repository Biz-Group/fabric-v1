"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";

// Leaves part of the neighbouring tab showing, so the strip still reads as
// scrollable once the active tab is brought into view.
const EDGE_PEEK_PX = 24;

/**
 * The process tabs' horizontal scroller. On a phone only the first three tabs
 * fit, so it keeps the active tab in view (a deep link to Automations would
 * otherwise open with its tab offscreen) and fades whichever edge has more
 * tabs beyond it. Scrolling stays native.
 */
export function ProcessTabStrip({
  activeTab,
  className,
  children,
}: {
  /** Changes whenever the selected tab does. */
  activeTab: number;
  className?: string;
  children: ReactNode;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const [overflow, setOverflow] = useState({ start: false, end: false });

  const updateOverflow = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const maxScroll = scroller.scrollWidth - scroller.clientWidth;
    const next = {
      start: scroller.scrollLeft > 1,
      end: scroller.scrollLeft < maxScroll - 1,
    };
    setOverflow((current) =>
      current.start === next.start && current.end === next.end ? current : next,
    );
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    return () => observer.disconnect();
  }, [updateOverflow]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    // The workbench also mounts a hidden copy for its other layout.
    if (!scroller || scroller.getClientRects().length === 0) return;
    const tab = scroller.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    );
    if (!tab) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const tabStart = tabRect.left - scrollerRect.left + scroller.scrollLeft;
    const tabEnd = tabStart + tabRect.width;
    const viewStart = scroller.scrollLeft;
    const viewEnd = viewStart + scroller.clientWidth;

    let left: number | null = null;
    if (tabStart < viewStart) left = tabStart - EDGE_PEEK_PX;
    else if (tabEnd > viewEnd) left = tabEnd - scroller.clientWidth + EDGE_PEEK_PX;

    if (left !== null) {
      // Jump on the first pass (page load, deep link); glide on a change.
      scroller.scrollTo({
        left: Math.max(0, left),
        behavior:
          hasScrolledRef.current && !prefersReducedMotion ? "smooth" : "auto",
      });
    }
    hasScrolledRef.current = true;
  }, [activeTab, prefersReducedMotion]);

  return (
    <div className={cn("relative shrink-0", className)}>
      <div
        ref={scrollerRef}
        className="overflow-x-auto overflow-y-hidden px-2 sm:px-4"
        onScroll={updateOverflow}
        data-tour="process-tabs"
      >
        {children}
      </div>
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent transition-opacity motion-reduce:transition-none",
          overflow.start ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent transition-opacity motion-reduce:transition-none",
          overflow.end ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

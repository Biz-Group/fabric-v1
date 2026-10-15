"use client"

import * as React from "react"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/** How long to wait for an anchor before giving up on the step. */
const ANCHOR_WAIT_MS = 2000
const ANCHOR_POLL_MS = 100
const SPOTLIGHT_PADDING_PX = 6

/** The visible element marked `data-tour={id}`. The workbench mounts its
 * desktop and phone layouts at once (CSS hides one), so most anchors exist
 * twice; only one has a layout box. */
export function findTourAnchor(id: string, node?: string): HTMLElement | null {
  const nodeSelector = node ? `[data-tour-node="${CSS.escape(node)}"]` : ""
  const candidates = document.querySelectorAll<HTMLElement>(
    `[data-tour="${CSS.escape(id)}"]${nodeSelector}`
  )
  for (const element of candidates) {
    if (element.getClientRects().length > 0) return element
  }
  return null
}

/** Waits up to 2 s for the anchor, then follows its box through resizes and
 * scrolling. `missing` turns true if it never appears. */
function useTourAnchor(id: string, node?: string) {
  const [element, setElement] = React.useState<HTMLElement | null>(null)
  const [missing, setMissing] = React.useState(false)
  const [rect, setRect] = React.useState<DOMRect | null>(null)

  React.useEffect(() => {
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const found = findTourAnchor(id, node)
      if (found) {
        window.clearInterval(timer)
        setElement(found)
      } else if (Date.now() - startedAt >= ANCHOR_WAIT_MS) {
        window.clearInterval(timer)
        setMissing(true)
      }
    }, ANCHOR_POLL_MS)
    return () => window.clearInterval(timer)
  }, [id, node])

  React.useEffect(() => {
    if (!element) return
    const measure = () => setRect(element.getBoundingClientRect())
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener("scroll", measure, true)
    window.addEventListener("resize", measure)
    measure()
    element.scrollIntoView({ block: "nearest", inline: "nearest" })
    return () => {
      observer.disconnect()
      window.removeEventListener("scroll", measure, true)
      window.removeEventListener("resize", measure)
    }
  }, [element])

  return { element, rect, missing }
}

type CoachmarkProps = {
  /** The `data-tour` id of the element to point at. */
  anchor: string
  /** Narrows `anchor` to the element with this `data-tour-node`, e.g. one
   * tree row. */
  anchorNode?: string
  title: string
  body: React.ReactNode
  /** Multi-step tours: "n of m" with Back and Next. */
  step?: {
    index: number
    total: number
    onBack?: () => void
    onNext: () => void
    nextLabel?: string
  }
  /** Close, Esc, or the dismiss button. */
  onDismiss: () => void
  /** The dismiss button's label: "Got it" for a hint, "Skip tour" for a tour. */
  dismissLabel?: string
  /** The anchor never appeared within 2 s. Defaults to dismissing. */
  onAnchorMissing?: () => void
  side?: "top" | "bottom" | "left" | "right"
}

/**
 * Points at one element: a dimmed page with a cut-out around it, and a
 * popover beside it. The page stays usable, including the highlighted
 * element, so clicking it can move a tour along. Focus is trapped in the
 * popover; Esc dismisses.
 */
export function Coachmark({
  anchor,
  anchorNode,
  title,
  body,
  step,
  onDismiss,
  dismissLabel = "Got it",
  onAnchorMissing,
  side = "bottom",
}: CoachmarkProps) {
  const { element, rect, missing } = useTourAnchor(anchor, anchorNode)
  const missingHandler = onAnchorMissing ?? onDismiss
  const missingHandlerRef = React.useRef(missingHandler)
  React.useEffect(() => {
    missingHandlerRef.current = missingHandler
  })

  React.useEffect(() => {
    if (missing) missingHandlerRef.current()
  }, [missing])

  if (!element || !rect) return null

  const stepLabel = step ? `${step.index + 1} of ${step.total}` : null

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-40 rounded-lg shadow-[0_0_0_9999px_rgb(0_0_0/0.45)] ring-2 ring-org-accent transition-[top,left,width,height] duration-200 motion-reduce:transition-none"
        style={{
          top: rect.top - SPOTLIGHT_PADDING_PX,
          left: rect.left - SPOTLIGHT_PADDING_PX,
          width: rect.width + SPOTLIGHT_PADDING_PX * 2,
          height: rect.height + SPOTLIGHT_PADDING_PX * 2,
        }}
      />
      <p className="sr-only" aria-live="polite">
        {stepLabel ? `Step ${stepLabel}: ${title}` : title}
      </p>
      <Popover
        open
        modal="trap-focus"
        onOpenChange={(open, details) => {
          // Clicks elsewhere, including on the highlighted element, leave it
          // open; only Esc and the close buttons dismiss.
          if (
            !open &&
            (details.reason === "escape-key" || details.reason === "close-press")
          ) {
            onDismiss()
          }
        }}
      >
        <PopoverContent anchor={element} side={side} className="w-80">
          <div className="flex items-start justify-between gap-3">
            <PopoverTitle className="pt-0.5">{title}</PopoverTitle>
            <PopoverClose
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="-mr-1 -mt-1 shrink-0"
                  aria-label="Close"
                />
              }
            >
              <X className="size-3.5" />
            </PopoverClose>
          </div>
          <PopoverDescription className="mt-1.5 leading-6">
            {body}
          </PopoverDescription>
          <div
            className={cn(
              "mt-4 flex items-center gap-2",
              stepLabel ? "justify-between" : "justify-end"
            )}
          >
            {stepLabel && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {stepLabel}
              </span>
            )}
            <div className="flex items-center gap-2">
              {step ? (
                <>
                  <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
                    {dismissLabel}
                  </Button>
                  {step.onBack && step.index > 0 && (
                    <Button type="button" variant="outline" size="sm" onClick={step.onBack}>
                      Back
                    </Button>
                  )}
                  <Button type="button" size="sm" onClick={step.onNext}>
                    {step.nextLabel ?? "Next"}
                  </Button>
                </>
              ) : (
                <Button type="button" size="sm" onClick={onDismiss}>
                  {dismissLabel}
                </Button>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}

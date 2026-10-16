import * as React from "react"
import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

type SpinnerSize = "default" | "lg"

type SpinnerProps = Omit<React.ComponentProps<"svg">, "children"> & {
  /**
   * `default` is the one action size: 16px, or the icon size of the control
   * it sits in (a Button or menu item sizes it like the icon it replaces).
   * `lg` (20px) is only for a whole area or page that is loading.
   */
  size?: SpinnerSize
  /**
   * Announced as a status. Leave it out when visible text already says what
   * is happening (a button's label, a "Loading…" line beside it); the spinner
   * is then decorative.
   */
  label?: string
}

/**
 * The one spinner. Content that is loading gets a `Skeleton` instead; this is
 * for actions in flight and for areas with no shape to sketch.
 *
 * Under reduced motion it keeps turning, slowed (`globals.css`): a spinner
 * frozen mid-turn reads as a stuck control.
 */
function Spinner({ size = "default", label, className, ...props }: SpinnerProps) {
  // The 16px comes from the width/height attributes rather than a `size-*`
  // class, so a parent's `[&_svg:not([class*='size-'])]` rule still wins.
  const icon = (
    <Loader2Icon
      data-slot="spinner"
      aria-hidden="true"
      width={16}
      height={16}
      className={cn("shrink-0 animate-spin", size === "lg" && "size-5", className)}
      {...props}
    />
  )

  if (!label) return icon

  return (
    <span role="status" className="inline-flex">
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  )
}

type LoadingStateProps = Omit<React.ComponentProps<"div">, "title"> & {
  title: string
  description?: React.ReactNode
  /**
   * Matches `EmptyState`: `bordered` (default) is a dashed box for a slot on a
   * page or in a tab; `plain` is for a pane that is itself waiting.
   */
  variant?: "bordered" | "plain"
}

/**
 * Work in progress with nothing to show yet (a flow being generated). Laid
 * out like `EmptyState`, so the area doesn't jump when the work finishes or
 * fails, but announced as a status instead of read as empty.
 */
function LoadingState({
  title,
  description,
  variant = "bordered",
  className,
  children,
  ...props
}: LoadingStateProps) {
  return (
    <div
      role="status"
      data-slot="loading-state"
      className={cn(
        "flex flex-col items-center justify-center p-6 text-center",
        variant === "bordered" && "rounded-xl border border-dashed bg-card/40",
        className
      )}
      {...props}
    >
      <Spinner size="lg" className="mb-3 text-muted-foreground" />
      <p className="break-words text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm break-words text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      )}
      {children && (
        <div className="mt-3 flex flex-col items-center gap-2">{children}</div>
      )}
    </div>
  )
}

export { LoadingState, Spinner }

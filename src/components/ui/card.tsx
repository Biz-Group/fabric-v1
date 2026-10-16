import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The one surface recipe: a 1px `border`, `rounded-xl`, and `bg-card`.
 *
 * - `variant="inset"` is a tinted sub-surface (`bg-muted/30`) for items nested
 *   inside another surface or on a busy panel. An untinted nested box uses the
 *   default variant.
 * - `padding` omitted: the card lays out its slots (CardHeader, CardContent,
 *   CardFooter) as a column with `py-4`, as admin pages use it.
 * - `padding="none" | "sm" | "md"`: a plain surface whose children lay
 *   themselves out, padded 0 / `p-3` / `p-4`. Nothing else is added (no flex,
 *   gap, overflow or text size), so a hand-rolled box can move onto it as is.
 *
 * Notices tinted by a status tone, floating overlays (shadowed toolbars and
 * banners on the flow canvas), dialogs, pills and inputs are not surfaces.
 */
type CardVariant = "default" | "inset"
type CardPadding = "none" | "sm" | "md"

const CARD_SURFACE: Record<CardVariant, string> = {
  default: "bg-card",
  inset: "bg-muted/30",
}

const CARD_PADDING: Record<CardPadding, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
}

const CARD_SLOT_LAYOUT =
  "flex flex-col gap-4 overflow-hidden py-4 text-sm has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl"

/** The card classes, for a surface that must be another element (a
 * `section`, `header`, or `button`). */
function cardVariants({
  variant = "default",
  padding,
  className,
}: {
  variant?: CardVariant
  padding?: CardPadding
  className?: string
} = {}) {
  return cn(
    "group/card rounded-xl border text-card-foreground",
    CARD_SURFACE[variant],
    padding ? CARD_PADDING[padding] : CARD_SLOT_LAYOUT,
    className
  )
}

function Card({
  className,
  size = "default",
  variant,
  padding,
  ...props
}: React.ComponentProps<"div"> & {
  /** Slot spacing; only applies when `padding` is omitted. */
  size?: "default" | "sm"
  variant?: CardVariant
  padding?: CardPadding
}) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cardVariants({ variant, padding, className })}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-4 group-data-[size=sm]/card:px-3 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-4 group-data-[size=sm]/card:px-3", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-xl border-t bg-muted/50 p-4 group-data-[size=sm]/card:p-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  cardVariants,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}

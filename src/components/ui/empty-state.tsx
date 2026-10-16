import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

type EmptyStateVariant = "bordered" | "plain"
type EmptyStateSize = "sm" | "default" | "lg"

type EmptyStateProps = Omit<React.ComponentProps<"div">, "title"> & {
  icon?: LucideIcon
  title: string
  description?: React.ReactNode
  /** Usually one Button; rendered below the description. */
  action?: React.ReactNode
  /**
   * `bordered` (default) is a dashed `rounded-xl` box, for an empty slot on a
   * page or in a tab. `plain` has no frame, for a pane that is itself empty
   * (a workbench column, the tree, the flow canvas); size it with `className`
   * (`h-full`, `flex-1`).
   */
  variant?: EmptyStateVariant
  /**
   * `sm` is for narrow panes: the description drops to `text-xs`.
   * `lg` is a page-level statement: a bare icon, a `text-lg` title, and more
   * room around it.
   */
  size?: EmptyStateSize
  /** The title's element. Use `h2` when it heads the page, `p` when it
   * shouldn't enter the heading outline. */
  titleAs?: "h2" | "h3" | "p"
}

const SIZE_CLASSES: Record<
  EmptyStateSize,
  { root: string; title: string; description: string; action: string }
> = {
  sm: {
    root: "p-6",
    title: "text-sm font-medium",
    description: "mt-1 max-w-60 text-xs leading-5",
    action: "mt-4",
  },
  default: {
    root: "p-6",
    title: "text-sm font-medium",
    description: "mt-1 max-w-sm text-sm leading-6",
    action: "mt-4",
  },
  lg: {
    root: "px-6 py-12",
    title: "text-lg font-semibold",
    description: "mt-2 max-w-md text-sm leading-6",
    action: "mt-6",
  },
}

/**
 * The one empty state: an icon, a title, an optional description and action.
 * Anything passed as `children` renders last (a status note, an error).
 */
function EmptyState({
  className,
  icon: Icon,
  title,
  description,
  action,
  variant = "bordered",
  size = "default",
  titleAs: Title = "h3",
  children,
  ...props
}: EmptyStateProps) {
  const classes = SIZE_CLASSES[size]
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        variant === "bordered" && "rounded-xl border border-dashed bg-card/40",
        classes.root,
        className
      )}
      {...props}
    >
      {Icon &&
        (size === "lg" ? (
          <Icon
            className="mb-4 size-7 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        ) : (
          <div
            className={cn(
              "mb-3 flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground",
              variant === "bordered" ? "border bg-background" : "bg-muted"
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
          </div>
        ))}
      <Title className={cn("break-words text-foreground", classes.title)}>
        {title}
      </Title>
      {description && (
        <p
          className={cn(
            "break-words text-muted-foreground",
            classes.description
          )}
        >
          {description}
        </p>
      )}
      {action && <div className={classes.action}>{action}</div>}
      {children && (
        <div className="mt-3 flex flex-col items-center gap-2">{children}</div>
      )}
    </div>
  )
}

export { EmptyState }

import { Fragment, type ComponentType, type ReactNode } from "react";
import { ChevronLeft, Info, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/features/status/status-badge";
import type { StatusMeta } from "@/features/status/status-meta";
import { cn } from "@/lib/utils";

// Presentational building blocks for the phone drill-down (functions →
// departments → processes → detail), used below `lg`. These are pure,
// prop-driven components with no app/query state. Lists stay readable on a
// portrait tablet by centring in a column the width of a large phone.

const COLUMN_WIDTH = "mx-auto w-full max-w-3xl";

export type ColumnItemAction = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onSelect: () => void;
  destructive?: boolean;
};

// --- Column Item ---

export function ColumnItem({
  label,
  selected,
  count,
  countLabel,
  detail,
  status,
  onOpen,
  onPreview,
  actions = [],
}: {
  label: string;
  selected: boolean;
  /** Child count for parent rows. */
  count?: number;
  /** Spoken in place of the bare count, e.g. "3 departments". */
  countLabel?: string;
  /** Muted second line, e.g. "3 interviews". */
  detail?: string;
  /** Shown on the second line, as a badge with its label. */
  status?: StatusMeta | null;
  /** Tapping the row drills in. */
  onOpen: () => void;
  /** The info button: the item's overview in a sheet, without drilling in. */
  onPreview: () => void;
  /** Edit, Delete and the like, in the row's "…" menu. */
  actions?: ColumnItemAction[];
}) {
  const iconButtonClass =
    "inline-flex size-10 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-org-accent-subtle focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-org-accent-ring/35";

  return (
    <div
      className={cn(
        "flex min-h-14 w-full items-center rounded-lg border border-transparent transition-all",
        selected
          ? "border border-org-accent-border bg-org-accent-selected text-org-accent-selected-foreground shadow-sm ring-1 ring-org-accent-border"
          : "text-foreground hover:bg-org-accent-subtle hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-l-lg px-4 py-3 text-left text-base font-medium outline-none focus-visible:ring-3 focus-visible:ring-org-accent-ring/35"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          {/* Wraps rather than truncating: a touch screen can't show a
              tooltip with the rest of the name. */}
          <span className="line-clamp-2 break-words">{label}</span>
          {(detail || status) && (
            <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs font-normal text-muted-foreground">
              {detail && <span className="truncate">{detail}</span>}
              {status && <StatusBadge meta={status} />}
            </span>
          )}
        </span>
        {count !== undefined && count > 0 && (
          <span
            className={cn(
              "shrink-0 text-sm tabular-nums",
              selected
                ? "text-org-accent-selected-foreground/70"
                : "text-muted-foreground",
            )}
          >
            <span aria-hidden="true">{count}</span>
            <span className="sr-only">{countLabel ?? count}</span>
          </span>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-0.5 pr-1.5">
        {actions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className={iconButtonClass}
                  aria-label={`Actions for ${label}`}
                />
              }
            >
              <MoreHorizontal className="size-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-44">
              {actions.map((action, index) => {
                const Icon = action.icon;
                const previous = actions[index - 1];
                return (
                  <Fragment key={action.label}>
                    {action.destructive && previous && !previous.destructive && (
                      <DropdownMenuSeparator />
                    )}
                    <DropdownMenuItem
                      variant={action.destructive ? "destructive" : "default"}
                      className="min-h-10"
                      onClick={action.onSelect}
                    >
                      <Icon className="size-4" />
                      {action.label}
                    </DropdownMenuItem>
                  </Fragment>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <button
          type="button"
          onClick={onPreview}
          className={iconButtonClass}
          aria-label={`Preview ${label}`}
        >
          <Info className="size-5" />
        </button>
      </div>
    </div>
  );
}

// --- Back Bar ---

/** The phone drill-down's way up a level, named for where it goes. */
export function BackBar({
  label,
  onBack,
  contained = true,
}: {
  label: string;
  onBack: () => void;
  /** Centre the button over a column list; the process detail is full width. */
  contained?: boolean;
}) {
  return (
    <div className="shrink-0 border-b bg-background px-2 py-2">
      <div className={cn(contained && COLUMN_WIDTH)}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="min-h-10 max-w-full gap-2 px-3 text-sm"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="truncate">{label}</span>
        </Button>
      </div>
    </div>
  );
}

// --- Column List ---

export function ColumnList({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto scrollbar-hide">
      <div className={cn(COLUMN_WIDTH, "space-y-2 p-3")}>{children}</div>
    </div>
  );
}

// --- Empty State ---

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="rounded-xl bg-muted/60 p-4">
        <Icon className="h-7 w-7 text-muted-foreground/70" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <p className="max-w-[200px] text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {actionLabel && onAction && (
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onAction}>
          <Plus className="h-3.5 w-3.5" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

// --- Column Header ---

export function ColumnHeader({
  title,
  count,
  onAdd,
  addLabel,
}: {
  title: string;
  count?: number;
  onAdd?: () => void;
  /** Names the add button, e.g. "Add process". */
  addLabel?: string;
}) {
  return (
    <div className="shrink-0 border-b bg-background px-4 py-3.5">
      <div className={cn(COLUMN_WIDTH, "flex items-center justify-between")}>
        <h2 className="text-[0.8rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {title}
        </h2>
        <div className="flex min-h-9 items-center gap-2">
          {count !== undefined && (
            <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground">
              {count}
            </span>
          )}
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-org-accent-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-org-accent-ring/35"
              title={addLabel}
              aria-label={addLabel}
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Loading Spinner ---

export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-org-accent/30 border-t-org-accent" />
    </div>
  );
}

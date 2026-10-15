import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STATUS_TONE_TEXT, type StatusMeta } from "./status-meta";

/**
 * A status as its icon alone, for rows too narrow for a label. Each status has
 * its own icon shape, so it still isn't colour alone; the label is the tooltip
 * and is read out with the row.
 */
export function StatusIcon({
  meta,
  className,
}: {
  meta: StatusMeta;
  className?: string;
}) {
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center",
        STATUS_TONE_TEXT[meta.tone],
        className,
      )}
      title={meta.label}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "size-3.5",
          meta.busy && "animate-spin motion-reduce:animate-none",
        )}
      />
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}

/** A status as icon plus label, in its tone. Never colour alone. */
export function StatusBadge({
  meta,
  className,
  ...props
}: Omit<ComponentProps<typeof Badge>, "tone" | "variant" | "children"> & {
  meta: StatusMeta;
}) {
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone} className={cn("gap-1", className)} {...props}>
      <Icon
        aria-hidden="true"
        className={cn(meta.busy && "animate-spin motion-reduce:animate-none")}
      />
      {meta.label}
    </Badge>
  );
}

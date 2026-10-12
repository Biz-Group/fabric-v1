"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Marks a feature as an early preview; hover explains what that means. */
export function AlphaBadge({
  className,
  side = "bottom",
  focusable = false,
}: {
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  /** Off inside links, where the link itself already takes focus. */
  focusable?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="outline"
            tabIndex={focusable ? 0 : undefined}
            className={cn(
              "h-4 cursor-default border-org-accent-border bg-org-accent-subtle px-1.5 text-[10px] font-semibold uppercase tracking-wide text-org-accent",
              className,
            )}
          />
        }
      >
        Alpha
      </TooltipTrigger>
      <TooltipContent side={side}>
        This feature is an early preview. The final version can differ.
      </TooltipContent>
    </Tooltip>
  );
}

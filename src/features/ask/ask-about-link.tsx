"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { buttonVariants } from "@/components/ui/button";
import { useWorkspaceRoutes } from "@/features/shell/use-workspace-routes";
import { cn } from "@/lib/utils";
import { askAboutHref, type AskContextRef } from "./ask-context";
import { AskThinkingMark } from "./ask-thinking-mark";

/**
 * Where "Ask about this" leads for an entity (Phase 2B.1), or null while
 * AskFabric is unavailable in the workspace, so the action never shows there.
 */
export function useAskAboutHref(ref: AskContextRef | null): string | null {
  const availability = useQuery(api.ask.getAvailability);
  const { askHref } = useWorkspaceRoutes();
  if (!ref || !availability?.available) return null;
  return askAboutHref(askHref, ref);
}

/**
 * The command palette's AskFabric row (Phase 2B.2), or undefined while
 * AskFabric is unavailable. It opens AskFabric with the query in the
 * composer, not sent, about the entity selected in the workbench, if any.
 */
export function useAskPaletteAction(ref: AskContextRef | null, contextName: string | null) {
  const availability = useQuery(api.ask.getAvailability);
  const { askHref } = useWorkspaceRoutes();
  const router = useRouter();
  const available = availability?.available === true;
  const kind = ref?.kind;
  const id = ref?.id;
  return useMemo(
    () =>
      available
        ? {
            onAsk: (query: string) => router.push(askAboutHref(askHref, kind && id ? { kind, id } : null, query)),
            contextName: kind && id ? contextName : null,
          }
        : undefined,
    [available, askHref, router, kind, id, contextName],
  );
}

/**
 * "Ask about this" on a process, department or function header. A link, so
 * Back from AskFabric returns to the page and modifier-click opens a tab.
 */
export function AskAboutButton({ href, className }: { href: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        buttonVariants({ variant: "ghost" }),
        "min-h-10 justify-start gap-2 px-2.5 text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <AskThinkingMark still className="size-4 text-org-accent" />
      Ask about this
    </Link>
  );
}

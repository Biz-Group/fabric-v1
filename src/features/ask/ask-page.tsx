"use client";

import { useMutation, useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { MessagesSquare } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceAppShell } from "@/features/shell/process-app-shell";
import { AskConversation } from "./ask-conversation";
import { AskThreadList } from "./ask-thread-list";

const THREAD_PARAM = "thread";

/**
 * The beta's daily allowance (D51) beside the page title, all day rather than
 * only once it runs low. Hidden where members have no per-day limit.
 */
function AllowanceMeter() {
  const allowance = useQuery(api.ask.getDailyAllowance);
  if (!allowance || allowance.limit === null || allowance.limit <= 0 || allowance.remaining === null) return null;
  const { limit } = allowance;
  // Once the workspace's limit is used, nobody has questions left today.
  const remaining = allowance.orgLimitReached ? 0 : allowance.remaining;
  return (
    <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
      <div
        role="meter"
        aria-label="AskFabric questions left today"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={remaining}
        aria-valuetext={`${remaining} of ${limit}`}
        className="h-1 w-10 overflow-hidden rounded-full bg-muted sm:w-16"
      >
        <div
          className="h-full rounded-full bg-org-accent transition-[width] motion-reduce:transition-none"
          style={{ width: `${(remaining / limit) * 100}%` }}
        />
      </div>
      <span className="sm:hidden" aria-hidden>
        {remaining} left
      </span>
      <span className="max-sm:hidden" aria-hidden>
        {remaining} of {limit} questions left today
      </span>
    </div>
  );
}

function AskWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [threadsOpen, setThreadsOpen] = useState(false);
  const markVisited = useMutation(api.askSuggestions.markVisited);
  // Records the visit and refreshes stale starter prompts (FR-6.3).
  useEffect(() => {
    void markVisited({}).catch(() => {});
  }, [markVisited]);
  const threadId = (searchParams.get(THREAD_PARAM) as Id<"askThreads"> | null) ?? null;

  // The thread lives in the URL, so Back from a citation returns to it (FR-5.6).
  const selectThread = (next: Id<"askThreads"> | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set(THREAD_PARAM, next);
    else params.delete(THREAD_PARAM);
    const search = params.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    setThreadsOpen(false);
  };

  const list = (
    <AskThreadList
      selectedThreadId={threadId}
      onSelect={(next) => selectThread(next)}
      onNewThread={() => selectThread(null)}
    />
  );

  return (
    <WorkspaceAppShell
      title="AskFabric"
      headerActions={
        <>
          <AllowanceMeter />
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setThreadsOpen(true)}>
            <MessagesSquare className="size-4" aria-hidden />
            {/* Icon only on phones, so the page title keeps its room. */}
            <span className="max-sm:sr-only">Threads</span>
          </Button>
        </>
      }
    >
      <aside className="hidden w-72 shrink-0 flex-col border-r lg:flex" aria-label="AskFabric threads">
        {list}
      </aside>
      <Sheet open={threadsOpen} onOpenChange={setThreadsOpen}>
        <SheetContent side="left" className="flex w-[85vw] max-w-sm flex-col gap-0 p-0">
          <SheetHeader className="border-b">
            <SheetTitle>Threads</SheetTitle>
            <SheetDescription className="sr-only">Your AskFabric threads</SheetDescription>
          </SheetHeader>
          {list}
        </SheetContent>
      </Sheet>
      <section className="flex min-w-0 flex-1 flex-col" aria-label="Conversation">
        {/* Keyed so switching threads resets the pane, the trace state and the composer. */}
        <AskConversation key={threadId ?? "new"} threadId={threadId} onThreadCreated={(id) => selectThread(id)} />
      </section>
    </WorkspaceAppShell>
  );
}

function Unavailable() {
  return (
    <WorkspaceAppShell title="AskFabric">
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-base font-semibold text-foreground">AskFabric is unavailable</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          It isn&apos;t switched on for this workspace yet. Ask a workspace admin if you expected to see it.
        </p>
      </div>
    </WorkspaceAppShell>
  );
}

/** The `/ask` page (FR-4.1), shown only where AskFabric is available (FR-9.6). */
export function AskPage() {
  const availability = useQuery(api.ask.getAvailability);
  return (
    <TooltipProvider>
      <div className="h-dvh">
        {availability === undefined ? (
          <LoadingScreen message="Loading AskFabric…" />
        ) : !availability.available ? (
          <Unavailable />
        ) : (
          // useSearchParams needs a Suspense boundary for the production build.
          <Suspense fallback={<LoadingScreen message="Loading AskFabric…" />}>
            <AskWorkspace />
          </Suspense>
        )}
      </div>
    </TooltipProvider>
  );
}

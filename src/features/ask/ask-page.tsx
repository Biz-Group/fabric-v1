"use client";

import { useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
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

function AskWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [threadsOpen, setThreadsOpen] = useState(false);
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
        <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setThreadsOpen(true)}>
          <MessagesSquare className="size-4" aria-hidden />
          Threads
        </Button>
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

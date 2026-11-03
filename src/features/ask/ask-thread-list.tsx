"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Trash2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { formatRelativeTime } from "@/features/home/home-view-model";
import { describeError } from "@/lib/user-error-message";
import { cn } from "@/lib/utils";

type ThreadRow = {
  _id: Id<"askThreads">;
  title: string;
  status: "active" | "archived" | "deleting";
  pinnedAt: number | null;
  lastMessageAt: number;
};

function useThreadActions() {
  const rename = useMutation(api.askThreads.renameThread);
  const setPinned = useMutation(api.askThreads.setPinned);
  const setArchived = useMutation(api.askThreads.setArchived);
  const remove = useMutation(api.askThreads.deleteThread);
  const run = async (action: Promise<unknown>, failure: string) => {
    try {
      await action;
    } catch (error) {
      toast.error(describeError(error, failure));
      throw error;
    }
  };
  return {
    rename: (threadId: Id<"askThreads">, title: string) => run(rename({ threadId, title }), "Couldn't rename the thread."),
    pin: (threadId: Id<"askThreads">, pinned: boolean) => run(setPinned({ threadId, pinned }), "Couldn't change the pin."),
    archive: (threadId: Id<"askThreads">, archived: boolean) =>
      run(setArchived({ threadId, archived }), "Couldn't archive the thread."),
    remove: (threadId: Id<"askThreads">) => run(remove({ threadId }), "Couldn't delete the thread."),
  };
}

function ThreadItem({
  thread,
  selected,
  onSelect,
  onRename,
  onDelete,
}: {
  thread: ThreadRow;
  selected: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const actions = useThreadActions();
  const pinned = thread.pinnedAt !== null;
  const archived = thread.status === "archived";
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "page" : undefined}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-md py-2 pr-9 pl-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
          selected && "bg-muted",
        )}
      >
        <span className="flex items-center gap-1.5 truncate text-sm text-foreground">
          {pinned && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" />}
          <span className="truncate">{thread.title}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(thread.lastMessageAt)}
          {archived ? " · Archived" : ""}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Actions for ${thread.title}`}
              className="absolute top-2 right-1.5 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 sm:data-[popup-open]:opacity-100"
            />
          }
        >
          <MoreHorizontal className="size-3.5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={onRename}>
            <Pencil className="size-4" aria-hidden />
            Rename
          </DropdownMenuItem>
          {!archived && (
            <DropdownMenuItem onClick={() => void actions.pin(thread._id, !pinned).catch(() => {})}>
              {pinned ? <PinOff className="size-4" aria-hidden /> : <Pin className="size-4" aria-hidden />}
              {pinned ? "Unpin" : "Pin"}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => void actions.archive(thread._id, !archived).catch(() => {})}>
            {archived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
            {archived ? "Unarchive" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 className="size-4" aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function RenameDialog({ thread, onClose }: { thread: ThreadRow | null; onClose: () => void }) {
  const actions = useThreadActions();
  // Keyed on the thread by its parent, so this starts from that thread's title.
  const [title, setTitle] = useState(thread?.title ?? "");
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={thread !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename thread</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!thread) return;
            setPending(true);
            try {
              await actions.rename(thread._id, title);
              onClose();
            } catch {
              // Toasted by the action.
            } finally {
              setPending(false);
            }
          }}
        >
          <Input
            aria-label="Thread name"
            value={title}
            maxLength={120}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The caller's threads (FR-3.2, FR-3.3, FR-3.5): pinned first, then by latest
 * activity, 25 at a time, with title search and an archived view. Owner-only
 * by construction: every query reads the caller's own threads.
 */
export function AskThreadList({
  selectedThreadId,
  onSelect,
  onNewThread,
}: {
  selectedThreadId: Id<"askThreads"> | null;
  onSelect: (threadId: Id<"askThreads">) => void;
  onNewThread: () => void;
}) {
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<ThreadRow | null>(null);
  const [deleting, setDeleting] = useState<ThreadRow | null>(null);
  const actions = useThreadActions();
  const searching = query.trim().length > 0;

  const pinned = useQuery(api.askThreads.listPinned, archived || searching ? "skip" : {});
  const { results, status, loadMore } = usePaginatedQuery(
    api.askThreads.listThreads,
    searching ? "skip" : { archived },
    { initialNumItems: 25 },
  );
  const hits = useQuery(api.askThreads.searchThreads, searching ? { query } : "skip");

  const rows: ThreadRow[] = searching ? (hits ?? []) : [...(pinned ?? []), ...results];
  const loading = searching ? hits === undefined : status === "LoadingFirstPage";

  const item = (thread: ThreadRow) => (
    <ThreadItem
      key={thread._id}
      thread={thread}
      selected={thread._id === selectedThreadId}
      onSelect={() => onSelect(thread._id)}
      onRename={() => setRenaming(thread)}
      onDelete={() => setDeleting(thread)}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 p-3">
        <Button className="w-full justify-start" variant="outline" onClick={onNewThread}>
          <Plus className="size-4" aria-hidden />
          New thread
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search threads"
            aria-label="Search threads"
            className="h-8 pl-8"
          />
        </div>
      </div>
      <nav aria-label="Threads" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            {searching ? "No threads match." : archived ? "No archived threads." : "No threads yet."}
          </p>
        ) : (
          <ul className="space-y-0.5">{rows.map(item)}</ul>
        )}
        {!searching && status === "CanLoadMore" && (
          <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => loadMore(25)}>
            Load more
          </Button>
        )}
      </nav>
      {!searching && (
        <div className="border-t p-2">
          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => setArchived((value) => !value)}>
            {archived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
            {archived ? "Back to threads" : "Archived threads"}
          </Button>
        </div>
      )}
      <RenameDialog key={renaming?._id ?? "none"} thread={renaming} onClose={() => setRenaming(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this thread?"
        description="The thread, its answers and any feedback are deleted for good."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          await actions.remove(deleting._id);
          if (deleting._id === selectedThreadId) onNewThread();
        }}
      />
    </div>
  );
}

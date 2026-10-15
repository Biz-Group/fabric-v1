"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useConvex,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Bot,
  Download,
  Mic,
  MoreHorizontal,
  RotateCcw,
  Search,
  Tag,
  Trash2,
  Upload,
} from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

type ConversationRow = FunctionReturnType<
  typeof api.conversations.listAllForOrg
>["page"][number];
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ConversationTranscriptDialog } from "@/features/admin/conversation-transcript-dialog";
import {
  buildConversationsCsv,
  downloadCsv,
} from "@/features/admin/conversations-export";
import {
  retryLabel,
  useRetryConversation,
} from "@/features/conversations/use-retry-conversation";
import { useWorkspaceRoutes } from "@/features/shell/use-workspace-routes";
import { StatusBadge } from "@/features/status/status-badge";
import { describeConversationFailure } from "@/features/status/conversation-failure";
import { conversationStatusMeta } from "@/features/status/status-meta";
import { processConversationHref } from "@/features/workbench/use-selection-params";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLastLoaded } from "@/hooks/use-last-loaded";
import { describeError } from "@/lib/user-error-message";
import { cn } from "@/lib/utils";

type Status = "processing" | "needs_speaker_labels" | "done" | "failed";
type StatusFilter = "all" | Status;

const PAGE_SIZE = 50;
// Search returns the newest matches rather than a paginated stream; export
// asks for the server's maximum.
const SEARCH_EXPORT_LIMIT = 200;
const NO_ROWS: ConversationRow[] = [];

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Secondary columns drop out on narrower screens so the contributor, status
// and row actions always fit. Header and cells share these, so a hidden column
// never leaves its header behind.
const COLUMN_CLASS = {
  created: "hidden sm:table-cell",
  type: "hidden xl:table-cell",
  process: "hidden sm:table-cell",
  duration: "hidden xl:table-cell",
};

const STATUS_FILTER_ITEMS: Record<StatusFilter, string> = {
  all: "All statuses",
  done: conversationStatusMeta.done.label,
  processing: conversationStatusMeta.processing.label,
  needs_speaker_labels: conversationStatusMeta.needs_speaker_labels.label,
  failed: conversationStatusMeta.failed.label,
};

function getConversationTypeLabel(inputMode: ConversationRow["inputMode"]) {
  if (inputMode === "voiceRecord") return "Voice Recording";
  if (inputMode === "audioUpload") return "Audio Upload";
  return "AI Interview";
}

function ConversationTypeBadge({
  inputMode,
}: {
  inputMode: ConversationRow["inputMode"];
}) {
  const isAgent = (inputMode ?? "agent") === "agent";
  const Icon =
    inputMode === "audioUpload" ? Upload : isAgent ? Bot : Mic;

  return (
    <Badge variant="secondary" className="gap-1.5">
      <Icon />
      {getConversationTypeLabel(inputMode)}
    </Badge>
  );
}

export default function AdminConversationsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const routes = useWorkspaceRoutes();
  const initialStatus = useMemo<StatusFilter>(() => {
    const fromUrl = searchParams.get("status");
    if (
      fromUrl === "done" ||
      fromUrl === "processing" ||
      fromUrl === "needs_speaker_labels" ||
      fromUrl === "failed"
    ) {
      return fromUrl;
    }
    return "all";
  }, [searchParams]);
  const processIdFilter = useMemo(() => {
    const fromUrl = searchParams.get("processId");
    return fromUrl ? (fromUrl as Id<"processes">) : null;
  }, [searchParams]);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus);
  const [search, setSearch] = useState("");
  const [viewingId, setViewingId] = useState<Id<"conversations"> | null>(null);
  const [pendingDelete, setPendingDelete] =
    useState<Id<"conversations"> | null>(null);
  const [exporting, setExporting] = useState(false);

  const me = useQuery(api.users.getMyMembership);

  const queryArgs = useMemo(() => {
    const args: { status?: Status; processId?: Id<"processes"> } = {};
    if (statusFilter !== "all") args.status = statusFilter as Status;
    if (processIdFilter) args.processId = processIdFilter;
    return args;
  }, [processIdFilter, statusFilter]);

  // Search runs on the server across every contribution, not just the
  // loaded page, so it switches from the paginated list to a search query.
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const searching = debouncedSearch.length > 0;
  const { results, status, loadMore } = usePaginatedQuery(
    api.conversations.listAllForOrg,
    searching ? "skip" : queryArgs,
    { initialNumItems: PAGE_SIZE },
  );
  const searchResult = useQuery(
    api.conversations.searchForOrg,
    searching ? { ...queryArgs, search: debouncedSearch } : "skip",
  );
  const loadingRows = searching
    ? searchResult === undefined
    : status === "LoadingFirstPage";
  // Keep the previous rows on screen while a new search or filter loads, so
  // the table updates in place.
  const rows = useLastLoaded(
    searching ? (searchResult?.page ?? NO_ROWS) : results,
    loadingRows,
  );
  const refreshing = loadingRows && rows.length > 0;
  const truncated = searching && searchResult?.truncated === true;

  const convex = useConvex();
  const deleteConversation = useMutation(api.conversations.deleteForAdmin);
  const { retry, retryingId } = useRetryConversation();

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteConversation({ conversationId: pendingDelete });
      toast.success("Conversation deleted.");
    } catch (err) {
      toast.error(describeError(err, "Failed to delete conversation."));
      throw err;
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const exported: ConversationRow[] = [];
      let exportTruncated = false;
      if (searching) {
        const result = await convex.query(api.conversations.searchForOrg, {
          ...queryArgs,
          search: debouncedSearch,
          limit: SEARCH_EXPORT_LIMIT,
        });
        exported.push(...result.page);
        exportTruncated = result.truncated;
      } else {
        let cursor: string | null = null;
        for (;;) {
          const result: FunctionReturnType<
            typeof api.conversations.listAllForOrg
          > = await convex.query(api.conversations.listAllForOrg, {
            ...queryArgs,
            paginationOpts: { numItems: 500, cursor },
          });
          exported.push(...result.page);
          if (result.isDone) break;
          cursor = result.continueCursor;
        }
      }
      const csv = buildConversationsCsv(exported);
      const slug = me?.orgSlug || "workspace";
      const date = new Date().toISOString().slice(0, 10);
      downloadCsv(`conversations-${slug}-${date}.csv`, csv);
      if (exportTruncated) {
        toast.warning(
          `Exported the ${exported.length} newest matches. Narrow the search to export the rest.`,
        );
      } else {
        toast.success(`Exported ${exported.length} conversations.`);
      }
    } catch (err) {
      toast.error(describeError(err, "Export failed."));
    } finally {
      setExporting(false);
    }
  };

  const filtersActive = statusFilter !== "all" || processIdFilter !== null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Conversations</h2>
          <p className="text-sm text-muted-foreground">
            Review and manage every voice conversation captured in this
            workspace.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={exporting || loadingRows || rows.length === 0}
        >
          <Download />
          {exporting ? "Exporting…" : "Export CSV"}
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search contributor, process, title, or summary…"
            aria-label="Search conversations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          items={STATUS_FILTER_ITEMS}
          onValueChange={(val) => setStatusFilter(val as StatusFilter)}
        >
          <SelectTrigger size="sm" className="w-[160px]" aria-label="Status filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(STATUS_FILTER_ITEMS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {processIdFilter && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.replace(routes.adminConversationsHref)}
          >
            Clear process filter
          </Button>
        )}
      </div>

      <div
        className={cn(
          "rounded-lg border transition-opacity",
          refreshing && "opacity-60",
        )}
        aria-busy={loadingRows}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={COLUMN_CLASS.created}>Created</TableHead>
              <TableHead>Contributor</TableHead>
              <TableHead className={COLUMN_CLASS.type}>Type</TableHead>
              <TableHead className={COLUMN_CLASS.process}>Process</TableHead>
              <TableHead className={COLUMN_CLASS.duration}>Duration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-24 text-center text-muted-foreground"
                >
                  {loadingRows ? (
                    <div
                      className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary"
                      role="status"
                      aria-label="Loading conversations"
                    />
                  ) : searching ? (
                    "No conversations match your search."
                  ) : filtersActive ? (
                    "No contributions match these filters."
                  ) : (
                    "No conversations yet."
                  )}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const href = processConversationHref(routes.appHref, r);
                const failure =
                  r.status === "failed"
                    ? describeConversationFailure(r.failureReason)
                    : null;
                const retryTarget = {
                  _id: r._id,
                  inputMode: r.inputMode,
                  hasTranscript: Boolean(r.transcript?.length),
                };
                return (
                  <TableRow
                    key={r._id}
                    className="cursor-pointer"
                    onClick={(event) => {
                      // Menu items are portaled but still bubble here through
                      // React; only plain clicks on the row open it.
                      const target = event.target as HTMLElement;
                      if (
                        !event.currentTarget.contains(target) ||
                        target.closest("a, button, [role='menuitem']")
                      ) {
                        return;
                      }
                      setViewingId(r._id);
                    }}
                  >
                    <TableCell
                      className={cn(COLUMN_CLASS.created, "text-muted-foreground")}
                    >
                      {formatDate(r._creationTime)}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <button
                        type="button"
                        className="rounded-sm text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setViewingId(r._id)}
                      >
                        {r.contributorName}
                      </button>
                      {/* Stands in for the Process and Created columns,
                          which are hidden below sm. */}
                      <span className="block text-xs text-muted-foreground sm:hidden">
                        {[r.processName, formatDate(r._creationTime)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </TableCell>
                    <TableCell className={COLUMN_CLASS.type}>
                      <ConversationTypeBadge inputMode={r.inputMode} />
                    </TableCell>
                    <TableCell
                      className={cn(COLUMN_CLASS.process, "whitespace-normal")}
                    >
                      <div className="flex flex-col">
                        {href ? (
                          <Link
                            href={href}
                            className="w-fit rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {r.processName}
                          </Link>
                        ) : (
                          <span>{r.processName ?? "—"}</span>
                        )}
                        {r.functionName && r.departmentName && (
                          <span className="text-xs text-muted-foreground">
                            {r.functionName} · {r.departmentName}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell
                      className={cn(COLUMN_CLASS.duration, "text-muted-foreground")}
                    >
                      {formatDuration(r.durationSeconds)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge meta={conversationStatusMeta[r.status]} />
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon-sm" />}
                        >
                          <MoreHorizontal />
                          <span className="sr-only">
                            Actions for {r.contributorName}&apos;s conversation
                          </span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setViewingId(r._id)}>
                            View transcript
                          </DropdownMenuItem>
                          {href && r.status === "needs_speaker_labels" && (
                            <DropdownMenuItem onClick={() => router.push(href)}>
                              <Tag />
                              Label speakers
                            </DropdownMenuItem>
                          )}
                          {href && r.status !== "needs_speaker_labels" && (
                            <DropdownMenuItem onClick={() => router.push(href)}>
                              <ArrowUpRight />
                              Open in process
                            </DropdownMenuItem>
                          )}
                          {failure?.retryable && (
                            <DropdownMenuItem
                              onClick={() => void retry(retryTarget)}
                              disabled={retryingId === r._id}
                            >
                              <RotateCcw />
                              {retryingId === r._id
                                ? "Retrying…"
                                : retryLabel(retryTarget)}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setPendingDelete(r._id)}
                          >
                            <Trash2 />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {searching
            ? truncated
              ? `Showing the ${rows.length} newest matches. Refine the search to narrow it down.`
              : `${rows.length} match${rows.length === 1 ? "" : "es"}`
            : `${rows.length} shown`}
        </p>
        {!searching && status === "CanLoadMore" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadMore(PAGE_SIZE)}
          >
            Load more
          </Button>
        )}
        {!searching && status === "LoadingMore" && (
          <p className="text-xs text-muted-foreground">Loading more…</p>
        )}
      </div>

      <ConversationTranscriptDialog
        conversationId={viewingId}
        open={viewingId !== null}
        onOpenChange={(open) => {
          if (!open) setViewingId(null);
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete this conversation?"
        description="The transcript, summary, and audio metadata will be permanently removed. The parent process summary will be regenerated. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}

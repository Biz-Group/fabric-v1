"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  ChevronDown,
  Clock,
  FileText,
  Mic,
  PlayCircle,
  Upload,
  User,
  UserCheck,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { conversationTitle as storedConversationTitle } from "../../../convex/lib/conversationTitle";
import { FocusedConversationPlayback } from "@/features/conversations/conversation-log";
import type { RecordingMode } from "@/features/recording/recording-modal";
import {
  isStackedBelow,
  scrollIntoNearestScroller,
} from "@/features/conversations/playback-layout";
import { StatusBadge } from "@/features/status/status-badge";
import {
  conversationStatusMeta,
  STATUS_TONE_SURFACE,
} from "@/features/status/status-meta";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const INITIAL_PAGE_SIZE = 10;
const LOAD_MORE_PAGE_SIZE = 20;

type CompactConversation = FunctionReturnType<
  typeof api.conversations.listPageByProcess
>["page"][number];
type ConversationStatus = CompactConversation["status"];
type ConversationInputMode = CompactConversation["inputMode"];
type StatusFilter = "all" | ConversationStatus;
type TypeFilter = "all" | ConversationInputMode;
type SortOrder = "newest" | "oldest";

type ProcessConversationListProps = {
  processId: Id<"processes">;
  canLabelSpeakers: boolean;
  /** Admins can retry failed contributions from the playback panel. */
  canRetry: boolean;
  labelingJumpKey?: number;
  focusConversationId?: Id<"conversations"> | null;
  focusConversationJumpKey?: number;
  /** Opens capture in a mode. Left out for people who can't contribute. */
  onCapture?: (mode: RecordingMode) => void;
};

const TYPE_META: Record<
  ConversationInputMode,
  { label: string; icon: LucideIcon }
> = {
  agent: { label: "AI interview", icon: Bot },
  voiceRecord: { label: "Voice note", icon: Mic },
  audioUpload: { label: "Uploaded recording", icon: Upload },
};

// Same names and order as the header's capture buttons.
const CAPTURE_ACTIONS: {
  mode: RecordingMode;
  label: string;
  icon: LucideIcon;
}[] = [
  { mode: "agent", label: "Start AI interview", icon: Bot },
  { mode: "voiceRecord", label: "Record a voice note", icon: Mic },
  { mode: "audioUpload", label: "Upload files", icon: Upload },
];

const STATUS_FILTER_ITEMS: Record<StatusFilter, string> = {
  all: "All contributions",
  done: conversationStatusMeta.done.label,
  processing: conversationStatusMeta.processing.label,
  needs_speaker_labels: conversationStatusMeta.needs_speaker_labels.label,
  failed: conversationStatusMeta.failed.label,
};

const TYPE_FILTER_ITEMS: Record<TypeFilter, string> = {
  all: "All types",
  agent: "AI interview",
  voiceRecord: "Voice note",
  audioUpload: "Uploaded recording",
};

const SORT_ORDER_ITEMS: Record<SortOrder, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
};

function formatDateTime(epochMs: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(epochMs));
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "--:--";
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function conversationTitleFromParts(
  inputMode: ConversationInputMode,
  contributorName: string,
) {
  return `${TYPE_META[inputMode].label} with ${contributorName}`;
}

/**
 * Prefers the one-line title from post-call analysis (ElevenLabs'
 * `call_summary_title` for interviews, our own model's for uploaded audio) so a
 * row says what was discussed. Rows still processing — or from a provider that
 * returned no title — fall back to the input mode + contributor phrasing.
 */
function conversationTitle(conversation: CompactConversation) {
  return (
    conversation.title?.trim() ||
    conversationTitleFromParts(
      conversation.inputMode,
      conversation.contributorName,
    )
  );
}

/** The row's title, for a contribution read in full rather than from the list. */
function playbackTitle(conversation: Doc<"conversations">) {
  return (
    storedConversationTitle(conversation) ||
    conversationTitleFromParts(
      conversation.inputMode ?? "agent",
      conversation.contributorName,
    )
  );
}

/** Whether a loaded row still shows under a status and type filter. */
function matchesFilters(
  conversation: CompactConversation,
  statusFilter: StatusFilter,
  typeFilter: TypeFilter,
) {
  return (
    (statusFilter === "all" || conversation.status === statusFilter) &&
    (typeFilter === "all" || conversation.inputMode === typeFilter)
  );
}

function LoadingRows() {
  return (
    <div role="status" className="space-y-3">
      <span className="sr-only">Loading contributions</span>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className={cardVariants({ padding: "sm" })}>
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="size-8 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ConversationRow({
  conversation,
  selected,
  onSelect,
  buttonRef,
}: {
  conversation: CompactConversation;
  selected: boolean;
  onSelect: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const type = TYPE_META[conversation.inputMode];
  const status = conversationStatusMeta[conversation.status];
  const TypeIcon = type.icon;
  const title = conversationTitle(conversation);
  // Rows that need something from someone are tinted in their status tone.
  const highlighted =
    conversation.status === "needs_speaker_labels" ||
    conversation.status === "failed";

  return (
    <div
      className={cn(
        cardVariants({
          padding: "none",
          className: "group flex min-h-24 items-stretch transition-colors",
        }),
        selected && "border-org-accent-border bg-org-accent-selected ring-1 ring-org-accent-border",
        highlighted && !selected && STATUS_TONE_SURFACE[status.tone],
      )}
    >
      <div className="flex shrink-0 items-start p-3 pr-0">
        {/* Carries the input mode, so the three capture types are told apart at
            the start of the row rather than by a second trailing icon. */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon-lg"
                className={cn(
                  "size-11 rounded-xl bg-background text-foreground shadow-none",
                  selected && "border-org-accent-border text-org-accent",
                )}
                aria-label={
                  conversation.hasAudio
                    ? `${type.label} — open audio for ${title}`
                    : `${type.label} — open details for ${title}`
                }
                onClick={onSelect}
              >
                <TypeIcon className="size-5" aria-hidden="true" />
              </Button>
            }
          />
          <TooltipContent>{type.label}</TooltipContent>
        </Tooltip>
      </div>
      <button
        ref={buttonRef}
        type="button"
        className="flex min-w-0 flex-1 items-start p-3 text-left focus-ring-inset"
        aria-expanded={selected}
        aria-current={selected ? "true" : undefined}
        aria-label={`${selected ? "Selected contribution" : "Open contribution"}: ${title}`}
        onClick={onSelect}
      >
        <span className="min-w-0 flex-1 space-y-2">
          <span className="grid min-w-0 gap-2 @sm/list:grid-cols-[minmax(0,1fr)_auto] @sm/list:items-center">
            <span className="line-clamp-2 min-w-0 max-w-full break-words text-sm font-medium text-foreground">
              {title}
            </span>
            <StatusBadge meta={status} />
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {/* The title now describes the conversation rather than naming the
                contributor, so the byline moves here. */}
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <User className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{conversation.contributorName}</span>
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Clock className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{formatDateTime(conversation._creationTime)}</span>
            </span>
            <span className="tabular-nums" title={conversation.durationSeconds === null ? "Duration unavailable" : undefined}>
              {formatDuration(conversation.durationSeconds)}
            </span>
            {/* Set only when an admin recorded on the contributor's behalf. The
                byline above names the contributor, so without this the entry
                reads as their own submission. */}
            {conversation.submittedByName && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <UserCheck className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  Submitted by {conversation.submittedByName}
                </span>
              </span>
            )}
          </span>
        </span>
      </button>
    </div>
  );
}

function ConversationPlaybackPanel({
  conversationId,
  conversation,
  canLabelSpeakers,
  canRetry,
  hasConversations,
}: {
  conversationId: Id<"conversations"> | null;
  /** Undefined while loading; null when the row is gone or out of reach. */
  conversation: Doc<"conversations"> | null | undefined;
  canLabelSpeakers: boolean;
  canRetry: boolean;
  hasConversations: boolean;
}) {
  if (!conversationId) {
    return (
      <section className="flex h-full min-h-72 flex-col bg-background">
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <EmptyState
            icon={hasConversations ? PlayCircle : Mic}
            title={hasConversations ? "Select a contribution" : "No contributions yet"}
            description={
              hasConversations
                ? "Playback and transcript review will appear in this panel."
                : "Playback and transcript review will appear here once this process has a contribution."
            }
            className="w-full border-0 bg-transparent"
          />
        </div>
      </section>
    );
  }

  if (conversation === undefined) {
    return (
      <section className="flex h-full min-h-72 flex-col bg-background">
        {/* The list beside it announces the load. */}
        <div className="space-y-4 p-4" aria-hidden="true">
          <div className="space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-12 w-full rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
      </section>
    );
  }

  if (conversation === null) {
    return (
      <section className="flex h-full min-h-72 flex-col bg-background">
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <EmptyState
            icon={FileText}
            title="Contribution unavailable"
            description="It may have been deleted or moved to another process."
            className="w-full border-0 bg-transparent"
          />
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-72 overflow-hidden bg-background">
      <FocusedConversationPlayback
        conversation={conversation}
        title={playbackTitle(conversation)}
        canLabelSpeakers={canLabelSpeakers}
        canRetry={canRetry}
      />
    </section>
  );
}

/**
 * Below `md` the columns stack and the playback sits under the whole list, so
 * picking a conversation would change nothing on screen. This brings the
 * playback up and moves focus to it. Returns false, doing nothing, when the
 * columns sit side by side or the tab isn't rendered (the workbench also
 * mounts a hidden copy for its other layout).
 */
function revealPlaybackIfStacked(
  list: HTMLElement | null,
  playback: HTMLElement | null,
) {
  if (!list || !playback || playback.getClientRects().length === 0) {
    return false;
  }
  if (
    !isStackedBelow(
      list.getBoundingClientRect(),
      playback.getBoundingClientRect(),
    )
  ) {
    return false;
  }
  scrollIntoNearestScroller(playback, "start");
  playback.focus({ preventScroll: true });
  return true;
}

export function ProcessConversationsTab({
  processId,
  canLabelSpeakers,
  canRetry,
  labelingJumpKey = 0,
  focusConversationId = null,
  focusConversationJumpKey = 0,
  onCapture,
}: ProcessConversationListProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  // May point past the loaded pages: a link opens its contribution whether or
  // not the list has reached it yet.
  const [selectedConversationId, setSelectedConversationId] =
    useState<Id<"conversations"> | null>(null);
  const handledLabelingJumpKey = useRef(0);
  const handledFocusConversationJumpKey = useRef(0);
  const revealedFocusConversationJumpKey = useRef(0);
  const conversationButtonRefs = useRef(
    new Map<Id<"conversations">, HTMLButtonElement>(),
  );
  const listRef = useRef<HTMLElement>(null);
  const playbackRef = useRef<HTMLElement>(null);
  // Changing a filter or the order changes the arguments, which starts the
  // list again from its first page.
  const {
    results: conversations,
    status: pageStatus,
    loadMore,
  } = usePaginatedQuery(
    api.conversations.listPageByProcess,
    {
      processId,
      status: statusFilter === "all" ? undefined : statusFilter,
      inputMode: typeFilter === "all" ? undefined : typeFilter,
      order: sortOrder,
    },
    { initialNumItems: INITIAL_PAGE_SIZE },
  );
  const loadingFirstPage = pageStatus === "LoadingFirstPage";
  const canLoadMore =
    pageStatus === "CanLoadMore" || pageStatus === "LoadingMore";

  // These respond to explicit header jump commands.
  useEffect(() => {
    if (
      !labelingJumpKey ||
      handledLabelingJumpKey.current === labelingJumpKey
    ) {
      return;
    }
    handledLabelingJumpKey.current = labelingJumpKey;

    // The status filter runs on the server, so the first row of the new list
    // is the newest contribution awaiting labels however old the rest are.
    setStatusFilter("needs_speaker_labels");
    setTypeFilter("all");
    setSelectedConversationId(null);
  }, [labelingJumpKey]);

  useEffect(() => {
    if (
      !focusConversationId ||
      !focusConversationJumpKey ||
      handledFocusConversationJumpKey.current === focusConversationJumpKey
    ) {
      return;
    }
    handledFocusConversationJumpKey.current = focusConversationJumpKey;

    setStatusFilter("all");
    setTypeFilter("all");
    setSelectedConversationId(focusConversationId);
  }, [focusConversationId, focusConversationJumpKey]);

  const hasFilters = statusFilter !== "all" || typeFilter !== "all";
  const activeConversationId =
    selectedConversationId ?? conversations[0]?._id ?? null;
  const activeListRow =
    conversations.find(
      (conversation) => conversation._id === activeConversationId,
    ) ?? null;
  const activeConversation = useQuery(
    api.conversations.getInProcess,
    activeConversationId
      ? { processId, conversationId: activeConversationId }
      : "skip",
  );
  // A linked contribution older than the loaded pages still plays; say why
  // the list doesn't show it.
  const activeOutsideList =
    activeConversationId !== null &&
    !loadingFirstPage &&
    activeListRow === null &&
    Boolean(activeConversation);

  useEffect(() => {
    if (
      !focusConversationId ||
      !focusConversationJumpKey ||
      handledFocusConversationJumpKey.current !== focusConversationJumpKey ||
      revealedFocusConversationJumpKey.current === focusConversationJumpKey ||
      activeConversationId !== focusConversationId ||
      loadingFirstPage
    ) {
      return;
    }
    revealedFocusConversationJumpKey.current = focusConversationJumpKey;

    // Stacked, the conversation the link points at is the playback, not the
    // row above it.
    if (revealPlaybackIfStacked(listRef.current, playbackRef.current)) return;

    // Not loaded yet, the link's contribution is only in the playback.
    const target = conversationButtonRefs.current.get(focusConversationId);
    if (target) {
      target.scrollIntoView({ block: "nearest" });
      target.focus({ preventScroll: true });
    } else {
      playbackRef.current?.focus({ preventScroll: true });
    }
  }, [
    activeConversationId,
    focusConversationId,
    focusConversationJumpKey,
    loadingFirstPage,
  ]);

  const selectConversation = (conversationId: Id<"conversations">) => {
    setSelectedConversationId(conversationId);
    revealPlaybackIfStacked(listRef.current, playbackRef.current);
  };

  // Keeps the open contribution when it still matches; otherwise the first
  // row of the new list takes over.
  const changeFilters = (
    nextStatusFilter: StatusFilter,
    nextTypeFilter: TypeFilter,
  ) => {
    setStatusFilter(nextStatusFilter);
    setTypeFilter(nextTypeFilter);
    if (
      !activeListRow ||
      !matchesFilters(activeListRow, nextStatusFilter, nextTypeFilter)
    ) {
      setSelectedConversationId(null);
    }
  };

  const loadMoreButton = canLoadMore && (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-2"
      disabled={pageStatus === "LoadingMore"}
      onClick={() => loadMore(LOAD_MORE_PAGE_SIZE)}
    >
      <ChevronDown className="size-3.5" aria-hidden="true" />
      {pageStatus === "LoadingMore" ? "Loading…" : "Load more"}
    </Button>
  );

  return (
    <TooltipProvider>
      {/* Splits on the detail panel's width, not the viewport's: beside the
          sidebar and tree the panel can be far narrower than the screen. */}
      <div className="grid min-h-full min-w-0 gap-0 @3xl/detail:h-full @3xl/detail:min-h-0 @3xl/detail:grid-cols-2">
        <section
          ref={listRef}
          className="@container/list min-w-0 p-4 @3xl/detail:min-h-0 @3xl/detail:overflow-y-auto @3xl/detail:p-6"
        >
          <div className="space-y-4">
            <div className="grid w-full min-w-0 gap-2 @md/list:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]">
              <Select
                value={statusFilter}
                items={STATUS_FILTER_ITEMS}
                onValueChange={(value) =>
                  changeFilters(value as StatusFilter, typeFilter)
                }
              >
                <SelectTrigger size="sm" className="w-full" aria-label="Status filter">
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
              <Select
                value={typeFilter}
                items={TYPE_FILTER_ITEMS}
                onValueChange={(value) =>
                  changeFilters(statusFilter, value as TypeFilter)
                }
              >
                <SelectTrigger size="sm" className="w-full" aria-label="Type filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="agent">AI interview</SelectItem>
                  <SelectItem value="voiceRecord">Voice note</SelectItem>
                  <SelectItem value="audioUpload">Uploaded recording</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={sortOrder}
                items={SORT_ORDER_ITEMS}
                onValueChange={(value) => setSortOrder(value as SortOrder)}
              >
                <SelectTrigger size="sm" className="w-full" aria-label="Sort contributions">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest first</SelectItem>
                  <SelectItem value="oldest">Oldest first</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {activeOutsideList && (
              <p className="text-xs text-muted-foreground">
                The open contribution is further down the list than has loaded
                so far.
              </p>
            )}

            {loadingFirstPage ? (
              <LoadingRows />
            ) : conversations.length === 0 && !hasFilters && !canLoadMore ? (
              <EmptyState
                icon={Mic}
                title="No contributions yet"
                description={
                  onCapture
                    ? "Start an AI interview, record a voice note, or upload files."
                    : "Contributions appear here once a contributor starts an AI interview, records a voice note, or uploads files."
                }
                action={
                  onCapture && (
                    <div
                      className="flex flex-wrap justify-center gap-2"
                      role="group"
                      aria-label="Add a contribution"
                    >
                      {CAPTURE_ACTIONS.map(({ mode, label, icon: Icon }) => (
                        <Button
                          key={mode}
                          type="button"
                          variant="outline"
                          className="gap-2"
                          onClick={() => onCapture(mode)}
                        >
                          <Icon className="size-4" aria-hidden="true" />
                          {label}
                        </Button>
                      ))}
                    </div>
                  )
                }
                className="min-h-72"
              />
            ) : conversations.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No matching contributions"
                description={
                  canLoadMore
                    ? "None of the contributions loaded so far match these filters. Load more to keep looking."
                    : "No contributions match these filters."
                }
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    {hasFilters && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => changeFilters("all", "all")}
                      >
                        Clear filters
                      </Button>
                    )}
                    {loadMoreButton}
                  </div>
                }
                className="min-h-72"
              />
            ) : (
              <div className="space-y-3">
                {conversations.map((conversation) => (
                  <ConversationRow
                    key={conversation._id}
                    conversation={conversation}
                    selected={activeConversationId === conversation._id}
                    onSelect={() => selectConversation(conversation._id)}
                    buttonRef={(node) => {
                      if (node) {
                        conversationButtonRefs.current.set(
                          conversation._id,
                          node,
                        );
                      } else {
                        conversationButtonRefs.current.delete(conversation._id);
                      }
                    }}
                  />
                ))}

                {(canLoadMore || conversations.length > INITIAL_PAGE_SIZE) && (
                  <div className="flex flex-col items-center gap-2 pt-1">
                    {loadMoreButton}
                    {/* Loaded rows, not a total: the list can't know how many
                        remain until it reaches the end. */}
                    <p
                      className="text-center text-xs text-muted-foreground"
                      aria-live="polite"
                    >
                      {canLoadMore
                        ? `${conversations.length} loaded`
                        : `All ${conversations.length} loaded`}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Focusable so a tap on a stacked layout can move focus here. */}
        <aside
          ref={playbackRef}
          tabIndex={-1}
          aria-label={
            activeConversation
              ? `Playback: ${playbackTitle(activeConversation)}`
              : activeListRow
                ? `Playback: ${conversationTitle(activeListRow)}`
                : "Contribution playback"
          }
          className="min-w-0 border-t p-4 outline-none @3xl/detail:min-h-0 @3xl/detail:overflow-hidden @3xl/detail:border-l @3xl/detail:border-t-0 @3xl/detail:p-6"
        >
          <ConversationPlaybackPanel
            conversationId={activeConversationId}
            conversation={activeConversation}
            canLabelSpeakers={canLabelSpeakers}
            canRetry={canRetry}
            hasConversations={
              conversations.length > 0 || hasFilters || pageStatus !== "Exhausted"
            }
          />
        </aside>
      </div>
    </TooltipProvider>
  );
}

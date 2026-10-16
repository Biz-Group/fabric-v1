"use client";

import { useMemo, useState } from "react";
import { useOrganization } from "@clerk/nextjs";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import {
  Bot,
  Check,
  Download,
  GitBranch,
  Mic,
  MoreHorizontal,
  Pencil,
  Plus,
  Share2,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageTitle } from "@/components/ui/page-title";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/features/status/status-badge";
import { processPendingStatusMeta } from "@/features/status/status-meta";
import {
  WorkbenchBreadcrumb,
  type WorkbenchCrumb,
} from "@/features/workbench/workbench-breadcrumb";
import { cn } from "@/lib/utils";
import styles from "./process-header.module.css";

type ProcessWorkbench = NonNullable<
  FunctionReturnType<typeof api.processes.getWorkbench>
>;

type ProcessHeaderProps = {
  processName: string;
  workbench: ProcessWorkbench | null | undefined;
  canEdit: boolean;
  /** Phone layout: capture actions move to a floating button so the overview
   * starts near the top of the screen, and the "more" menu joins the title. */
  mobile?: boolean;
  /** Home, the function and the department, above the title. */
  breadcrumb: WorkbenchCrumb[];
  onCopyLink: () => Promise<boolean>;
  onJumpToLabeling: () => void;
  onEditProcess: () => void;
  onMoveProcess: () => void;
  onDeleteProcess: () => void;
  onDownloadProcess: () => void;
  isDownloading: boolean;
  onStartInterview: () => void;
  onRecordVoice: () => void;
  onUploadAudio: () => void;
};

type CopyState = "idle" | "copying" | "copied" | "failed";

function formatRelativeTime(epochMs: number | null | undefined) {
  if (!epochMs) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - epochMs) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(epochMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatAbsoluteTime(epochMs: number | null | undefined) {
  if (!epochMs) return undefined;
  return new Date(epochMs).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateTimeAttribute(epochMs: number | null | undefined) {
  if (!epochMs) return undefined;
  return new Date(epochMs).toISOString();
}

function getInitials(name: string | null | undefined) {
  if (!name) return "--";
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "--";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function ProcessStatusBadge({
  workbench,
  onJumpToLabeling,
}: {
  workbench: ProcessWorkbench | null | undefined;
  onJumpToLabeling: () => void;
}) {
  if (workbench === undefined) {
    return <Skeleton className="h-5 w-20 rounded-full" />;
  }

  if (workbench === null) {
    return (
      <Badge tone="neutral">Unavailable</Badge>
    );
  }

  if (workbench.pendingWork.status === "current") {
    return null;
  }

  const meta = processPendingStatusMeta[workbench.pendingWork.status];

  if (workbench.pendingWork.status === "needs_labels") {
    return (
      <StatusBadge
        meta={meta}
        render={
          <button
            type="button"
            aria-label={`${meta.label}, jump to labeling`}
          />
        }
        className="cursor-pointer hover:border-warning focus-ring pointer-coarse:h-8 pointer-coarse:px-3"
        onClick={onJumpToLabeling}
      />
    );
  }

  return <StatusBadge meta={meta} />;
}

function ProcessMetadata({
  contributorName,
  submittedByName,
  contributorImageUrl,
  updatedAt,
  relativeUpdatedAt,
  absoluteUpdatedAt,
  dateTime,
}: {
  contributorName: string | null | undefined;
  submittedByName: string | null | undefined;
  contributorImageUrl: string | null | undefined;
  updatedAt: number | null | undefined;
  relativeUpdatedAt: string | null;
  absoluteUpdatedAt?: string;
  dateTime?: string;
}) {
  const displayName = contributorName ?? "No contributor yet";

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      {contributorImageUrl ? (
        // Clerk-hosted avatar served from an external CDN; next/image would
        // require host allowlisting for a 24px image.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={contributorImageUrl}
          alt=""
          aria-hidden="true"
          className="size-6 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-org-accent-subtle text-2xs font-semibold text-org-accent"
          aria-hidden="true"
        >
          {getInitials(contributorName)}
        </span>
      )}
      <span className="min-w-0 truncate">
        <span className="font-medium text-foreground/80">{displayName}</span>
        {/* Present only when someone filed this on the contributor's behalf.
            Without it the byline would read as the contributor's own submission. */}
        {submittedByName && (
          <span title={`Submitted by ${submittedByName}`}>
            {" "}
            (submitted by {submittedByName})
          </span>
        )}
        <span aria-hidden="true"> · </span>
        {updatedAt && dateTime ? (
          <time dateTime={dateTime} title={absoluteUpdatedAt}>
            Updated {relativeUpdatedAt ?? "just now"}
          </time>
        ) : (
          <span>Not updated</span>
        )}
      </span>
    </div>
  );
}

function CaptureActions({
  disabled,
  onStartInterview,
  onRecordVoice,
  onUploadAudio,
}: {
  disabled: boolean;
  onStartInterview: () => void;
  onRecordVoice: () => void;
  onUploadAudio: () => void;
}) {
  const actionClassName =
    "h-10 min-w-0 justify-start gap-2.5 px-3 text-sm transition-[background-color,border-color,color,box-shadow,transform] motion-reduce:transition-none";

  return (
    <div
      className="flex min-w-0 flex-wrap gap-2"
      role="group"
      aria-label="Add a contribution"
      data-tour="capture"
    >
      <span className={styles.aiButtonGlow}>
        <Button
          type="button"
          variant="outline"
          className={cn(actionClassName, styles.aiButton)}
          disabled={disabled}
          onClick={onStartInterview}
        >
          <Bot className="size-4" aria-hidden="true" />
          <span className="truncate">Start AI interview</span>
        </Button>
      </span>
      <Button
        type="button"
        variant="outline"
        className={actionClassName}
        disabled={disabled}
        onClick={onRecordVoice}
      >
        <Mic className="size-4" aria-hidden="true" />
        <span className="truncate">Record a voice note</span>
      </Button>
      <Button
        type="button"
        variant="outline"
        className={actionClassName}
        disabled={disabled}
        onClick={onUploadAudio}
      >
        <Upload className="size-4" aria-hidden="true" />
        <span className="truncate">Upload files</span>
      </Button>
    </div>
  );
}

/**
 * Phone replacement for CaptureActions: a speed-dial button pinned bottom-right
 * that expands into the three capture options. Built on the Base UI menu for
 * focus handling, Escape, and tap-outside dismissal. It lifts above a docked
 * bottom bar (the audio mini-player) via `--bottom-dock-height`.
 */
function CaptureFab({
  disabled,
  onStartInterview,
  onRecordVoice,
  onUploadAudio,
}: {
  disabled: boolean;
  onStartInterview: () => void;
  onRecordVoice: () => void;
  onUploadAudio: () => void;
}) {
  // Listed top to bottom; the primary action sits nearest the thumb.
  const actions = [
    { label: "Upload files", icon: Upload, onSelect: onUploadAudio },
    { label: "Record a voice note", icon: Mic, onSelect: onRecordVoice },
    {
      label: "Start AI interview",
      icon: Bot,
      onSelect: onStartInterview,
      primary: true,
    },
  ];

  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger
        disabled={disabled}
        aria-label="Add a contribution"
        data-tour="capture"
        className="group/fab focus-ring fixed right-4 bottom-[calc(1rem+var(--bottom-dock-height,0px)+env(safe-area-inset-bottom))] z-fab flex size-14 items-center justify-center rounded-full bg-org-accent text-org-accent-foreground shadow-lg shadow-black/20 transition-transform active:scale-95 disabled:opacity-50 motion-reduce:transition-none"
      >
        <Plus
          className="size-6 transition-transform duration-200 group-data-popup-open/fab:rotate-45 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Backdrop className="fixed inset-0 z-fab-backdrop bg-background/75 backdrop-blur-[2px] duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none" />
        <MenuPrimitive.Positioner
          side="top"
          align="end"
          sideOffset={16}
          className="isolate z-popover outline-none"
        >
          <MenuPrimitive.Popup className="flex flex-col items-end gap-3 pr-1 outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-3 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-3 motion-reduce:animate-none">
            {actions.map(({ label, icon: Icon, onSelect, primary }) => (
              <MenuPrimitive.Item
                key={label}
                onClick={onSelect}
                className="group/fab-item flex min-h-12 items-center gap-3 outline-none select-none"
              >
                <span className="rounded-full border bg-background px-3.5 py-2 text-sm font-medium text-foreground shadow-md group-data-highlighted/fab-item:bg-org-accent-selected">
                  {label}
                </span>
                <span
                  className={cn(
                    "flex size-12 items-center justify-center rounded-full shadow-md group-data-highlighted/fab-item:outline-solid group-data-highlighted/fab-item:outline-2 group-data-highlighted/fab-item:outline-offset-2 group-data-highlighted/fab-item:outline-focus",
                    primary
                      ? "bg-org-accent text-org-accent-foreground"
                      : "border bg-background text-foreground",
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </span>
              </MenuPrimitive.Item>
            ))}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

export function ProcessHeader({
  processName,
  workbench,
  canEdit,
  mobile = false,
  breadcrumb,
  onCopyLink,
  onJumpToLabeling,
  onEditProcess,
  onMoveProcess,
  onDeleteProcess,
  onDownloadProcess,
  isDownloading,
  onStartInterview,
  onRecordVoice,
  onUploadAudio,
}: ProcessHeaderProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const latestContributor = workbench?.latestContributor;

  // Resolve the contributor's uploaded Clerk avatar by matching their Clerk
  // user id against the active org's membership list. Members beyond the first
  // page (large orgs) simply fall back to initials.
  const { memberships } = useOrganization({
    memberships: { pageSize: 100, keepPreviousData: true },
  });
  const contributorImageUrl = useMemo(() => {
    const clerkUserId = latestContributor?.clerkUserId;
    if (!clerkUserId) return null;
    const match = memberships?.data?.find(
      (member) => member.publicUserData?.userId === clerkUserId,
    );
    return match?.publicUserData?.hasImage
      ? match.publicUserData.imageUrl
      : null;
  }, [latestContributor?.clerkUserId, memberships?.data]);
  const lastUpdated = formatRelativeTime(workbench?.lastUpdatedAt);
  const lastUpdatedTitle = formatAbsoluteTime(workbench?.lastUpdatedAt);
  const lastUpdatedDateTime = formatDateTimeAttribute(workbench?.lastUpdatedAt);
  const captureDisabled = workbench === null;
  const safeProcessName = processName || "process";

  const handleCopyLink = async () => {
    setCopyState("copying");
    const copied = await onCopyLink();
    setCopyState(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 1800);
  };

  const copyLabel =
    copyState === "copying"
      ? "Copying"
      : copyState === "copied"
        ? "Copied"
        : copyState === "failed"
          ? "Copy failed"
          : "Share";

  const moreMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="text-muted-foreground hover:text-foreground"
            aria-label={`More actions for ${safeProcessName}`}
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent role="menu" align="end" className="w-48">
        {/* Phones have no room for the Share button beside the title. */}
        {mobile && (
          <>
            <DropdownMenuItem
              disabled={copyState === "copying"}
              onClick={handleCopyLink}
            >
              {copyState === "copying" ? (
                <Spinner />
              ) : copyState === "copied" ? (
                <Check className="size-4" />
              ) : (
                <Share2 className="size-4" />
              )}
              {copyLabel}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          disabled={isDownloading}
          onClick={onDownloadProcess}
        >
          {isDownloading ? (
            <Spinner />
          ) : (
            <Download className="size-4" />
          )}
          {isDownloading ? "Preparing PDF…" : "Download PDF"}
        </DropdownMenuItem>
        {canEdit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onEditProcess}>
              <Pencil className="size-4" />
              Edit process
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onMoveProcess}>
              <GitBranch className="size-4" />
              Move process
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={onDeleteProcess}
            >
              <Trash2 className="size-4" />
              Delete process
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // The layout follows the panel's width, not the viewport's: beside the
  // sidebar and tree, the panel is narrow even on a wide screen. Only a panel
  // wide enough for the title and the whole action row puts them side by side.
  return (
    <header className="@container shrink-0 border-b bg-background">
      <div className="grid min-w-0 gap-y-3 px-4 py-4 md:px-6 @5xl:grid-cols-[minmax(0,1fr)_auto] @5xl:items-center @5xl:gap-x-6">
        {/* Phones drop the breadcrumb: the back button above already names
            the department, and the title below names the process. */}
        {!mobile && (
          <div className="min-w-0 @5xl:col-span-2 @5xl:row-start-1">
            <WorkbenchBreadcrumb
              crumbs={breadcrumb}
              current={processName || "Process"}
            />
          </div>
        )}

        <div className="flex min-w-0 items-start gap-2 @5xl:col-start-1 @5xl:row-start-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <PageTitle size="lg" className="min-w-0 max-w-full break-words">
              {processName || "Untitled process"}
            </PageTitle>
            <ProcessStatusBadge
              workbench={workbench}
              onJumpToLabeling={onJumpToLabeling}
            />
          </div>
          {mobile && <div className="-mr-2 shrink-0">{moreMenu}</div>}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 @5xl:col-start-1 @5xl:row-start-3">
          <ProcessMetadata
            contributorName={latestContributor?.name}
            submittedByName={latestContributor?.submittedByName}
            contributorImageUrl={contributorImageUrl}
            updatedAt={workbench?.lastUpdatedAt}
            relativeUpdatedAt={lastUpdated}
            absoluteUpdatedAt={lastUpdatedTitle}
            dateTime={lastUpdatedDateTime}
          />
          {workbench?.flow?.stale && (
            <Badge tone="warning">Flow out of date</Badge>
          )}
        </div>

        {!mobile && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 @5xl:col-start-2 @5xl:row-start-2 @5xl:flex-nowrap @5xl:justify-end">
            {canEdit && (
              <CaptureActions
                disabled={captureDisabled}
                onStartInterview={onStartInterview}
                onRecordVoice={onRecordVoice}
                onUploadAudio={onUploadAudio}
              />
            )}
            {/* The divider only shows where the row fits on one line; a
                wrapped Share would start its line with it. */}
            <div
              className={cn(
                "flex shrink-0 items-center gap-1.5",
                canEdit && "@3xl:border-l @3xl:pl-3",
              )}
            >
              <Button
                type="button"
                variant="ghost"
                className="min-h-10 justify-start gap-2 px-2.5 text-muted-foreground hover:text-foreground"
                onClick={handleCopyLink}
                disabled={copyState === "copying"}
              >
                {copyState === "copying" ? (
                  <Spinner />
                ) : copyState === "copied" ? (
                  <Check className="size-4" />
                ) : (
                  <Share2 className="size-4" />
                )}
                {copyLabel}
              </Button>
              <div>{moreMenu}</div>
            </div>
          </div>
        )}
      </div>
      {mobile && canEdit && (
        <CaptureFab
          disabled={captureDisabled}
          onStartInterview={onStartInterview}
          onRecordVoice={onRecordVoice}
          onUploadAudio={onUploadAudio}
        />
      )}
    </header>
  );
}

"use client";

import { useId, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowUpRight,
  Bot,
  Building2,
  ChevronDown,
  GitBranch,
  Mic,
  Plus,
  Tag,
  Upload,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useLastLoaded } from "@/hooks/use-last-loaded";
import { cn } from "@/lib/utils";
import type { ProcessTreeData } from "@/features/hierarchy/process-tree-navigator";
import type { RecordingMode } from "@/features/recording/recording-modal";
import { StatusBadge } from "@/features/status/status-badge";
import {
  STATUS_TONE_SURFACE,
  STATUS_TONE_TEXT,
  type StatusMeta,
} from "@/features/status/status-meta";
import {
  type HomeDepartmentEntry,
  type HomeProcessEntry,
  departmentInterviewCoverage,
  describeConversationStatus,
  describeProcessActivity,
  findTreeDepartment,
  firstName,
  formatRelativeTime,
  interviewCountLabel,
  resolveRecentProcesses,
  treeHasProcesses,
} from "./home-view-model";

export type MyConversation = FunctionReturnType<
  typeof api.conversations.listMine
>[number];

// The feed starts short and grows on request, up to the server's cap.
const FEED_PAGE_SIZE = 6;
const FEED_MAX = 50;

type WorkspaceHomeProps = {
  tree: ProcessTreeData | undefined;
  canEdit: boolean;
  recentProcessIds: string[];
  /** Phone layout: 40px+ touch targets, and status chips move under the name
   * so a long process name keeps its width next to the Capture button. */
  mobile?: boolean;
  onOpenProcess: (entry: HomeProcessEntry) => void;
  onOpenDepartment: (entry: HomeDepartmentEntry) => void;
  onCapture: (entry: HomeProcessEntry, mode: RecordingMode) => void;
  onOpenConversation: (conversation: MyConversation) => void;
  onCreateProcess: (entry: HomeDepartmentEntry) => void;
  onCreateFunction: () => void;
};

const ROW_CLASS =
  "org-focus-ring flex min-h-14 w-full min-w-0 items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-org-accent-subtle";

function rowTitleClass(mobile: boolean) {
  return cn("block truncate font-medium", mobile ? "text-base" : "text-sm");
}

/** Second line of a row: muted detail text, plus the status chip on phones. */
function RowDetail({
  mobile,
  activity,
  children,
}: {
  mobile: boolean;
  activity: StatusMeta | null;
  children: ReactNode;
}) {
  return (
    <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <span className="truncate">{children}</span>
      {mobile && activity && <StatusBadge meta={activity} />}
    </span>
  );
}

const INPUT_MODE_ICONS = {
  agent: Bot,
  voiceRecord: Mic,
  audioUpload: Upload,
} as const;

function RowIcon({ icon: Icon }: { icon: typeof GitBranch }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}

function HomeSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  // Generated: the desktop and phone layouts are both mounted (CSS hides one),
  // so a fixed id would be duplicated.
  const id = useId();
  return (
    <section aria-labelledby={id} className="min-w-0">
      <div className="flex min-h-8 flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={id} className="text-base font-semibold tracking-tight">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      <div className="mt-4 border-t border-border pt-1">{children}</div>
    </section>
  );
}

function SectionNote({ children }: { children: ReactNode }) {
  return (
    <p className="py-5 text-sm leading-6 text-muted-foreground">{children}</p>
  );
}

function CaptureMenu({
  entry,
  mobile,
  onCapture,
}: {
  entry: HomeProcessEntry;
  mobile: boolean;
  onCapture: WorkspaceHomeProps["onCapture"];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size={mobile ? "icon-lg" : "sm"}
            className={cn("shrink-0", mobile ? "size-10" : "gap-1")}
            aria-label={`Capture knowledge for ${entry.process.name}`}
          />
        }
      >
        <Mic className={mobile ? "size-4" : "size-3.5"} aria-hidden="true" />
        {!mobile && (
          <>
            Capture
            <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => onCapture(entry, "agent")}>
          <Bot className="size-4" />
          Start AI interview
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onCapture(entry, "voiceRecord")}>
          <Mic className="size-4" />
          Record a voice note
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onCapture(entry, "audioUpload")}>
          <Upload className="size-4" />
          Upload files
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DepartmentSection({
  home,
  canEdit,
  mobile,
  onOpenProcess,
  onOpenDepartment,
  onCapture,
  onCreateProcess,
}: {
  home: HomeDepartmentEntry;
  canEdit: boolean;
  mobile: boolean;
  onOpenProcess: WorkspaceHomeProps["onOpenProcess"];
  onOpenDepartment: WorkspaceHomeProps["onOpenDepartment"];
  onCapture: WorkspaceHomeProps["onCapture"];
  onCreateProcess: WorkspaceHomeProps["onCreateProcess"];
}) {
  const { department } = home;
  const coverage = departmentInterviewCoverage(department);
  const percentage =
    coverage.total === 0
      ? 0
      : Math.round((coverage.covered / coverage.total) * 100);

  return (
    <HomeSection
      title={department.name}
      description={
        coverage.total === 0
          ? "Your department"
          : `Your department · ${coverage.covered} of ${coverage.total} processes have interviews`
      }
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "gap-1 text-muted-foreground hover:text-foreground",
            mobile && "-ml-2.5 h-10 px-2.5",
          )}
          onClick={() => onOpenDepartment(home)}
        >
          Department overview
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Button>
      }
    >
      {coverage.total > 0 && (
        <div
          className="mb-2 mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Processes with interviews"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage}
        >
          <div
            className="h-full rounded-full bg-org-accent transition-[width] motion-reduce:transition-none"
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}
      {department.processes.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 py-5">
          <p className="text-sm text-muted-foreground">
            No processes have been added to {department.name} yet.
          </p>
          {canEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn("gap-1.5", mobile && "h-10 px-3")}
              onClick={() => onCreateProcess(home)}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add process
            </Button>
          )}
        </div>
      ) : (
        <div role="list">
          {department.processes.map((process) => {
            const entry = { ...home, process };
            const activity = describeProcessActivity(process);
            return (
              <div
                role="listitem"
                key={process._id}
                className="flex items-center gap-2 border-b border-border last:border-b-0"
              >
                <button
                  type="button"
                  className={ROW_CLASS}
                  onClick={() => onOpenProcess(entry)}
                  aria-label={`Open process: ${process.name}`}
                >
                  <RowIcon icon={GitBranch} />
                  <span className="min-w-0 flex-1">
                    <span className={rowTitleClass(mobile)}>
                      {process.name}
                    </span>
                    <RowDetail mobile={mobile} activity={activity}>
                      {interviewCountLabel(process.conversationCounts.total)}
                    </RowDetail>
                  </span>
                  {!mobile && activity && <StatusBadge meta={activity} />}
                </button>
                {canEdit && (
                  <CaptureMenu
                    entry={entry}
                    mobile={mobile}
                    onCapture={onCapture}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </HomeSection>
  );
}

function RecentSection({
  recent,
  mobile,
  onOpenProcess,
}: {
  recent: HomeProcessEntry[];
  mobile: boolean;
  onOpenProcess: WorkspaceHomeProps["onOpenProcess"];
}) {
  return (
    <HomeSection title="Pick up where you left off">
      {recent.length === 0 ? (
        <SectionNote>Processes you open will appear here.</SectionNote>
      ) : (
        <div role="list">
          {recent.map((entry) => (
            <div
              role="listitem"
              key={entry.process._id}
              className="border-b border-border last:border-b-0"
            >
              <button
                type="button"
                className={ROW_CLASS}
                onClick={() => onOpenProcess(entry)}
                aria-label={`Open process: ${entry.process.name}`}
              >
                <RowIcon icon={GitBranch} />
                <span className="min-w-0 flex-1">
                  <span className={rowTitleClass(mobile)}>
                    {entry.process.name}
                  </span>
                  <RowDetail mobile={mobile} activity={null}>
                    {entry.fn.name} › {entry.department.name}
                  </RowDetail>
                </span>
                <ArrowUpRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </button>
            </div>
          ))}
        </div>
      )}
    </HomeSection>
  );
}

function conversationByline(conversation: MyConversation) {
  if (conversation.attribution === "filedForCaller") {
    return `Filed by ${conversation.submittedByName}`;
  }
  if (conversation.attribution === "filedForOther") {
    return `For ${conversation.contributorName}`;
  }
  return null;
}

function MyInterviewsSection({
  conversations,
  limit,
  loadingMore,
  canEdit,
  mobile,
  onShowMore,
  onOpenConversation,
}: {
  conversations: MyConversation[] | undefined;
  /** How many rows were asked for; a full page means there may be more. */
  limit: number;
  loadingMore: boolean;
  canEdit: boolean;
  mobile: boolean;
  onShowMore: () => void;
  onOpenConversation: WorkspaceHomeProps["onOpenConversation"];
}) {
  // While a longer list loads, the shorter one stays up with its button.
  const full =
    conversations !== undefined &&
    (loadingMore || conversations.length >= limit);
  return (
    <HomeSection title="Your interviews">
      {conversations === undefined ? (
        <div className="space-y-px py-2" aria-label="Loading your interviews">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-14 rounded-none" />
          ))}
        </div>
      ) : conversations.length === 0 ? (
        <SectionNote>
          {canEdit
            ? "You haven't recorded an interview yet. Use Capture on one of your department's processes to share how the work gets done."
            : "Interviews you take part in will appear here."}
        </SectionNote>
      ) : (
        <div role="list">
          {conversations.map((conversation) => {
            const status = describeConversationStatus(conversation.status);
            const byline = conversationByline(conversation);
            return (
              <div
                role="listitem"
                key={conversation._id}
                className="border-b border-border last:border-b-0"
              >
                <button
                  type="button"
                  className={ROW_CLASS}
                  onClick={() => onOpenConversation(conversation)}
                  aria-label={`Open interview in ${conversation.processName}`}
                >
                  <RowIcon icon={INPUT_MODE_ICONS[conversation.inputMode]} />
                  <span className="min-w-0 flex-1">
                    <span className={rowTitleClass(mobile)}>
                      {conversation.title ?? conversation.processName}
                    </span>
                    <RowDetail mobile={mobile} activity={status}>
                      {conversation.title ? `${conversation.processName} · ` : ""}
                      <time
                        dateTime={new Date(
                          conversation._creationTime,
                        ).toISOString()}
                      >
                        {formatRelativeTime(conversation._creationTime)}
                      </time>
                      {byline ? ` · ${byline}` : ""}
                    </RowDetail>
                  </span>
                  {!mobile && status && <StatusBadge meta={status} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {full &&
        (limit < FEED_MAX ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn("mt-2", mobile && "h-10 w-full")}
            onClick={onShowMore}
            disabled={loadingMore}
          >
            <ChevronDown aria-hidden="true" />
            {loadingMore ? "Loading…" : "Show more"}
          </Button>
        ) : (
          <SectionNote>Showing your {FEED_MAX} most recent.</SectionNote>
        ))}
    </HomeSection>
  );
}

function LabelsCallout({
  count,
  first,
  mobile,
  onOpenConversation,
}: {
  /** All of the member's contributions awaiting labels, not just the ones
   * the feed shows. */
  count: number;
  /** The oldest of them, opened by "Review". */
  first: MyConversation | null;
  mobile: boolean;
  onOpenConversation: WorkspaceHomeProps["onOpenConversation"];
}) {
  if (count === 0 || !first) return null;
  return (
    <div
      role="status"
      className={cn(
        "mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3",
        STATUS_TONE_SURFACE.warning,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <Tag
          className={cn("mt-0.5 size-4 shrink-0", STATUS_TONE_TEXT.warning)}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {count === 1
              ? "One of your interviews needs speaker labels"
              : `${count} of your interviews need speaker labels`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Confirm who is speaking so Fabric can finish processing{" "}
            {count === 1 ? "it" : "them"}.
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn("border-warning-border", mobile && "h-10 w-full")}
        onClick={() => onOpenConversation(first)}
      >
        Review
      </Button>
    </div>
  );
}

function EmptyWorkspace({
  canEdit,
  mobile,
  onCreateFunction,
}: {
  canEdit: boolean;
  mobile: boolean;
  onCreateFunction: () => void;
}) {
  return (
    <div className="mt-10 rounded-xl border border-dashed px-6 py-12 text-center">
      <Building2
        className="mx-auto size-7 text-muted-foreground"
        aria-hidden="true"
      />
      <h2 className="mt-4 text-lg font-semibold">No processes yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        {canEdit
          ? "Start by adding a function, the top level of your organization's process tree. Departments and processes go inside it."
          : "Nobody has added processes to this workspace yet. Once they do, you'll be able to explore them here."}
      </p>
      {canEdit && (
        <Button
          type="button"
          variant="outline"
          className={cn("mt-6 gap-1.5", mobile && "h-11 px-4")}
          onClick={onCreateFunction}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add function
        </Button>
      )}
    </div>
  );
}

function WorkspaceHomeLoading() {
  return (
    <div
      className="mx-auto w-full max-w-5xl space-y-10 px-4 pb-10 pt-7 sm:px-6 sm:pt-10 lg:px-8"
      aria-label="Loading home"
    >
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-14 w-full rounded-none" />
        ))}
      </div>
    </div>
  );
}

export function WorkspaceHome({
  tree,
  canEdit,
  recentProcessIds,
  mobile = false,
  onOpenProcess,
  onOpenDepartment,
  onCapture,
  onOpenConversation,
  onCreateProcess,
  onCreateFunction,
}: WorkspaceHomeProps) {
  const me = useQuery(api.users.getMe);
  const placement = useQuery(api.users.getMyPlacement);
  const [feedLimit, setFeedLimit] = useState(FEED_PAGE_SIZE);
  const latestConversations = useQuery(api.conversations.listMine, {
    limit: feedLimit,
  });
  // Keep the rows on screen while "Show more" loads the longer list.
  const myConversations = useLastLoaded(
    latestConversations,
    latestConversations === undefined,
  );
  // Only people who can label see the callout.
  const labels = useQuery(
    api.conversations.myNeedsLabelsSummary,
    canEdit ? {} : "skip",
  );

  if (tree === undefined || me === undefined || placement === undefined) {
    return <WorkspaceHomeLoading />;
  }

  const name = firstName(me?.name);
  const homePlacement = placement?.placement ?? null;
  const home = homePlacement
    ? findTreeDepartment(tree, homePlacement.departmentId)
    : null;
  const recent = resolveRecentProcesses(tree, recentProcessIds);

  return (
    <article
      className={cn(
        "@container mx-auto w-full max-w-5xl px-4 pb-10 sm:px-6 lg:px-8",
        mobile ? "pt-5" : "pt-7 sm:pt-10",
      )}
      aria-label="Home"
    >
      <header>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {name ? `Welcome back, ${name}` : "Welcome back"}
        </h1>
        {homePlacement && (
          <p className="mt-2 flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {homePlacement.departmentName}
              <span aria-hidden="true"> · </span>
              {homePlacement.functionName}
            </span>
          </p>
        )}
      </header>

      {!home && !treeHasProcesses(tree) ? (
        <EmptyWorkspace
          canEdit={canEdit}
          mobile={mobile}
          onCreateFunction={onCreateFunction}
        />
      ) : (
        <>
          {canEdit && labels && (
            <LabelsCallout
              count={labels.count}
              first={labels.oldest}
              mobile={mobile}
              onOpenConversation={onOpenConversation}
            />
          )}
          <div className="mt-8 grid gap-10 @3xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @3xl:gap-12">
            {home ? (
              <DepartmentSection
                home={home}
                canEdit={canEdit}
                mobile={mobile}
                onOpenProcess={onOpenProcess}
                onOpenDepartment={onOpenDepartment}
                onCapture={onCapture}
                onCreateProcess={onCreateProcess}
              />
            ) : (
              <HomeSection title="Your department">
                <SectionNote>
                  You aren&apos;t placed in a department yet. Browse the
                  process tree to find the work you&apos;re involved in.
                </SectionNote>
              </HomeSection>
            )}
            <div className="space-y-10">
              <RecentSection
                recent={recent}
                mobile={mobile}
                onOpenProcess={onOpenProcess}
              />
              <MyInterviewsSection
                conversations={myConversations}
                limit={feedLimit}
                loadingMore={latestConversations === undefined}
                canEdit={canEdit}
                mobile={mobile}
                onShowMore={() =>
                  setFeedLimit((limit) =>
                    Math.min(limit + FEED_PAGE_SIZE * 2, FEED_MAX),
                  )
                }
                onOpenConversation={onOpenConversation}
              />
            </div>
          </div>
        </>
      )}
    </article>
  );
}

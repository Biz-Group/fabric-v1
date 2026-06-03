"use client";

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  lazy,
  Suspense,
} from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Building2,
  Layers,
  Cog,
  FileText,
  Mic,
  Sparkles,
  Loader2,
  AlertCircle,
  Plus,
  Pencil,
  Trash2,
  Clock,
  Bot,
  Upload,
  Search,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useColumnCollapse } from "@/hooks/use-column-collapse";
import { ConversationLog } from "@/components/conversation-log";
import { UserMenu } from "@/components/user-menu";
import { WorkspaceBrand } from "@/components/workspace-brand";
import {
  RecordingModal,
  type RecordingMode,
} from "@/components/recording-modal";
import { CrudDialog } from "@/components/crud-dialog";
import { CommandPalette } from "@/components/command-palette";
import { MarkdownSummary } from "@/components/markdown-summary";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { GitBranch } from "lucide-react";

const ProcessFlow = lazy(() =>
  import("@/components/process-flow").then((m) => ({ default: m.ProcessFlow }))
);

const PROCESS_SUMMARY_COLLAPSED_HEIGHT = 184;

// --- Types ---

type MobileLevel = 1 | 2 | 3 | 4;
type MobilePreview =
  | { type: "function"; id: Id<"functions">; name: string }
  | { type: "department"; id: Id<"departments">; name: string }
  | { type: "process"; id: Id<"processes">; name: string }
  | null;

// --- URL selection params ---
// The committed selection is mirrored into the `/[org]` query string so the
// view is refresh-safe, shareable, and traversable with the Back button.

const PARAM = {
  fn: "fn",
  dept: "dept",
  proc: "proc",
  tab: "tab",
} as const;

type SelectionParams = {
  fn: Id<"functions"> | null;
  dept: Id<"departments"> | null;
  proc: Id<"processes"> | null;
  tab: number;
};

// Tab index <-> URL token. Only the non-default tab is encoded.
function tabToParam(tab: number): string | null {
  return tab === 1 ? "flow" : null;
}
function paramToTab(value: string | null): number {
  return value === "flow" ? 1 : 0;
}

function readSelectionParams(
  searchParams: URLSearchParams | ReturnType<typeof useSearchParams>,
): SelectionParams {
  const fn = searchParams.get(PARAM.fn);
  const dept = searchParams.get(PARAM.dept);
  const proc = searchParams.get(PARAM.proc);
  return {
    fn: fn ? (fn as Id<"functions">) : null,
    dept: dept ? (dept as Id<"departments">) : null,
    proc: proc ? (proc as Id<"processes">) : null,
    tab: paramToTab(searchParams.get(PARAM.tab)),
  };
}

// Build a query string from the committed selection, deleting descendant keys
// when a parent is absent so the URL can never describe an impossible path
// (e.g. a process with no function). Starts from the current params to stay
// forward-compatible with any unrelated keys.
function buildSelectionQuery(
  current: URLSearchParams | ReturnType<typeof useSearchParams>,
  sel: SelectionParams,
): string {
  const params = new URLSearchParams(current.toString());

  const setOrDelete = (key: string, value: string | null) => {
    if (value) params.set(key, value);
    else params.delete(key);
  };

  setOrDelete(PARAM.fn, sel.fn);
  setOrDelete(PARAM.dept, sel.fn ? sel.dept : null);
  setOrDelete(PARAM.proc, sel.fn && sel.dept ? sel.proc : null);
  setOrDelete(
    PARAM.tab,
    sel.fn && sel.dept && sel.proc ? tabToParam(sel.tab) : null,
  );

  return params.toString();
}

function deepestMobileLevel(sel: {
  fn: Id<"functions"> | null;
  dept: Id<"departments"> | null;
  proc: Id<"processes"> | null;
}): MobileLevel {
  if (sel.proc) return 4;
  if (sel.dept) return 3;
  if (sel.fn) return 2;
  return 1;
}

// --- Column Item ---

type RowStatus = "attention" | "stale" | "knowledge";

const ROW_STATUS_META: Record<RowStatus, { title: string; tone: string }> = {
  attention: { title: "A conversation needs speaker labels", tone: "bg-amber-500" },
  stale: { title: "Summary is out of date", tone: "bg-amber-500" },
  knowledge: { title: "Has a summary", tone: "bg-emerald-500/70" },
};

function ColumnItem({
  label,
  selected,
  indicator,
  count,
  status,
  onClick,
  onNavigate,
  navigateLabel,
  onEdit,
  onDelete,
  mobile,
}: {
  label: string;
  selected: boolean;
  indicator: "arrow" | "dot";
  /** Child count for parent rows; suppresses the drill chevron when 0. */
  count?: number;
  /** Always-visible status dot conveying scent. */
  status?: RowStatus;
  onClick: () => void;
  onNavigate?: () => void;
  navigateLabel?: string;
  onEdit?: () => void;
  onDelete?: () => void;
  mobile?: boolean;
}) {
  const actionButtonClass = cn(
    "inline-flex items-center justify-center rounded-md transition-colors",
    mobile ? "size-10" : "size-6",
    selected ? "hover:bg-primary-foreground/20" : "hover:bg-foreground/10"
  );
  // Edit/Delete reveal on hover/focus (desktop); always shown on mobile.
  const revealClass = mobile
    ? undefined
    : selected
      ? "opacity-100"
      : "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100";
  // Parent rows show a chevron only when they actually have children.
  const showChevron = indicator === "arrow" && (count === undefined || count > 0);

  return (
    <div
      className={cn(
        "group flex w-full items-center overflow-hidden rounded-lg transition-all",
        mobile && "min-h-14",
        selected
          ? "bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/20"
          : "text-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex min-w-0 flex-1 items-center text-left font-medium outline-none",
          mobile ? "min-h-14 px-4 py-3 text-base" : "px-3 py-2.5 text-sm"
        )}
      >
        <span className="truncate" title={label}>
          {label}
        </span>
      </button>
      <div
        className={cn(
          "flex shrink-0 items-center",
          mobile ? "gap-1.5 px-1.5" : "gap-0.5 pr-2"
        )}
      >
        {onEdit && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className={cn(actionButtonClass, revealClass)}
            title="Rename"
            aria-label={`Rename ${label}`}
          >
            <Pencil className={mobile ? "h-4 w-4" : "h-3 w-3"} />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className={cn(actionButtonClass, revealClass)}
            title="Delete"
            aria-label={`Delete ${label}`}
          >
            <Trash2 className={mobile ? "h-4 w-4" : "h-3 w-3"} />
          </button>
        )}
        {/* Always-visible scent: status dot + child count */}
        {status && (
          <span
            className={cn(
              "inline-block h-2 w-2 shrink-0 rounded-full",
              ROW_STATUS_META[status].tone
            )}
            title={ROW_STATUS_META[status].title}
            aria-label={ROW_STATUS_META[status].title}
          />
        )}
        {count !== undefined && count > 0 && (
          <span
            className={cn(
              "ml-0.5 tabular-nums",
              mobile ? "text-sm" : "text-[11px]",
              selected ? "text-primary-foreground/70" : "text-muted-foreground"
            )}
          >
            {count}
          </span>
        )}
        {onNavigate ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate();
            }}
            className={cn(
              actionButtonClass,
              mobile && "ml-1 border-l border-current/10 pl-1"
            )}
            aria-label={navigateLabel ?? `Open ${label}`}
            title={navigateLabel ?? `Open ${label}`}
          >
            <ChevronRight className={mobile ? "h-5 w-5" : "h-4 w-4"} />
          </button>
        ) : showChevron ? (
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0",
              selected ? "opacity-80" : "opacity-40"
            )}
          />
        ) : null}
      </div>
    </div>
  );
}

// --- Overview Actions ---
// Edit/Delete were moved off the column rows (where they crowded and truncated
// long names) onto the function/department/process overview headers.
function OverviewActions({
  entityLabel,
  onEdit,
  onDelete,
}: {
  entityLabel: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={onEdit}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        title={`Rename ${entityLabel}`}
        aria-label={`Rename ${entityLabel}`}
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        title={`Delete ${entityLabel}`}
        aria-label={`Delete ${entityLabel}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

// --- Empty State ---

function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="rounded-xl bg-muted/60 p-4">
        <Icon className="h-7 w-7 text-muted-foreground/70" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <p className="max-w-[200px] text-xs leading-relaxed text-muted-foreground/70">
          {description}
        </p>
      </div>
      {actionLabel && onAction && (
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onAction}>
          <Plus className="h-3.5 w-3.5" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

// --- Column Header ---

function ColumnHeader({
  title,
  count,
  onAdd,
  icon: Icon,
  collapsed,
  onToggle,
  mobile,
  actions,
}: {
  title: string;
  count?: number;
  onAdd?: () => void;
  icon?: React.ComponentType<{ className?: string }>;
  collapsed?: boolean;
  onToggle?: () => void;
  mobile?: boolean;
  /** Right-aligned action buttons (e.g. overview edit/delete). */
  actions?: React.ReactNode;
}) {
  if (collapsed && Icon) {
    return (
      <div className="shrink-0 border-b bg-muted/30 px-1 py-3">
        <div className="flex flex-col items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              className="rounded-md p-1.5 text-muted-foreground"
            >
              <Icon className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent side="right">
              {title}{count !== undefined ? ` (${count})` : ""}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              onClick={onToggle}
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent side="right">Expand</TooltipContent>
          </Tooltip>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("shrink-0 border-b bg-muted/30 px-4 py-3", mobile && "bg-background py-3.5")}>
      <div className="flex items-center justify-between">
        <h2 className={cn("text-xs font-semibold uppercase tracking-wider text-muted-foreground", mobile && "text-[0.8rem] tracking-[0.16em]")}>
          {title}
        </h2>
        <div className={cn("flex items-center gap-1 min-h-[1.625rem]", mobile && "min-h-9 gap-2")}>
          {actions}
          {count !== undefined && (
            <span className={cn("rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground", mobile && "flex h-8 min-w-8 items-center justify-center px-2 text-xs")}>
              {count}
            </span>
          )}
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              className={cn("rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors", mobile && "flex size-9 items-center justify-center rounded-lg p-0")}
              title={`Add ${title.slice(0, -1)}`}
            >
              <Plus className={mobile ? "h-4 w-4" : "h-3.5 w-3.5"} />
            </button>
          )}
          {onToggle && (
            <button
              type="button"
              onClick={onToggle}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              title={`Collapse ${title}`}
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MobileAppHeader({ onSearch }: { onSearch: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 md:hidden">
      <WorkspaceBrand
        className="min-w-0 flex-1"
        fabricClassName="truncate text-xl font-semibold tracking-tight"
        dividerClassName="h-6 bg-border"
        logoContainerClassName="h-8 max-w-14 px-0"
        initialsClassName="text-[10px]"
      />
      <button
        type="button"
        onClick={onSearch}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label="Search"
      >
        <Search className="h-5 w-5" />
      </button>
      <UserMenu compact />
    </header>
  );
}

// --- Loading Spinner ---

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
    </div>
  );
}

// --- Collapsed Column Rail ---

function CollapsedColumnRail({
  icon: Icon,
  emptyHint,
  items,
  onSelect,
}: {
  icon: React.ComponentType<{ className?: string }>;
  emptyHint?: string;
  items: Array<{ id: string; label: string; selected: boolean }>;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-4 px-1">
        <Icon className="h-5 w-5 text-muted-foreground/30" />
        {emptyHint && (
          <span className="text-[9px] text-center leading-tight text-muted-foreground/40">
            {emptyHint}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-hide">
      <div className="flex flex-col items-center gap-0.5 py-2">
        {items.map((item) => (
          <Tooltip key={item.id}>
            <TooltipTrigger
              onClick={() => onSelect(item.id)}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                item.selected
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground/50 hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <span className={cn(
                "flex h-2 w-2 rounded-full",
                item.selected ? "bg-primary" : "bg-current"
              )} />
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

// --- Time Ago Helper ---

function formatTimeAgo(epochMs: number): string {
  const seconds = Math.floor((Date.now() - epochMs) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// --- Main Component ---

export function MillerColumns() {
  // Current user role is sourced from their membership in the active org.
  const membership = useQuery(api.users.getMyMembership);
  const userRole = membership?.role ?? "viewer";
  const canEdit = userRole === "admin" || userRole === "contributor";

  // URL <-> selection sync plumbing. Selection is mirrored into the query
  // string so the view is refresh-safe, shareable, and Back-traversable.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  // Seed once from the URL (the initializer runs on first render only); later
  // external URL changes (Back/Forward) are reconciled by the read effect below.
  const [initialSelection] = useState(() => readSelectionParams(searchParams));

  // Column collapse state
  const { collapsed, toggle } = useColumnCollapse();

  // Selection state (seeded from the URL so deep links / refresh restore position)
  const [selectedFunctionId, setSelectedFunctionId] =
    useState<Id<"functions"> | null>(initialSelection.fn);
  const [selectedDepartmentId, setSelectedDepartmentId] =
    useState<Id<"departments"> | null>(initialSelection.dept);
  const [selectedProcessId, setSelectedProcessId] =
    useState<Id<"processes"> | null>(initialSelection.proc);

  // Recording modal state
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [recordingMode, setRecordingMode] =
    useState<RecordingMode>("agent");

  // Mobile navigation level
  const [mobileLevel, setMobileLevel] = useState<MobileLevel>(
    deepestMobileLevel(initialSelection),
  );
  const [mobilePreview, setMobilePreview] = useState<MobilePreview>(null);

  // Active detail tab (0 = Conversations, 1 = Process Flow), seeded from the URL.
  const [detailTab, setDetailTab] = useState<number>(initialSelection.tab);

  // Selected names for breadcrumbs / back buttons
  const [selectedFunctionName, setSelectedFunctionName] = useState("");
  const [selectedDepartmentName, setSelectedDepartmentName] = useState("");
  const [selectedProcessName, setSelectedProcessName] = useState("");

  // On-demand summary state (loading/error only - summary now comes from reactive queries)
  const [deptSummaryLoading, setDeptSummaryLoading] = useState(false);
  const [deptSummaryError, setDeptSummaryError] = useState<string | null>(null);
  const [funcSummaryLoading, setFuncSummaryLoading] = useState(false);
  const [funcSummaryError, setFuncSummaryError] = useState<string | null>(null);

  // On-demand summary actions
  const generateDepartmentSummary = useAction(api.summaries.generateDepartmentSummary);
  const generateFunctionSummary = useAction(api.summaries.generateFunctionSummary);
  const forceRefreshProcessSummary = useAction(api.summaries.forceRefreshProcessSummary);
  const [processSummaryRefreshing, setProcessSummaryRefreshing] = useState(false);
  const [expandedProcessSummaryKey, setExpandedProcessSummaryKey] =
    useState<string | null>(null);

  // CRUD mutations/actions
  const createFunction = useMutation(api.functions.create);
  const updateFunction = useMutation(api.functions.update);
  const removeFunction = useMutation(api.functions.remove);
  const createDepartment = useAction(api.departments.create);
  const updateDepartment = useAction(api.departments.update);
  const removeDepartment = useMutation(api.departments.remove);
  const createProcess = useAction(api.processes.create);
  const updateProcess = useAction(api.processes.update);
  const removeProcess = useMutation(api.processes.remove);

  // CRUD dialog state
  const [crudOpen, setCrudOpen] = useState(false);
  const [crudMode, setCrudMode] = useState<"create" | "edit" | "delete">("create");
  const [crudEntity, setCrudEntity] = useState<"Function" | "Department" | "Process">("Function");
  const [crudTargetName, setCrudTargetName] = useState("");
  const [crudTargetDescription, setCrudTargetDescription] = useState("");
  const [crudTargetId, setCrudTargetId] = useState<string | null>(null);
  const [crudCurrentLocationId, setCrudCurrentLocationId] = useState<string | null>(null);

  // Server-computed delete eligibility for the selected delete target.
  const deleteFnEligibility = useQuery(
    api.functions.deleteEligibility,
    crudOpen && crudMode === "delete" && crudEntity === "Function" && crudTargetId
      ? { functionId: crudTargetId as Id<"functions"> }
      : "skip"
  );
  const deleteDeptEligibility = useQuery(
    api.departments.deleteEligibility,
    crudOpen && crudMode === "delete" && crudEntity === "Department" && crudTargetId
      ? { departmentId: crudTargetId as Id<"departments"> }
      : "skip"
  );
  const deleteProcEligibility = useQuery(
    api.processes.deleteEligibility,
    crudOpen && crudMode === "delete" && crudEntity === "Process" && crudTargetId
      ? { processId: crudTargetId as Id<"processes"> }
      : "skip"
  );
  const deleteEligibility =
    crudEntity === "Function"
      ? deleteFnEligibility
      : crudEntity === "Department"
        ? deleteDeptEligibility
        : deleteProcEligibility;

  const handleOpenDeleteCleanup = useCallback(() => {
    if (crudEntity !== "Process" || !crudTargetId) return;
    setCrudOpen(false);
    router.push(`/admin/conversations?processId=${crudTargetId}`);
  }, [crudEntity, crudTargetId, router]);

  const openCrud = useCallback(
    (
      mode: "create" | "edit" | "delete",
      entity: "Function" | "Department" | "Process",
      targetName?: string,
      targetId?: string,
      currentLocationId?: string,
      currentDescription?: string
    ) => {
      setCrudMode(mode);
      setCrudEntity(entity);
      setCrudTargetName(targetName ?? "");
      setCrudTargetDescription(currentDescription ?? "");
      setCrudTargetId(targetId ?? null);
      setCrudCurrentLocationId(currentLocationId ?? null);
      setCrudOpen(true);
    },
    []
  );

  const handleCrudConfirm = useCallback(
    async (name: string, newLocationId?: string, description?: string) => {
      if (crudEntity === "Function") {
        if (crudMode === "create") {
          await createFunction({ name });
        } else if (crudMode === "edit" && crudTargetId) {
          await updateFunction({ functionId: crudTargetId as Id<"functions">, name });
        } else if (crudMode === "delete" && crudTargetId) {
          await removeFunction({ functionId: crudTargetId as Id<"functions"> });
          if (selectedFunctionId === crudTargetId) {
            setSelectedFunctionId(null);
            setSelectedDepartmentId(null);
            setSelectedProcessId(null);
          }
        }
      } else if (crudEntity === "Department") {
        if (crudMode === "create" && selectedFunctionId) {
          await createDepartment({
            functionId: selectedFunctionId,
            name,
            description,
          });
        } else if (crudMode === "edit" && crudTargetId) {
          const newFunctionId = newLocationId as Id<"functions"> | undefined;
          await updateDepartment({
            departmentId: crudTargetId as Id<"departments">,
            name,
            functionId: newFunctionId,
            description,
          });
          if (newFunctionId && newFunctionId !== selectedFunctionId) {
            setSelectedDepartmentId(null);
            setSelectedProcessId(null);
          }
        } else if (crudMode === "delete" && crudTargetId) {
          await removeDepartment({ departmentId: crudTargetId as Id<"departments"> });
          if (selectedDepartmentId === crudTargetId) {
            setSelectedDepartmentId(null);
            setSelectedProcessId(null);
          }
        }
      } else if (crudEntity === "Process") {
        if (crudMode === "create" && selectedDepartmentId) {
          await createProcess({
            departmentId: selectedDepartmentId,
            name,
            description,
          });
        } else if (crudMode === "edit" && crudTargetId) {
          const newDepartmentId = newLocationId as Id<"departments"> | undefined;
          await updateProcess({
            processId: crudTargetId as Id<"processes">,
            name,
            departmentId: newDepartmentId,
            description,
          });
          if (newDepartmentId && newDepartmentId !== selectedDepartmentId) {
            setSelectedProcessId(null);
          }
        } else if (crudMode === "delete" && crudTargetId) {
          await removeProcess({ processId: crudTargetId as Id<"processes"> });
          if (selectedProcessId === crudTargetId) {
            setSelectedProcessId(null);
          }
        }
      }
    },
    [
      crudEntity,
      crudMode,
      crudTargetId,
      selectedFunctionId,
      selectedDepartmentId,
      selectedProcessId,
      createFunction,
      updateFunction,
      removeFunction,
      createDepartment,
      updateDepartment,
      removeDepartment,
      createProcess,
      updateProcess,
      removeProcess,
    ]
  );

  // Convex queries
  const functions = useQuery(api.functions.list);
  const departments = useQuery(
    api.departments.listByFunction,
    selectedFunctionId ? { functionId: selectedFunctionId } : "skip"
  );
  const processes = useQuery(
    api.processes.listByDepartment,
    selectedDepartmentId ? { departmentId: selectedDepartmentId } : "skip"
  );
  const selectedProcess = useQuery(
    api.processes.get,
    selectedProcessId ? { processId: selectedProcessId } : "skip"
  );
  const selectedDepartment = useQuery(
    api.departments.get,
    selectedDepartmentId ? { departmentId: selectedDepartmentId } : "skip"
  );
  const selectedFunction = useQuery(
    api.functions.get,
    selectedFunctionId ? { functionId: selectedFunctionId } : "skip"
  );
  const allDepartments = useQuery(api.departments.listAll);
  const allProcesses = useQuery(api.processes.listAll);
  const attentionProcessIds = useQuery(
    api.conversations.processIdsNeedingAttention,
  );
  const processConversations = useQuery(
    api.conversations.listByProcess,
    selectedProcessId ? { processId: selectedProcessId } : "skip"
  );
  const processSummary = selectedProcess?.rollingSummary;
  const processSummaryKey =
    selectedProcessId && processSummary
      ? `${selectedProcessId}:${processSummary.length}:${processSummary.slice(0, 24)}`
      : null;
  const processSummaryExpanded =
    processSummaryKey !== null && expandedProcessSummaryKey === processSummaryKey;
  const processSummaryCollapsed =
    processSummaryKey !== null && !processSummaryExpanded;
  const completedProcessConversationCount =
    processConversations?.filter((conversation) => conversation.status === "done")
      .length ?? 0;

  // Row scent, derived from the lists already loaded for navigation/search
  // (no per-row queries). See plan: "compute on read".
  const departmentCountByFunction = useMemo(() => {
    const map = new Map<Id<"functions">, number>();
    for (const dept of allDepartments ?? []) {
      map.set(dept.functionId, (map.get(dept.functionId) ?? 0) + 1);
    }
    return map;
  }, [allDepartments]);
  const processCountByDepartment = useMemo(() => {
    const map = new Map<Id<"departments">, number>();
    for (const proc of allProcesses ?? []) {
      map.set(proc.departmentId, (map.get(proc.departmentId) ?? 0) + 1);
    }
    return map;
  }, [allProcesses]);
  const attentionProcessIdSet = useMemo(
    () => new Set(attentionProcessIds ?? []),
    [attentionProcessIds],
  );

  // Display names sourced from the reactive docs so renames reflect immediately,
  // falling back to the snapshot captured at selection time while the doc loads.
  const functionDisplayName = selectedFunction?.name ?? selectedFunctionName;
  const departmentDisplayName = selectedDepartment?.name ?? selectedDepartmentName;
  const processDisplayName = selectedProcess?.name ?? selectedProcessName;

  // Clear selection when a selected entity is removed out from under us (e.g.
  // deleted by another member). The `get` queries resolve to `null` (not
  // `undefined`) only once loaded-and-missing, so this never fires mid-load,
  // and clearing the id skips the query so the null condition can't re-fire.
  //
  // This is the legitimate "subscribe to an external system, setState when it
  // changes" case the lint rule below describes — the external system is the
  // Convex reactive store telling us the doc no longer exists.
  /* eslint-disable react-hooks/set-state-in-effect -- reacting to a Convex subscription; see note above */
  useEffect(() => {
    if (selectedFunctionId && selectedFunction === null) {
      setSelectedFunctionId(null);
      setSelectedFunctionName("");
      setSelectedDepartmentId(null);
      setSelectedDepartmentName("");
      setSelectedProcessId(null);
      setSelectedProcessName("");
    }
  }, [selectedFunctionId, selectedFunction]);

  useEffect(() => {
    if (selectedDepartmentId && selectedDepartment === null) {
      setSelectedDepartmentId(null);
      setSelectedDepartmentName("");
      setSelectedProcessId(null);
      setSelectedProcessName("");
    }
  }, [selectedDepartmentId, selectedDepartment]);

  useEffect(() => {
    if (selectedProcessId && selectedProcess === null) {
      setSelectedProcessId(null);
      setSelectedProcessName("");
    }
  }, [selectedProcessId, selectedProcess]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // --- URL <-> selection synchronization ---
  //
  // `committed` is the selection the URL should reflect. On mobile a row tap can
  // *preview* an item (loading its summary) without drilling in, so only ids
  // at-or-above the current drill level count as committed; on desktop every
  // selected id is committed.
  const committed = useMemo<SelectionParams>(() => {
    const ids = isMobile
      ? {
          fn: mobileLevel >= 2 ? selectedFunctionId : null,
          dept: mobileLevel >= 3 ? selectedDepartmentId : null,
          proc: mobileLevel >= 4 ? selectedProcessId : null,
        }
      : {
          fn: selectedFunctionId,
          dept: selectedDepartmentId,
          proc: selectedProcessId,
        };
    return { ...ids, tab: detailTab };
  }, [
    isMobile,
    mobileLevel,
    selectedFunctionId,
    selectedDepartmentId,
    selectedProcessId,
    detailTab,
  ]);

  // Write: mirror the committed selection into the URL (push, so Back walks up
  // the hierarchy). Keyed on `committed` ONLY — deliberately NOT on
  // `searchParams` — so that an inbound URL change (Back/Forward, applied by the
  // read effect below) can't race this effect into re-pushing the
  // pre-navigation selection.
  useEffect(() => {
    const target = buildSelectionQuery(searchParams, committed);
    if (target !== searchParams.toString()) {
      router.push(target ? `${pathname}?${target}` : pathname, {
        scroll: false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- excludes `searchParams` by design; see note above
  }, [committed, pathname, router]);

  // Read: reconcile state when the URL changes from the outside (Back/Forward,
  // deep link). Keyed on `searchParams` ONLY — deliberately NOT on the selection
  // state — so a local selection change can't be clobbered before the write
  // effect runs. Names reset to "" and re-resolve via the *DisplayName fallbacks.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- reacting to external URL changes; deps limited to `searchParams` by design */
  useEffect(() => {
    const next = readSelectionParams(searchParams);
    if (
      next.fn !== selectedFunctionId ||
      next.dept !== selectedDepartmentId ||
      next.proc !== selectedProcessId ||
      next.tab !== detailTab
    ) {
      setSelectedFunctionId(next.fn);
      setSelectedDepartmentId(next.dept);
      setSelectedProcessId(next.proc);
      setSelectedFunctionName("");
      setSelectedDepartmentName("");
      setSelectedProcessName("");
      setMobileLevel(deepestMobileLevel(next));
      setDetailTab(next.tab);
    }
  }, [searchParams]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  // Location options for edit modals
  const departmentLocationOptions = (functions ?? []).map((fn) => ({
    value: fn._id,
    label: fn.name,
  }));
  const processLocationOptions = (allDepartments ?? []).map((dept) => ({
    value: dept._id,
    label: dept.name,
    group: dept.functionName,
  }));

  // Selection handlers
  const handleSelectFunction = useCallback(
    (id: Id<"functions">, name: string) => {
      setSelectedFunctionId(id);
      setSelectedFunctionName(name);
      setSelectedDepartmentId(null);
      setSelectedDepartmentName("");
      setSelectedProcessId(null);
      setSelectedProcessName("");
      setDeptSummaryError(null);
      setFuncSummaryError(null);
      setMobilePreview(null);
      setMobileLevel(2);
    },
    []
  );

  const handlePreviewFunction = useCallback(
    (id: Id<"functions">, name: string) => {
      setSelectedFunctionId(id);
      setSelectedFunctionName(name);
      setSelectedDepartmentId(null);
      setSelectedDepartmentName("");
      setSelectedProcessId(null);
      setSelectedProcessName("");
      setDeptSummaryError(null);
      setFuncSummaryError(null);
      setMobilePreview({ type: "function", id, name });
    },
    []
  );

  const handleSelectDepartment = useCallback(
    (id: Id<"departments">, name: string) => {
      setSelectedDepartmentId(id);
      setSelectedDepartmentName(name);
      setSelectedProcessId(null);
      setSelectedProcessName("");
      setDeptSummaryError(null);
      setMobilePreview(null);
      setMobileLevel(3);
    },
    []
  );

  const handlePreviewDepartment = useCallback(
    (id: Id<"departments">, name: string) => {
      setSelectedDepartmentId(id);
      setSelectedDepartmentName(name);
      setSelectedProcessId(null);
      setSelectedProcessName("");
      setDeptSummaryError(null);
      setMobilePreview({ type: "department", id, name });
    },
    []
  );

  const handleSelectProcess = useCallback(
    (id: Id<"processes">, name: string) => {
      setSelectedProcessId(id);
      setSelectedProcessName(name);
      setMobilePreview(null);
      setMobileLevel(4);
    },
    []
  );

  const handlePreviewProcess = useCallback(
    (id: Id<"processes">, name: string) => {
      setSelectedProcessId(id);
      setSelectedProcessName(name);
      setMobilePreview({ type: "process", id, name });
    },
    []
  );

  // --- Command palette (⌘K jump-to-anything) ---
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Jump straight to a full selection path (sets every level at once); the
  // Phase-2 URL write effect then mirrors it to the query string.
  const jumpToDepartment = useCallback(
    (
      functionId: Id<"functions">,
      functionName: string,
      departmentId: Id<"departments">,
      departmentName: string,
    ) => {
      setSelectedFunctionId(functionId);
      setSelectedFunctionName(functionName);
      setSelectedDepartmentId(departmentId);
      setSelectedDepartmentName(departmentName);
      setSelectedProcessId(null);
      setSelectedProcessName("");
      setDeptSummaryError(null);
      setFuncSummaryError(null);
      setMobilePreview(null);
      setMobileLevel(3);
    },
    []
  );

  const jumpToProcess = useCallback(
    (
      functionId: Id<"functions">,
      functionName: string,
      departmentId: Id<"departments">,
      departmentName: string,
      processId: Id<"processes">,
      processName: string,
    ) => {
      setSelectedFunctionId(functionId);
      setSelectedFunctionName(functionName);
      setSelectedDepartmentId(departmentId);
      setSelectedDepartmentName(departmentName);
      setSelectedProcessId(processId);
      setSelectedProcessName(processName);
      setDeptSummaryError(null);
      setFuncSummaryError(null);
      setMobilePreview(null);
      setMobileLevel(4);
    },
    []
  );

  // --- Column renderers ---

  const functionsColumn = (mobile?: boolean, collapsed?: boolean) => (
    <div className="flex h-full flex-col">
      <ColumnHeader
        title="Functions"
        count={functions?.length}
        onAdd={canEdit ? () => openCrud("create", "Function") : undefined}
        icon={Building2}
        collapsed={collapsed}
        onToggle={!mobile ? () => toggle("functions") : undefined}
        mobile={mobile}
      />
      {collapsed ? (
        <CollapsedColumnRail
          icon={Building2}
          items={(functions ?? []).map((fn) => ({
            id: fn._id,
            label: fn.name,
            selected: selectedFunctionId === fn._id,
          }))}
          onSelect={(id) => {
            const fn = functions?.find((f) => f._id === id);
            if (fn) handleSelectFunction(fn._id, fn.name);
          }}
          emptyHint="No functions"
        />
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          <div className={cn("space-y-0.5 p-2", mobile && "space-y-2 p-3")}>
            {functions === undefined ? (
              <LoadingSpinner />
            ) : functions.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="No functions yet"
                description="Organizational functions will appear here."
                actionLabel={canEdit ? "Add function" : undefined}
                onAction={canEdit ? () => openCrud("create", "Function") : undefined}
              />
            ) : (
              functions.map((fn) => (
                <ColumnItem
                  key={fn._id}
                  label={fn.name}
                  selected={selectedFunctionId === fn._id}
                  indicator="arrow"
                  count={departmentCountByFunction.get(fn._id) ?? 0}
                  status={fn.summaryStale ? "stale" : undefined}
                  onClick={() =>
                    mobile
                      ? handlePreviewFunction(fn._id, fn.name)
                      : handleSelectFunction(fn._id, fn.name)
                  }
                  onNavigate={mobile ? () => handleSelectFunction(fn._id, fn.name) : undefined}
                  navigateLabel={`View departments in ${fn.name}`}
                  onEdit={canEdit && mobile ? () => openCrud("edit", "Function", fn.name, fn._id) : undefined}
                  onDelete={canEdit && mobile ? () => openCrud("delete", "Function", fn.name, fn._id) : undefined}
                  mobile={mobile}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );

  const departmentsColumn = (mobile?: boolean, collapsed?: boolean) => (
    <div className="flex h-full flex-col">
      {mobile && selectedFunctionId && (
        <div className="shrink-0 border-b bg-background px-2 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMobileLevel(1)}
            className="min-h-10 gap-2 px-3 text-sm"
          >
            <ChevronLeft className="h-4 w-4" />
            Functions
          </Button>
        </div>
      )}
      <ColumnHeader
        title="Departments"
        count={departments?.length}
        onAdd={canEdit && selectedFunctionId ? () => openCrud("create", "Department") : undefined}
        icon={Layers}
        collapsed={collapsed}
        onToggle={!mobile ? () => toggle("departments") : undefined}
        mobile={mobile}
      />
      {collapsed ? (
        <CollapsedColumnRail
          icon={Layers}
          emptyHint={!selectedFunctionId ? "Select a function" : "No departments"}
          items={
            !selectedFunctionId
              ? []
              : (departments ?? []).map((dept) => ({
                  id: dept._id,
                  label: dept.name,
                  selected: selectedDepartmentId === dept._id,
                }))
          }
          onSelect={(id) => {
            const dept = departments?.find((d) => d._id === id);
            if (dept) handleSelectDepartment(dept._id, dept.name);
          }}
        />
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          <div className={cn("space-y-0.5 p-2", mobile && "space-y-2 p-3")}>
            {!selectedFunctionId ? (
              <EmptyState
                icon={Layers}
                title="Select a function"
                description="Choose a function from the list to see its departments."
              />
            ) : departments === undefined ? (
              <LoadingSpinner />
            ) : departments.length === 0 ? (
              <EmptyState
                icon={Layers}
                title="No departments"
                description="This function has no departments defined yet."
                actionLabel={canEdit ? "Add department" : undefined}
                onAction={
                  canEdit && selectedFunctionId
                    ? () => openCrud("create", "Department")
                    : undefined
                }
              />
            ) : (
              departments.map((dept) => (
                <ColumnItem
                  key={dept._id}
                  label={dept.name}
                  selected={selectedDepartmentId === dept._id}
                  indicator="arrow"
                  count={processCountByDepartment.get(dept._id) ?? 0}
                  status={dept.summaryStale ? "stale" : undefined}
                  onClick={() =>
                    mobile
                      ? handlePreviewDepartment(dept._id, dept.name)
                      : handleSelectDepartment(dept._id, dept.name)
                  }
                  onNavigate={mobile ? () => handleSelectDepartment(dept._id, dept.name) : undefined}
                  navigateLabel={`View processes in ${dept.name}`}
                  onEdit={canEdit && mobile ? () => openCrud("edit", "Department", dept.name, dept._id, dept.functionId, dept.description) : undefined}
                  onDelete={canEdit && mobile ? () => openCrud("delete", "Department", dept.name, dept._id) : undefined}
                  mobile={mobile}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );

  const processesColumn = (mobile?: boolean, collapsed?: boolean) => (
    <div className="flex h-full flex-col">
      {mobile && selectedDepartmentId && (
        <div className="shrink-0 border-b bg-background px-2 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMobileLevel(2)}
            className="min-h-10 max-w-full gap-2 px-3 text-sm"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="truncate">{functionDisplayName || "Departments"}</span>
          </Button>
        </div>
      )}
      <ColumnHeader
        title="Processes"
        count={processes?.length}
        onAdd={canEdit && selectedDepartmentId ? () => openCrud("create", "Process") : undefined}
        icon={Cog}
        collapsed={collapsed}
        onToggle={!mobile ? () => toggle("processes") : undefined}
        mobile={mobile}
      />
      {collapsed ? (
        <CollapsedColumnRail
          icon={Cog}
          emptyHint={!selectedDepartmentId ? "Select a department" : "No processes"}
          items={
            !selectedDepartmentId
              ? []
              : (processes ?? []).map((proc) => ({
                  id: proc._id,
                  label: proc.name,
                  selected: selectedProcessId === proc._id,
                }))
          }
          onSelect={(id) => {
            const proc = processes?.find((p) => p._id === id);
            if (proc) handleSelectProcess(proc._id, proc.name);
          }}
        />
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          <div className={cn("space-y-0.5 p-2", mobile && "space-y-2 p-3")}>
            {!selectedDepartmentId ? (
              <EmptyState
                icon={Cog}
                title="Select a department"
                description="Choose a department to see its processes."
              />
            ) : processes === undefined ? (
              <LoadingSpinner />
            ) : processes.length === 0 ? (
              <EmptyState
                icon={Cog}
                title="No processes"
                description="No processes defined yet for this department."
                actionLabel={canEdit ? "Add process" : undefined}
                onAction={
                  canEdit && selectedDepartmentId
                    ? () => openCrud("create", "Process")
                    : undefined
                }
              />
            ) : (
              processes.map((proc) => (
                <ColumnItem
                  key={proc._id}
                  label={proc.name}
                  selected={selectedProcessId === proc._id}
                  indicator="dot"
                  status={
                    attentionProcessIdSet.has(proc._id)
                      ? "attention"
                      : proc.rollingSummary
                        ? "knowledge"
                        : undefined
                  }
                  onClick={() =>
                    mobile
                      ? handlePreviewProcess(proc._id, proc.name)
                      : handleSelectProcess(proc._id, proc.name)
                  }
                  onNavigate={mobile ? () => handleSelectProcess(proc._id, proc.name) : undefined}
                  navigateLabel={`Open ${proc.name}`}
                  onEdit={canEdit && mobile ? () => openCrud("edit", "Process", proc.name, proc._id, proc.departmentId, proc.description) : undefined}
                  onDelete={canEdit && mobile ? () => openCrud("delete", "Process", proc.name, proc._id) : undefined}
                  mobile={mobile}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );

  const detailPanel = (mobile?: boolean) => (
    <div className="flex h-full flex-col">
      {mobile && selectedProcessId && (
        <div className="shrink-0 border-b bg-background px-2 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMobileLevel(3)}
            className="min-h-10 max-w-full gap-2 px-3 text-sm"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="truncate">{departmentDisplayName || "Processes"}</span>
          </Button>
        </div>
      )}
      {!selectedProcessId ? (
        <div className="flex flex-1 flex-col overflow-y-auto scrollbar-hide">
          <ColumnHeader
            title={selectedDepartmentId ? "Department Overview" : selectedFunctionId ? "Function Overview" : "Process Detail"}
            mobile={mobile}
            actions={
              canEdit && selectedDepartmentId ? (
                <OverviewActions
                  entityLabel={departmentDisplayName}
                  onEdit={() =>
                    selectedDepartmentId &&
                    openCrud(
                      "edit",
                      "Department",
                      departmentDisplayName,
                      selectedDepartmentId,
                      selectedDepartment?.functionId,
                      selectedDepartment?.description
                    )
                  }
                  onDelete={() =>
                    selectedDepartmentId &&
                    openCrud("delete", "Department", departmentDisplayName, selectedDepartmentId)
                  }
                />
              ) : canEdit && selectedFunctionId ? (
                <OverviewActions
                  entityLabel={functionDisplayName}
                  onEdit={() =>
                    selectedFunctionId &&
                    openCrud("edit", "Function", functionDisplayName, selectedFunctionId)
                  }
                  onDelete={() =>
                    selectedFunctionId &&
                    openCrud("delete", "Function", functionDisplayName, selectedFunctionId)
                  }
                />
              ) : undefined
            }
          />

          {/* On-demand Department Summary */}
          {selectedDepartmentId && !selectedProcessId && (
            <div className="space-y-4 p-4 md:p-6">
              {selectedDepartment?.description && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      Department Description
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      {selectedDepartment.description}
                    </p>
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                    Department Summary
                    {selectedDepartment?.summaryStale && selectedDepartment?.summary && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        New data available
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {selectedDepartment?.summary
                      ? `AI-synthesized overview of processes in ${departmentDisplayName}.`
                      : `Generate an AI-synthesized overview of all processes in ${departmentDisplayName}.`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {deptSummaryLoading && selectedDepartment?.summary && (
                    <div className="relative">
                      <div className="opacity-50">
                        <MarkdownSummary content={selectedDepartment.summary} />
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                    </div>
                  )}
                  {!deptSummaryLoading && selectedDepartment?.summary && (
                    <MarkdownSummary content={selectedDepartment.summary} />
                  )}
                  {selectedDepartment?.summaryUpdatedAt && (
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
                      <Clock className="h-3 w-3" />
                      Last refreshed: {formatTimeAgo(selectedDepartment.summaryUpdatedAt)}
                    </div>
                  )}
                  {deptSummaryError && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
                      {deptSummaryError}
                    </div>
                  )}
                  <Button
                    variant={
                      !selectedDepartment?.summary
                        ? "default"
                        : selectedDepartment?.summaryStale
                          ? "default"
                          : "outline"
                    }
                    size="sm"
                    className="gap-2"
                    disabled={deptSummaryLoading}
                    onClick={async () => {
                      if (!selectedDepartmentId) return;
                      setDeptSummaryLoading(true);
                      setDeptSummaryError(null);
                      try {
                        const result = await generateDepartmentSummary({
                          departmentId: selectedDepartmentId,
                          forceRefresh: !!selectedDepartment?.summary && !selectedDepartment?.summaryStale,
                        });
                        if (!result.summary && result.message) {
                          setDeptSummaryError(result.message);
                        }
                      } catch {
                        setDeptSummaryError("Failed to generate summary. Please try again.");
                      } finally {
                        setDeptSummaryLoading(false);
                      }
                    }}
                  >
                    {deptSummaryLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating...
                      </>
                    ) : !selectedDepartment?.summary ? (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Generate Summary
                      </>
                    ) : selectedDepartment?.summaryStale ? (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Refresh Summary
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Regenerate
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
              <p className="text-center text-xs text-muted-foreground">
                Select a process from the list to view conversations and details.
              </p>
            </div>
          )}

          {/* On-demand Function Summary */}
          {selectedFunctionId && !selectedDepartmentId && (
            <div className="space-y-4 p-4 md:p-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                    Function Summary
                    {selectedFunction?.summaryStale && selectedFunction?.summary && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        New data available
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {selectedFunction?.summary
                      ? `AI-synthesized overview of departments across ${functionDisplayName}.`
                      : `Generate an AI-synthesized overview of all departments across ${functionDisplayName}.`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {funcSummaryLoading && selectedFunction?.summary && (
                    <div className="relative">
                      <div className="opacity-50">
                        <MarkdownSummary content={selectedFunction.summary} />
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                    </div>
                  )}
                  {!funcSummaryLoading && selectedFunction?.summary && (
                    <MarkdownSummary content={selectedFunction.summary} />
                  )}
                  {selectedFunction?.summaryUpdatedAt && (
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
                      <Clock className="h-3 w-3" />
                      Last refreshed: {formatTimeAgo(selectedFunction.summaryUpdatedAt)}
                    </div>
                  )}
                  {funcSummaryError && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
                      {funcSummaryError}
                    </div>
                  )}
                  <Button
                    variant={
                      !selectedFunction?.summary
                        ? "default"
                        : selectedFunction?.summaryStale
                          ? "default"
                          : "outline"
                    }
                    size="sm"
                    className="gap-2"
                    disabled={funcSummaryLoading}
                    onClick={async () => {
                      if (!selectedFunctionId) return;
                      setFuncSummaryLoading(true);
                      setFuncSummaryError(null);
                      try {
                        const result = await generateFunctionSummary({
                          functionId: selectedFunctionId,
                          forceRefresh: !!selectedFunction?.summary && !selectedFunction?.summaryStale,
                        });
                        if (!result.summary && result.message) {
                          setFuncSummaryError(result.message);
                        }
                      } catch {
                        setFuncSummaryError("Failed to generate summary. Please try again.");
                      } finally {
                        setFuncSummaryLoading(false);
                      }
                    }}
                  >
                    {funcSummaryLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating...
                      </>
                    ) : !selectedFunction?.summary ? (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Generate Summary
                      </>
                    ) : selectedFunction?.summaryStale ? (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Refresh Summary
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Regenerate
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
              <p className="text-center text-xs text-muted-foreground">
                Select a department to drill down further.
              </p>
            </div>
          )}

          {/* No selection at all */}
          {!selectedFunctionId && (
            <EmptyState
              icon={FileText}
              title="Select a function"
              description="Choose a function to start navigating the organization."
            />
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Breadcrumb bar */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink
                    className="cursor-pointer text-xs"
                    onClick={() => {
                      setSelectedDepartmentId(null);
                      setSelectedProcessId(null);
                      setMobileLevel(2);
                    }}
                  >
                    {functionDisplayName}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink
                    className="cursor-pointer text-xs"
                    onClick={() => {
                      setSelectedProcessId(null);
                      setMobileLevel(3);
                    }}
                  >
                    {departmentDisplayName}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage className="text-xs">
                    {processDisplayName}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            {!mobile && canEdit && selectedProcessId && (
              <OverviewActions
                entityLabel={processDisplayName}
                onEdit={() =>
                  selectedProcessId &&
                  openCrud(
                    "edit",
                    "Process",
                    processDisplayName,
                    selectedProcessId,
                    selectedProcess?.departmentId,
                    selectedProcess?.description
                  )
                }
                onDelete={() =>
                  selectedProcessId &&
                  openCrud("delete", "Process", processDisplayName, selectedProcessId)
                }
              />
            )}
          </div>

          <Tabs
            value={detailTab}
            onValueChange={(value) =>
              setDetailTab(typeof value === "number" ? value : 0)
            }
            className="flex flex-1 flex-col overflow-hidden gap-0"
          >
            <div className="shrink-0 border-b px-4">
              <TabsList variant="line" className="h-9">
                <TabsTrigger value={0} className="gap-1.5 text-xs">
                  <Mic className="h-3.5 w-3.5" />
                  Conversations
                </TabsTrigger>
                <TabsTrigger value={1} className="gap-1.5 text-xs">
                  <GitBranch className="h-3.5 w-3.5" />
                  Process Flow
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Conversations tab */}
            <TabsContent value={0} className="flex-1 overflow-y-auto scrollbar-hide">
              <div className="space-y-6 p-4 md:p-6">
                {selectedProcess?.description && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        Process Description
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                        {selectedProcess.description}
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* Capture inputs — contributors and admins only */}
                {canEdit && (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      variant="default"
                      size="lg"
                      aria-label="Start AI interview"
                      className="min-h-12 flex-1 justify-start gap-2 rounded-xl"
                      onClick={() => {
                        setRecordingMode("agent");
                        setRecordingOpen(true);
                      }}
                    >
                      <Bot className="h-4 w-4" />
                      AI Interview
                    </Button>
                    <div className="flex flex-1 gap-px">
                      <Button
                        variant="outline"
                        size="lg"
                        aria-label="Start voice record"
                        className="min-h-12 flex-1 justify-start gap-2 rounded-l-xl rounded-r-none"
                        onClick={() => {
                          setRecordingMode("voiceRecord");
                          setRecordingOpen(true);
                        }}
                      >
                        <Mic className="h-4 w-4" />
                        Voice Record
                      </Button>
                      <Button
                        variant="outline"
                        size="lg"
                        aria-label="Upload audio file"
                        title="Upload audio file"
                        className="min-h-12 flex-1 justify-start gap-2 rounded-l-none rounded-r-xl"
                        onClick={() => {
                          setRecordingMode("audioUpload");
                          setRecordingOpen(true);
                        }}
                      >
                        <Upload className="h-4 w-4" />
                        Upload Audio
                      </Button>
                    </div>
                  </div>
                )}

                {canEdit && selectedProcessId && (
                  <RecordingModal
                    open={recordingOpen}
                    onOpenChange={setRecordingOpen}
                    processId={selectedProcessId}
                    processName={processDisplayName}
                    functionName={functionDisplayName}
                    departmentName={departmentDisplayName}
                    departmentDescription={
                      selectedDepartment?.descriptionSafetyStatus === "safe"
                        ? selectedDepartment.description
                        : undefined
                    }
                    processDescription={
                      selectedProcess?.descriptionSafetyStatus === "safe"
                        ? selectedProcess.description
                        : undefined
                    }
                    mode={recordingMode}
                  />
                )}

                {/* Process Summary Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      Process Summary
                    </CardTitle>
                    {!processSummary && (
                      <CardDescription>
                        No summary yet — record a conversation to get started.
                      </CardDescription>
                    )}
                  </CardHeader>
                  {processSummary && (
                    <CardContent className="space-y-4">
                      <div className="relative">
                        <div
                          className={cn(
                            "relative",
                            processSummaryRefreshing && "opacity-50",
                          )}
                        >
                          <div
                            className={cn(
                              "relative transition-[max-height] duration-200 ease-linear",
                              processSummaryCollapsed && "overflow-hidden",
                            )}
                            style={
                              processSummaryCollapsed
                                ? { maxHeight: PROCESS_SUMMARY_COLLAPSED_HEIGHT }
                                : undefined
                            }
                          >
                            <MarkdownSummary content={processSummary} />
                            {processSummaryCollapsed && (
                              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-card to-card/0" />
                            )}
                          </div>
                        </div>
                        {processSummaryRefreshing && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                          </div>
                        )}
                      </div>
                      {processSummaryKey && (
                        <button
                          type="button"
                          className="focus-ring mx-auto flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          aria-expanded={processSummaryExpanded}
                          onClick={() => {
                            setExpandedProcessSummaryKey(
                              processSummaryExpanded ? null : processSummaryKey,
                            );
                          }}
                        >
                          {processSummaryExpanded ? "See less" : "See more"}
                          {processSummaryExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>
                      )}
                      {canEdit && selectedProcessId && completedProcessConversationCount > 1 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          disabled={processSummaryRefreshing}
                          onClick={async () => {
                            if (!selectedProcessId) return;
                            setProcessSummaryRefreshing(true);
                            try {
                              await forceRefreshProcessSummary({
                                processId: selectedProcessId,
                              });
                            } catch {
                              // Error is logged server-side
                            } finally {
                              setProcessSummaryRefreshing(false);
                            }
                          }}
                        >
                          {processSummaryRefreshing ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Rebuilding...
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-4 w-4" />
                              Rebuild from all transcripts
                            </>
                          )}
                        </Button>
                      )}
                    </CardContent>
                  )}
                </Card>

                {/* Conversations section */}
                <ConversationLog processId={selectedProcessId!} />
              </div>
            </TabsContent>

            {/* Process Flow tab */}
            <TabsContent value={1} className="flex flex-1 overflow-hidden">
              <Suspense
                fallback={
                  <div className="flex flex-1 items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                }
              >
                <ProcessFlow
                  processId={selectedProcessId!}
                  conversationCount={completedProcessConversationCount}
                />
              </Suspense>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );

  const mobilePreviewSummary =
    mobilePreview?.type === "function"
      ? selectedFunction?.summary
      : mobilePreview?.type === "department"
        ? selectedDepartment?.summary
        : mobilePreview?.type === "process"
          ? selectedProcess?.rollingSummary
          : undefined;
  const mobilePreviewUpdatedAt =
    mobilePreview?.type === "function"
      ? selectedFunction?.summaryUpdatedAt
      : mobilePreview?.type === "department"
        ? selectedDepartment?.summaryUpdatedAt
        : undefined;
  const mobilePreviewStale =
    mobilePreview?.type === "function"
      ? selectedFunction?.summaryStale
      : mobilePreview?.type === "department"
        ? selectedDepartment?.summaryStale
        : false;
  const mobilePreviewLoading =
    mobilePreview?.type === "function"
      ? funcSummaryLoading
      : mobilePreview?.type === "department"
        ? deptSummaryLoading
        : false;
  const mobilePreviewError =
    mobilePreview?.type === "function"
      ? funcSummaryError
      : mobilePreview?.type === "department"
        ? deptSummaryError
        : null;
  const mobilePreviewTitle =
    mobilePreview?.type === "function"
      ? "Function Summary"
      : mobilePreview?.type === "department"
        ? "Department Summary"
        : "Process Summary";
  const mobilePreviewDescription =
    mobilePreview?.type === "function"
      ? "An at-a-glance view of the departments and work in this function."
      : mobilePreview?.type === "department"
        ? "An at-a-glance view of the processes inside this department."
        : "The current process brief synthesized from captured conversations.";
  const mobilePreviewNavigateLabel =
    mobilePreview?.type === "function"
      ? "View departments"
      : mobilePreview?.type === "department"
        ? "View processes"
        : "Open process details";
  const canGenerateMobilePreviewSummary =
    mobilePreview?.type === "function" || mobilePreview?.type === "department";
  const mobilePreviewGenerateLabel = mobilePreviewLoading
    ? "Generating..."
    : !mobilePreviewSummary
      ? "Generate Summary"
      : mobilePreviewStale
        ? "Refresh Summary"
        : "Regenerate";

  const handleGenerateMobilePreviewSummary = async () => {
    if (!mobilePreview) return;

    if (mobilePreview.type === "function") {
      setFuncSummaryLoading(true);
      setFuncSummaryError(null);
      try {
        const result = await generateFunctionSummary({
          functionId: mobilePreview.id,
          forceRefresh: !!selectedFunction?.summary && !selectedFunction?.summaryStale,
        });
        if (!result.summary && result.message) {
          setFuncSummaryError(result.message);
        }
      } catch {
        setFuncSummaryError("Failed to generate summary. Please try again.");
      } finally {
        setFuncSummaryLoading(false);
      }
      return;
    }

    if (mobilePreview.type === "department") {
      setDeptSummaryLoading(true);
      setDeptSummaryError(null);
      try {
        const result = await generateDepartmentSummary({
          departmentId: mobilePreview.id,
          forceRefresh: !!selectedDepartment?.summary && !selectedDepartment?.summaryStale,
        });
        if (!result.summary && result.message) {
          setDeptSummaryError(result.message);
        }
      } catch {
        setDeptSummaryError("Failed to generate summary. Please try again.");
      } finally {
        setDeptSummaryLoading(false);
      }
    }
  };

  const handleMobilePreviewNavigate = () => {
    if (!mobilePreview) return;

    if (mobilePreview.type === "function") {
      setSelectedFunctionId(mobilePreview.id);
      setSelectedFunctionName(mobilePreview.name);
      setMobileLevel(2);
    } else if (mobilePreview.type === "department") {
      setSelectedDepartmentId(mobilePreview.id);
      setSelectedDepartmentName(mobilePreview.name);
      setMobileLevel(3);
    } else {
      setSelectedProcessId(mobilePreview.id);
      setSelectedProcessName(mobilePreview.name);
      setMobileLevel(4);
    }

    setMobilePreview(null);
  };

  return (
    <TooltipProvider>
    <div className="flex h-full flex-col bg-background">
      {/* App header — desktop only */}
      <header className="hidden shrink-0 items-center justify-between border-b bg-background px-6 py-3 md:flex">
        <WorkspaceBrand />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label="Search the organization"
          >
            <Search className="h-4 w-4" />
            <span>Search…</span>
            <kbd className="ml-2 rounded border bg-background px-1.5 font-sans text-[11px] text-muted-foreground">
              ⌘K
            </kbd>
          </button>
          <UserMenu />
        </div>
      </header>

      {/* Desktop: 4 side-by-side columns */}
      <div className="hidden flex-1 overflow-hidden md:flex">
        <div className={cn(
          "flex shrink-0 flex-col border-r bg-muted/10 transition-[width] duration-200 ease-linear overflow-hidden",
          collapsed.functions ? "w-12" : "w-[220px]"
        )}>
          {functionsColumn(false, collapsed.functions)}
        </div>
        <div className={cn(
          "flex shrink-0 flex-col border-r bg-muted/10 transition-[width] duration-200 ease-linear overflow-hidden",
          collapsed.departments ? "w-12" : "w-[220px]"
        )}>
          {departmentsColumn(false, collapsed.departments)}
        </div>
        <div className={cn(
          "flex shrink-0 flex-col border-r bg-muted/10 transition-[width] duration-200 ease-linear overflow-hidden",
          collapsed.processes ? "w-12" : "w-[220px]"
        )}>
          {processesColumn(false, collapsed.processes)}
        </div>
        <div className="flex flex-1 flex-col">
          {detailPanel()}
        </div>
      </div>

      {/* Mobile: stacked single column */}
      <div className="flex flex-1 flex-col overflow-hidden md:hidden">
        <MobileAppHeader onSearch={() => setPaletteOpen(true)} />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {mobileLevel === 1 && functionsColumn(true)}
          {mobileLevel === 2 && departmentsColumn(true)}
          {mobileLevel === 3 && processesColumn(true)}
          {mobileLevel === 4 && detailPanel(true)}
        </div>
      </div>

      <Sheet
        open={!!mobilePreview}
        onOpenChange={(open) => {
          if (!open) setMobilePreview(null);
        }}
      >
        <SheetContent
          side="bottom"
          className="max-h-[82dvh] gap-0 overflow-hidden rounded-t-2xl p-0"
        >
          <SheetHeader className="border-b p-5 pr-14">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                {mobilePreview?.type === "function" ? (
                  <Building2 className="h-5 w-5" />
                ) : mobilePreview?.type === "department" ? (
                  <Layers className="h-5 w-5" />
                ) : (
                  <Cog className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate text-base">
                  {mobilePreview?.name}
                </SheetTitle>
                <SheetDescription className="truncate text-xs">
                  {mobilePreviewTitle}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {mobilePreviewDescription}
              </p>
              {mobilePreviewStale && mobilePreviewSummary && (
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-medium text-amber-700">
                  New data
                </span>
              )}
            </div>

            {mobilePreviewLoading && !mobilePreviewSummary ? (
              <LoadingSpinner />
            ) : mobilePreviewSummary ? (
              <div className="relative rounded-xl border bg-background p-4">
                {mobilePreviewLoading && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/70">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                )}
                <MarkdownSummary content={mobilePreviewSummary} />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
                {mobilePreview?.type === "process"
                  ? "No process summary yet. Open the process details to record or review conversations."
                  : "No summary has been generated yet."}
              </div>
            )}

            {mobilePreviewUpdatedAt && (
              <div className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground/70">
                <Clock className="h-3 w-3" />
                Last refreshed: {formatTimeAgo(mobilePreviewUpdatedAt)}
              </div>
            )}

            {mobilePreviewError && (
              <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
                {mobilePreviewError}
              </div>
            )}
          </div>

          <SheetFooter className="border-t p-4">
            {canGenerateMobilePreviewSummary && (
              <Button
                variant={
                  !mobilePreviewSummary || mobilePreviewStale
                    ? "default"
                    : "outline"
                }
                size="lg"
                className="min-h-11 w-full gap-2 rounded-xl"
                disabled={mobilePreviewLoading}
                onClick={handleGenerateMobilePreviewSummary}
              >
                {mobilePreviewLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {mobilePreviewGenerateLabel}
              </Button>
            )}
            <Button
              variant="outline"
              size="lg"
              className="min-h-12 w-full justify-between rounded-xl"
              onClick={handleMobilePreviewNavigate}
            >
              {mobilePreviewNavigateLabel}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* CRUD Dialog */}
      {crudOpen && (
        <CrudDialog
          open={crudOpen}
          onOpenChange={setCrudOpen}
          mode={crudMode}
          entityType={crudEntity}
          currentName={crudTargetName}
          currentDescription={crudTargetDescription}
          currentLocationId={crudCurrentLocationId ?? undefined}
          locationOptions={
            crudMode === "edit" && crudEntity === "Department"
              ? departmentLocationOptions
              : crudMode === "edit" && crudEntity === "Process"
                ? processLocationOptions
                : undefined
          }
          locationLabel={
            crudEntity === "Department"
              ? "Function"
              : crudEntity === "Process"
                ? "Department"
                : undefined
          }
          deleteEligibility={
            crudMode === "delete" ? deleteEligibility : undefined
          }
          onCleanupChildren={
            crudMode === "delete" && crudEntity === "Process"
              ? handleOpenDeleteCleanup
              : undefined
          }
          onConfirm={handleCrudConfirm}
        />
      )}

      {/* ⌘K command palette — jump to any function/department/process */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        functions={functions ?? []}
        departments={allDepartments ?? []}
        processes={allProcesses ?? []}
        onJumpFunction={handleSelectFunction}
        onJumpDepartment={jumpToDepartment}
        onJumpProcess={jumpToProcess}
      />
    </div>
    </TooltipProvider>
  );
}

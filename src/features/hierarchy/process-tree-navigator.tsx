"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  AlertCircle,
  Building2,
  ChevronRight,
  CircleDot,
  Cog,
  GitBranch,
  House,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusIcon } from "@/features/status/status-badge";
import {
  overviewRowStatus,
  processRowStatus,
  STATUS_TONE_TEXT,
  type StatusMeta,
} from "@/features/status/status-meta";
import { cn } from "@/lib/utils";

export type ProcessTreeData = FunctionReturnType<typeof api.hierarchy.getTree>;
export type ProcessTreeFunction = ProcessTreeData["functions"][number];
export type ProcessTreeDepartment =
  ProcessTreeFunction["departments"][number];
export type ProcessTreeProcess = ProcessTreeDepartment["processes"][number];

/** A node to show without selecting it: its branch expands, it scrolls into
 * view and is highlighted for a moment. `key` changes on every request, so
 * revealing the same node twice works. */
export type TreeReveal = {
  nodeId: string;
  functionId: Id<"functions">;
  departmentId?: Id<"departments">;
  key: number;
};

/** How long a revealed row stays highlighted. */
const REVEAL_HIGHLIGHT_MS = 2400;

function collectNodeIds(tree: ProcessTreeData) {
  const ids = new Set<string>();
  for (const fn of tree.functions) {
    ids.add(fn._id);
    for (const department of fn.departments) {
      ids.add(department._id);
      for (const process of department.processes) ids.add(process._id);
    }
  }
  return ids;
}

type ProcessTreeNavigatorProps = {
  tree: ProcessTreeData | undefined;
  /** Getting started shows what it builds here, leaving the selection (and
   * so Home) alone. */
  reveal?: TreeReveal | null;
  canEdit: boolean;
  selectedFunctionId: Id<"functions"> | null;
  selectedDepartmentId: Id<"departments"> | null;
  selectedProcessId: Id<"processes"> | null;
  onSelectHome: () => void;
  onSelectFunction: (fn: ProcessTreeFunction) => void;
  onSelectDepartment: (
    fn: ProcessTreeFunction,
    department: ProcessTreeDepartment,
  ) => void;
  onSelectProcess: (
    fn: ProcessTreeFunction,
    department: ProcessTreeDepartment,
    process: ProcessTreeProcess,
  ) => void;
  onCreateFunction: () => void;
  onCreateDepartment: (fn: ProcessTreeFunction) => void;
  onCreateProcess: (
    fn: ProcessTreeFunction,
    department: ProcessTreeDepartment,
  ) => void;
  onEditFunction: (fn: ProcessTreeFunction) => void;
  onDeleteFunction: (fn: ProcessTreeFunction) => void;
  onEditDepartment: (
    fn: ProcessTreeFunction,
    department: ProcessTreeDepartment,
  ) => void;
  onDeleteDepartment: (
    fn: ProcessTreeFunction,
    department: ProcessTreeDepartment,
  ) => void;
  onEditProcess: (
    fn: ProcessTreeFunction,
    department: ProcessTreeDepartment,
    process: ProcessTreeProcess,
  ) => void;
  onDeleteProcess: (
    fn: ProcessTreeFunction,
    department: ProcessTreeDepartment,
    process: ProcessTreeProcess,
  ) => void;
};

type ActionItem = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onSelect: () => void;
  destructive?: boolean;
};

// A hue per function, so its branch is easy to follow. In light mode every
// level uses -700, the lightest shade that holds 3:1 for every hue on white
// and on a selected row; the icon shape tells the levels apart. Dark mode has
// room to step the shade by level.
const FUNCTION_ICON_TONES = [
  {
    function: "text-rose-700 dark:text-rose-300",
    department: "text-rose-700 dark:text-rose-400",
    process: "text-rose-700 dark:text-rose-500",
  },
  {
    function: "text-orange-700 dark:text-orange-300",
    department: "text-orange-700 dark:text-orange-400",
    process: "text-orange-700 dark:text-orange-500",
  },
  {
    function: "text-amber-700 dark:text-amber-300",
    department: "text-amber-700 dark:text-amber-400",
    process: "text-amber-700 dark:text-amber-500",
  },
  {
    function: "text-lime-700 dark:text-lime-300",
    department: "text-lime-700 dark:text-lime-400",
    process: "text-lime-700 dark:text-lime-500",
  },
  {
    function: "text-emerald-700 dark:text-emerald-300",
    department: "text-emerald-700 dark:text-emerald-400",
    process: "text-emerald-700 dark:text-emerald-500",
  },
  {
    function: "text-cyan-700 dark:text-cyan-300",
    department: "text-cyan-700 dark:text-cyan-400",
    process: "text-cyan-700 dark:text-cyan-500",
  },
  {
    function: "text-sky-700 dark:text-sky-300",
    department: "text-sky-700 dark:text-sky-400",
    process: "text-sky-700 dark:text-sky-500",
  },
  {
    function: "text-indigo-700 dark:text-indigo-300",
    department: "text-indigo-700 dark:text-indigo-400",
    process: "text-indigo-700 dark:text-indigo-500",
  },
  {
    function: "text-violet-700 dark:text-violet-300",
    department: "text-violet-700 dark:text-violet-400",
    process: "text-violet-700 dark:text-violet-500",
  },
  {
    function: "text-fuchsia-700 dark:text-fuchsia-300",
    department: "text-fuchsia-700 dark:text-fuchsia-400",
    process: "text-fuchsia-700 dark:text-fuchsia-500",
  },
] as const;

function cloneWithToggledId<T extends string>(ids: Set<T>, id: T) {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function getFunctionIconTone(id: Id<"functions">) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return FUNCTION_ICON_TONES[hash % FUNCTION_ICON_TONES.length];
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getCreateContext(
  tree: ProcessTreeData | undefined,
  selectedFunctionId: Id<"functions"> | null,
  selectedDepartmentId: Id<"departments"> | null,
  selectedProcessId: Id<"processes"> | null,
): {
  functionNode: ProcessTreeFunction | null;
  departmentNode: ProcessTreeDepartment | null;
} {
  if (!tree) {
    return { functionNode: null, departmentNode: null };
  }

  let functionNode =
    tree.functions.find((fn) => fn._id === selectedFunctionId) ?? null;
  let departmentNode: ProcessTreeDepartment | null = null;

  if (selectedDepartmentId || selectedProcessId) {
    for (const fn of tree.functions) {
      const matchingDepartment =
        fn.departments.find(
          (department) =>
            department._id === selectedDepartmentId ||
            department.processes.some(
              (process) => process._id === selectedProcessId,
            ),
        ) ?? null;

      if (matchingDepartment) {
        functionNode = fn;
        departmentNode = matchingDepartment;
        break;
      }
    }
  }

  return { functionNode, departmentNode };
}

function getSelectedAncestorIds(
  tree: ProcessTreeData | undefined,
  selectedFunctionId: Id<"functions"> | null,
  selectedDepartmentId: Id<"departments"> | null,
  selectedProcessId: Id<"processes"> | null,
): {
  functionId: Id<"functions"> | null;
  departmentId: Id<"departments"> | null;
} {
  if (!tree) {
    return {
      functionId: selectedFunctionId,
      departmentId: selectedDepartmentId,
    };
  }

  if (selectedProcessId) {
    for (const fn of tree.functions) {
      for (const department of fn.departments) {
        if (
          department.processes.some(
            (process) => process._id === selectedProcessId,
          )
        ) {
          return { functionId: fn._id, departmentId: department._id };
        }
      }
    }
  }

  if (selectedDepartmentId) {
    for (const fn of tree.functions) {
      if (
        fn.departments.some(
          (department) => department._id === selectedDepartmentId,
        )
      ) {
        return { functionId: fn._id, departmentId: selectedDepartmentId };
      }
    }
  }

  return {
    functionId: selectedFunctionId,
    departmentId: selectedDepartmentId,
  };
}

function TreeSkeleton() {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: 9 }).map((_, index) => (
        <div key={index} className="flex h-9 items-center gap-2 px-2">
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton
            className={cn(
              "h-4 flex-1",
              index % 3 === 0 && "max-w-[74%]",
              index % 3 === 1 && "max-w-[58%]",
              index % 3 === 2 && "max-w-[46%]",
            )}
          />
          <Skeleton className="h-5 w-7 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function CountBadge({
  count,
  label,
}: {
  count: number;
  label: string;
}) {
  return (
    <span
      className="flex h-5 min-w-7 shrink-0 items-center justify-center rounded-md border bg-background px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground"
      title={label}
      aria-label={label}
    >
      {count}
    </span>
  );
}

function RowActions({
  label,
  items,
}: {
  label: string;
  items: ActionItem[];
}) {
  if (items.length === 0) {
    return <span className="size-7 shrink-0" aria-hidden />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="opacity-0 group-hover/tree-row:opacity-100 group-focus-within/tree-row:opacity-100"
            aria-label={`Actions for ${label}`}
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-52 max-w-72">
        {items.map((item, index) => {
          const Icon = item.icon;
          const previous = items[index - 1];
          const needsSeparator = item.destructive && previous && !previous.destructive;
          return (
            <Fragment key={item.label}>
              {needsSeparator && <DropdownMenuSeparator />}
              <DropdownMenuItem
                variant={item.destructive ? "destructive" : "default"}
                onClick={item.onSelect}
              >
                <Icon className="size-4" />
                {item.label}
              </DropdownMenuItem>
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TreeRow({
  nodeId,
  isNew,
  highlighted,
  label,
  icon: Icon,
  iconClassName,
  level,
  selected,
  count,
  countTitle,
  status,
  expandable,
  expanded,
  actions,
  onSelect,
  onToggle,
}: {
  nodeId: string;
  /** Created since the tree first loaded: animates in (unless reduced motion
   * is on, which the caller has already folded in). */
  isNew: boolean;
  highlighted: boolean;
  label: string;
  icon: ComponentType<{ className?: string }>;
  iconClassName?: string;
  level: 1 | 2 | 3;
  selected: boolean;
  count: number;
  countTitle: string;
  /** Something on this row waiting on a person or still running. */
  status?: StatusMeta | null;
  expandable?: boolean;
  expanded?: boolean;
  actions: ActionItem[];
  onSelect: () => void;
  onToggle?: () => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!expandable || !onToggle) return;

    if (event.key === "ArrowRight" && !expanded) {
      event.preventDefault();
      onToggle();
    } else if (event.key === "ArrowLeft" && expanded) {
      event.preventDefault();
      onToggle();
    }
  };

  return (
    <motion.div
      role="none"
      data-tree-id={nodeId}
      initial={isNew ? { opacity: 0, y: -4 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "group/tree-row mx-1 flex h-9 min-w-0 items-center gap-1 rounded-md px-1 transition-colors duration-500 motion-reduce:transition-none",
        level === 2 && "pl-5",
        level === 3 && "pl-9",
        highlighted && "bg-org-accent-subtle",
      )}
    >
      {expandable ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-6"
          onClick={onToggle}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
        >
          <ChevronRight
            className={cn(
              "size-3.5 text-muted-foreground transition-transform duration-150",
              expanded && "rotate-90",
            )}
          />
        </Button>
      ) : (
        <span className="flex size-6 shrink-0 items-center justify-center" aria-hidden>
          <CircleDot className="size-2 text-muted-foreground/35" />
        </span>
      )}
      <button
        type="button"
        role="treeitem"
        data-tour="tree-node"
        data-tour-node={nodeId}
        aria-level={level}
        aria-selected={selected}
        aria-expanded={expandable ? expanded : undefined}
        onClick={onSelect}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-transparent px-2 text-left text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-org-accent-ring/35",
          selected
            ? "border-org-accent-border bg-org-accent-selected text-org-accent-selected-foreground shadow-xs"
            : "text-foreground hover:bg-org-accent-subtle",
        )}
      >
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            iconClassName ?? "text-muted-foreground",
          )}
        />
        <span className="min-w-0 flex-1 truncate" title={label}>
          {label}
        </span>
        {/* An icon, not a labelled badge: the tree is narrow, and a label here
            would cut the name short. */}
        {status && <StatusIcon meta={status} />}
        {count > 0 && <CountBadge count={count} label={countTitle} />}
      </button>
      <RowActions label={label} items={actions} />
    </motion.div>
  );
}

export function ProcessTreeNavigator({
  tree,
  reveal = null,
  canEdit,
  selectedFunctionId,
  selectedDepartmentId,
  selectedProcessId,
  onSelectHome,
  onSelectFunction,
  onSelectDepartment,
  onSelectProcess,
  onCreateFunction,
  onCreateDepartment,
  onCreateProcess,
  onEditFunction,
  onDeleteFunction,
  onEditDepartment,
  onDeleteDepartment,
  onEditProcess,
  onDeleteProcess,
}: ProcessTreeNavigatorProps) {
  const selectedAncestorIds = getSelectedAncestorIds(
    tree,
    selectedFunctionId,
    selectedDepartmentId,
    selectedProcessId,
  );
  const selectedAncestorKey = [
    selectedAncestorIds.functionId ?? "",
    selectedAncestorIds.departmentId ?? "",
    selectedProcessId ?? "",
  ].join(":");
  const [expandedFunctionIds, setExpandedFunctionIds] = useState(
    () =>
      selectedAncestorIds.functionId
        ? new Set<Id<"functions">>([selectedAncestorIds.functionId])
        : new Set<Id<"functions">>(),
  );
  const [expandedDepartmentIds, setExpandedDepartmentIds] = useState(
    () =>
      selectedAncestorIds.departmentId
        ? new Set<Id<"departments">>([selectedAncestorIds.departmentId])
        : new Set<Id<"departments">>(),
  );

  // Auto-expand ancestors when the selected path changes (e.g. from another
  // column, command palette, or a deep link). Because this is keyed by the path,
  // the chevron can still collapse the selected node afterward.
  const [prevSelectedAncestorKey, setPrevSelectedAncestorKey] =
    useState(selectedAncestorKey);
  if (selectedAncestorKey !== prevSelectedAncestorKey) {
    setPrevSelectedAncestorKey(selectedAncestorKey);
    const functionId = selectedAncestorIds.functionId;
    const departmentId = selectedAncestorIds.departmentId;

    if (functionId) {
      setExpandedFunctionIds((ids) =>
        ids.has(functionId)
          ? ids
          : new Set(ids).add(functionId),
      );
    }
    if (departmentId) {
      setExpandedDepartmentIds((ids) =>
        ids.has(departmentId)
          ? ids
          : new Set(ids).add(departmentId),
      );
    }
  }

  // Rows that exist when the tree first loads stay still; anything created
  // after that animates in.
  const reduceMotion = useReducedMotion();
  const [initialNodeIds, setInitialNodeIds] = useState<Set<string> | null>(
    () => (tree ? collectNodeIds(tree) : null),
  );
  if (tree && initialNodeIds === null) setInitialNodeIds(collectNodeIds(tree));
  const isNewNode = (id: string) =>
    !reduceMotion && initialNodeIds !== null && !initialNodeIds.has(id);

  // A reveal expands the branch and highlights the row, without selecting.
  const [prevRevealKey, setPrevRevealKey] = useState(reveal?.key ?? null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  if (reveal && reveal.key !== prevRevealKey) {
    setPrevRevealKey(reveal.key);
    setHighlightedId(reveal.nodeId);
    if (reveal.departmentId || reveal.nodeId !== reveal.functionId) {
      const functionId = reveal.functionId;
      setExpandedFunctionIds((ids) =>
        ids.has(functionId) ? ids : new Set(ids).add(functionId),
      );
    }
    if (reveal.departmentId && reveal.nodeId !== reveal.departmentId) {
      const departmentId = reveal.departmentId;
      setExpandedDepartmentIds((ids) =>
        ids.has(departmentId) ? ids : new Set(ids).add(departmentId),
      );
    }
  }

  const treeScrollRef = useRef<HTMLDivElement>(null);
  // Scroll the highlighted row into view once it's rendered (an action can
  // resolve before the tree query has the new row), then let it fade.
  useEffect(() => {
    if (!highlightedId) return;
    const row = treeScrollRef.current?.querySelector(
      `[data-tree-id="${CSS.escape(highlightedId)}"]`,
    );
    row?.scrollIntoView({
      block: "nearest",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [highlightedId, tree, reduceMotion]);
  useEffect(() => {
    if (!highlightedId) return;
    const timer = window.setTimeout(
      () => setHighlightedId(null),
      REVEAL_HIGHLIGHT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [highlightedId]);

  const homeSelected = !selectedFunctionId;

  const toggleFunction = (id: Id<"functions">) => {
    setExpandedFunctionIds((ids) => cloneWithToggledId(ids, id));
  };

  const toggleDepartment = (id: Id<"departments">) => {
    setExpandedDepartmentIds((ids) => cloneWithToggledId(ids, id));
  };

  const {
    functionNode: selectedFunctionForCreate,
    departmentNode: selectedDepartmentForCreate,
  } = getCreateContext(
    tree,
    selectedFunctionId,
    selectedDepartmentId,
    selectedProcessId,
  );

  return (
    <aside
      aria-label="Process tree"
      data-tour="tree"
      className="flex h-full w-[320px] shrink-0 flex-col border-r bg-muted/10 xl:w-[360px]"
    >
      <div className="shrink-0 border-b bg-background px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <GitBranch className="size-4 shrink-0 text-muted-foreground" />
            <h2 className="truncate text-sm font-semibold">Process Tree</h2>
          </div>
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    aria-label="Add hierarchy item"
                  />
                }
              >
                <span>Add</span>
                <Plus className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-44">
                <DropdownMenuItem onClick={onCreateFunction}>
                  <Building2 className="size-4" />
                  Function
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!selectedFunctionForCreate}
                  onClick={() => {
                    if (selectedFunctionForCreate) {
                      onCreateDepartment(selectedFunctionForCreate);
                    }
                  }}
                >
                  <Layers className="size-4" />
                  Department
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!selectedFunctionForCreate || !selectedDepartmentForCreate}
                  onClick={() => {
                    if (selectedFunctionForCreate && selectedDepartmentForCreate) {
                      onCreateProcess(
                        selectedFunctionForCreate,
                        selectedDepartmentForCreate,
                      );
                    }
                  }}
                >
                  <Cog className="size-4" />
                  Process
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div
        ref={treeScrollRef}
        className="min-h-0 flex-1 overflow-y-auto py-2 scrollbar-hide"
      >
        {/* The workspace home, above the hierarchy rather than in it: it
            isn't a function. With no functions yet, Home is all there is. */}
        {tree && tree.functions.length > 0 && (
          <div className="px-2 pb-0.5">
            <button
              type="button"
              onClick={onSelectHome}
              aria-current={homeSelected ? "page" : undefined}
              className={cn(
                "flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-transparent px-2 text-left text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-org-accent-ring/35",
                homeSelected
                  ? "border-org-accent-border bg-org-accent-selected text-org-accent-selected-foreground shadow-xs"
                  : "text-foreground hover:bg-org-accent-subtle",
              )}
            >
              <House className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">Home</span>
            </button>
          </div>
        )}
        {tree === undefined ? (
          <TreeSkeleton />
        ) : tree.functions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Building2 className="size-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">No functions yet</p>
              <p className="text-xs leading-5 text-muted-foreground">
                Functions will appear here as the workspace hierarchy is built.
              </p>
            </div>
            {canEdit && (
              <Button size="sm" className="gap-1.5" onClick={onCreateFunction}>
                <Plus className="size-3.5" />
                Add function
              </Button>
            )}
          </div>
        ) : (
          <div role="tree" aria-label="Process hierarchy" className="space-y-0.5">
            {tree.functions.map((fn) => {
              const functionExpanded = expandedFunctionIds.has(fn._id);
              const iconTone = getFunctionIconTone(fn._id);

              return (
                <div key={fn._id} role="none">
                  <TreeRow
                    nodeId={fn._id}
                    isNew={isNewNode(fn._id)}
                    highlighted={highlightedId === fn._id}
                    label={fn.name}
                    icon={Building2}
                    iconClassName={iconTone.function}
                    level={1}
                    selected={selectedFunctionId === fn._id && !selectedDepartmentId}
                    count={fn.departmentCount}
                    countTitle={countLabel(fn.departmentCount, "department")}
                    status={overviewRowStatus(fn.summaryOverview.state)}
                    expandable={fn.departmentCount > 0}
                    expanded={functionExpanded}
                    onToggle={() => toggleFunction(fn._id)}
                    onSelect={() => {
                      setExpandedFunctionIds((ids) => new Set(ids).add(fn._id));
                      onSelectFunction(fn);
                    }}
                    actions={
                      canEdit
                        ? [
                            {
                              label: `Add department to ${fn.name}`,
                              icon: Plus,
                              onSelect: () => onCreateDepartment(fn),
                            },
                            {
                              label: `Edit "${fn.name}"`,
                              icon: Pencil,
                              onSelect: () => onEditFunction(fn),
                            },
                            {
                              label: `Delete "${fn.name}"`,
                              icon: Trash2,
                              destructive: true,
                              onSelect: () => onDeleteFunction(fn),
                            },
                          ]
                        : []
                    }
                  />

                  {functionExpanded && fn.departments.length > 0 && (
                    <div role="group" className="space-y-0.5">
                      {fn.departments.map((department) => {
                        const departmentExpanded = expandedDepartmentIds.has(
                          department._id,
                        );

                        return (
                          <div key={department._id} role="none">
                            <TreeRow
                              nodeId={department._id}
                              isNew={isNewNode(department._id)}
                              highlighted={highlightedId === department._id}
                              label={department.name}
                              icon={Layers}
                              iconClassName={iconTone.department}
                              level={2}
                              selected={
                                selectedDepartmentId === department._id &&
                                !selectedProcessId
                              }
                              count={department.processCount}
                              countTitle={countLabel(
                                department.processCount,
                                "process",
                                "processes",
                              )}
                              status={overviewRowStatus(
                                department.summaryOverview.state,
                              )}
                              expandable={department.processCount > 0}
                              expanded={departmentExpanded}
                              onToggle={() => toggleDepartment(department._id)}
                              onSelect={() => {
                                setExpandedFunctionIds((ids) =>
                                  new Set(ids).add(fn._id),
                                );
                                setExpandedDepartmentIds((ids) =>
                                  new Set(ids).add(department._id),
                                );
                                onSelectDepartment(fn, department);
                              }}
                              actions={
                                canEdit
                                  ? [
                                      {
                                        label: `Add process to ${department.name}`,
                                        icon: Plus,
                                        onSelect: () =>
                                          onCreateProcess(fn, department),
                                      },
                                      {
                                        label: `Edit "${department.name}"`,
                                        icon: Pencil,
                                        onSelect: () =>
                                          onEditDepartment(fn, department),
                                      },
                                      {
                                        label: `Delete "${department.name}"`,
                                        icon: Trash2,
                                        destructive: true,
                                        onSelect: () =>
                                          onDeleteDepartment(fn, department),
                                      },
                                    ]
                                  : []
                              }
                            />

                            {departmentExpanded &&
                              department.processes.length > 0 && (
                                <div role="group" className="space-y-0.5">
                                  {department.processes.map((process) => {
                                    return (
                                      <TreeRow
                                        key={process._id}
                                        nodeId={process._id}
                                        isNew={isNewNode(process._id)}
                                        highlighted={highlightedId === process._id}
                                        label={process.name}
                                        icon={Cog}
                                        iconClassName={iconTone.process}
                                        level={3}
                                        selected={selectedProcessId === process._id}
                                        count={process.conversationCount}
                                        countTitle={countLabel(
                                          process.conversationCount,
                                          "conversation",
                                        )}
                                        status={processRowStatus(
                                          process.pendingWorkStatus,
                                        )}
                                        onSelect={() => {
                                          setExpandedFunctionIds((ids) =>
                                            new Set(ids).add(fn._id),
                                          );
                                          setExpandedDepartmentIds((ids) =>
                                            new Set(ids).add(department._id),
                                          );
                                          onSelectProcess(fn, department, process);
                                        }}
                                        actions={
                                          canEdit
                                            ? [
                                                {
                                                  label: `Edit "${process.name}"`,
                                                  icon: Pencil,
                                                  onSelect: () =>
                                                    onEditProcess(
                                                      fn,
                                                      department,
                                                      process,
                                                    ),
                                                },
                                                {
                                                  label: `Delete "${process.name}"`,
                                                  icon: Trash2,
                                                  destructive: true,
                                                  onSelect: () =>
                                                    onDeleteProcess(
                                                      fn,
                                                      department,
                                                      process,
                                                    ),
                                                },
                                              ]
                                            : []
                                        }
                                      />
                                    );
                                  })}
                                </div>
                              )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {tree && Object.values(tree.truncated).some(Boolean) && (
        <div className="flex shrink-0 items-start gap-2 border-t bg-background px-4 py-3 text-xs text-muted-foreground">
          <AlertCircle
            className={cn("mt-0.5 size-3.5 shrink-0", STATUS_TONE_TEXT.warning)}
          />
          <span>Some hierarchy rows are hidden by the current read limits.</span>
        </div>
      )}
    </aside>
  );
}

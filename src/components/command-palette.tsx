"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Building2, Layers, Cog, Search } from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";

type FunctionItem = { _id: Id<"functions">; name: string };
type DepartmentItem = {
  _id: Id<"departments">;
  name: string;
  functionId: Id<"functions">;
  functionName: string;
};
type ProcessItem = {
  _id: Id<"processes">;
  name: string;
  departmentId: Id<"departments">;
  departmentName: string;
  functionId: Id<"functions"> | null;
  functionName: string;
};

type Result =
  | {
      kind: "function";
      key: string;
      label: string;
      context: null;
      select: () => void;
    }
  | {
      kind: "department";
      key: string;
      label: string;
      context: string;
      select: () => void;
    }
  | {
      kind: "process";
      key: string;
      label: string;
      context: string;
      select: () => void;
    };

const GROUP_META = {
  function: { label: "Functions", icon: Building2 },
  department: { label: "Departments", icon: Layers },
  process: { label: "Processes", icon: Cog },
} as const;

// Per-group result cap so the list stays scannable on broad queries.
const GROUP_LIMIT = 8;

// startsWith matches rank above plain substring matches.
function rankAndLimit<T extends { name: string }>(
  items: T[],
  query: string,
): T[] {
  if (!query) return items;
  const matches = items.filter((i) => i.name.toLowerCase().includes(query));
  matches.sort((a, b) => {
    const aStarts = a.name.toLowerCase().startsWith(query) ? 0 : 1;
    const bStarts = b.name.toLowerCase().startsWith(query) ? 0 : 1;
    return aStarts - bStarts || a.name.localeCompare(b.name);
  });
  return matches.slice(0, GROUP_LIMIT);
}

export function CommandPalette({
  open,
  onOpenChange,
  functions,
  departments,
  processes,
  onJumpFunction,
  onJumpDepartment,
  onJumpProcess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  functions: FunctionItem[];
  departments: DepartmentItem[];
  processes: ProcessItem[];
  onJumpFunction: (functionId: Id<"functions">, functionName: string) => void;
  onJumpDepartment: (
    functionId: Id<"functions">,
    functionName: string,
    departmentId: Id<"departments">,
    departmentName: string,
  ) => void;
  onJumpProcess: (
    functionId: Id<"functions">,
    functionName: string,
    departmentId: Id<"departments">,
    departmentName: string,
    processId: Id<"processes">,
    processName: string,
  ) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rowRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Reset on close (in the event handler, not an effect) so the palette always
  // reopens fresh. All close paths — Esc/backdrop and row selection — route here.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setQuery("");
        setActiveIndex(0);
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const close = () => handleOpenChange(false);

    // Empty query: surface top-level functions as a quick-nav starting point
    // (rankAndLimit returns the list unfiltered when the query is empty).
    const fnResults: Result[] = rankAndLimit(functions, q).map((fn) => ({
      kind: "function",
      key: fn._id,
      label: fn.name,
      context: null,
      select: () => {
        onJumpFunction(fn._id, fn.name);
        close();
      },
    }));

    // Only search children once the user types, so the empty state stays calm.
    const deptResults: Result[] = q
      ? rankAndLimit(departments, q).map((dept) => ({
          kind: "department",
          key: dept._id,
          label: dept.name,
          context: dept.functionName,
          select: () => {
            onJumpDepartment(
              dept.functionId,
              dept.functionName,
              dept._id,
              dept.name,
            );
            close();
          },
        }))
      : [];

    const procResults: Result[] = q
      ? rankAndLimit(
          processes.filter(
            (p): p is ProcessItem & { functionId: Id<"functions"> } =>
              p.functionId !== null,
          ),
          q,
        ).map((proc) => ({
          kind: "process",
          key: proc._id,
          label: proc.name,
          context: `${proc.functionName} › ${proc.departmentName}`,
          select: () => {
            onJumpProcess(
              proc.functionId as Id<"functions">,
              proc.functionName,
              proc.departmentId,
              proc.departmentName,
              proc._id,
              proc.name,
            );
            close();
          },
        }))
      : [];

    return [...fnResults, ...deptResults, ...procResults];
  }, [
    query,
    functions,
    departments,
    processes,
    onJumpFunction,
    onJumpDepartment,
    onJumpProcess,
    handleOpenChange,
  ]);

  // Clamp the highlighted row during render (no effect needed): the index is
  // reset to 0 on every keystroke, this just guards reactive list shrinkage.
  const activeRow = results.length ? Math.min(activeIndex, results.length - 1) : -1;

  // Scroll the active row into view as the user arrows through.
  useEffect(() => {
    if (activeRow >= 0) {
      rowRefs.current.get(activeRow)?.scrollIntoView({ block: "nearest" });
    }
  }, [activeRow]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((activeRow + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((activeRow - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      results[activeRow]?.select();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Search the organization</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search functions, departments, processes…"
            className="h-11 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-1">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {query.trim()
                ? `No matches for “${query.trim()}”.`
                : "Start typing to search functions, departments, and processes."}
            </p>
          ) : (
            results.map((result, index) => {
              const prev = results[index - 1];
              const showHeader = !prev || prev.kind !== result.kind;
              const GroupIcon = GROUP_META[result.kind].icon;
              const isActive = index === activeRow;
              return (
                <Fragment key={result.key}>
                  {showHeader && (
                    <p className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      {GROUP_META[result.kind].label}
                    </p>
                  )}
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) rowRefs.current.set(index, el);
                      else rowRefs.current.delete(index);
                    }}
                    onClick={result.select}
                    onMouseMove={() => setActiveIndex(index)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm outline-none transition-colors",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground",
                    )}
                  >
                    <GroupIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {result.label}
                    </span>
                    {result.context && (
                      <span className="shrink-0 truncate text-xs text-muted-foreground">
                        {result.context}
                      </span>
                    )}
                  </button>
                </Fragment>
              );
            })
          )}
        </div>

        <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
          <kbd className="font-sans">↑↓</kbd> navigate ·{" "}
          <kbd className="font-sans">↵</kbd> open ·{" "}
          <kbd className="font-sans">esc</kbd> close
        </div>
      </DialogContent>
    </Dialog>
  );
}

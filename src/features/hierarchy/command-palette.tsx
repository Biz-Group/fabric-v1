"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";
import { Building2, Layers, Cog, Search } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  groupConsecutive,
  moveHighlight,
  resultCountMessage,
} from "./command-palette-a11y";
import { searchCandidates, truncationMessage } from "./command-palette-search";

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

// How long the result count waits for typing to settle before it is announced.
const COUNT_ANNOUNCE_DELAY_MS = 500;

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
  // What the polite live region says. Trails the results by a short delay so a
  // screen reader hears the settled count, not one announcement per keystroke.
  const [announcement, setAnnouncement] = useState("");
  const rowRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (key: string) => `${baseId}-option-${key}`;
  const groupLabelId = (kind: Result["kind"]) => `${baseId}-group-${kind}`;

  // Reset on close (in the event handler, not an effect) so the palette always
  // reopens fresh. All close paths — Esc/backdrop and row selection — route here.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setQuery("");
        setActiveIndex(0);
        // Cleared so reopening announces the count again: a live region only
        // speaks when its text changes.
        setAnnouncement("");
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const { results, totals } = useMemo(() => {
    const q = query.trim();
    const close = () => handleOpenChange(false);

    // Empty query: surface top-level functions as a quick-nav starting point
    // (searchCandidates returns the list uncapped when the query is empty).
    const fnSearch = searchCandidates(
      functions,
      q,
      (fn) => ({ name: fn.name, path: [] }),
      GROUP_LIMIT,
    );
    const fnResults: Result[] = fnSearch.matches.map((fn) => ({
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
    // Their ancestor names are searchable too, so "finance invoice" finds an
    // invoice process under Finance.
    const deptSearch = q
      ? searchCandidates(
          departments,
          q,
          (dept) => ({ name: dept.name, path: [dept.functionName] }),
          GROUP_LIMIT,
        )
      : { matches: [], total: 0 };
    const deptResults: Result[] = deptSearch.matches.map((dept) => ({
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
    }));

    // A null functionId means the process's department no longer exists, so
    // there is nowhere in the hierarchy to jump to.
    const procSearch = q
      ? searchCandidates(
          processes.filter(
            (p): p is ProcessItem & { functionId: Id<"functions"> } =>
              p.functionId !== null,
          ),
          q,
          (proc) => ({
            name: proc.name,
            path: [proc.functionName, proc.departmentName],
          }),
          GROUP_LIMIT,
        )
      : { matches: [], total: 0 };
    const procResults: Result[] = procSearch.matches.map((proc) => ({
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
    }));

    return {
      results: [...fnResults, ...deptResults, ...procResults],
      // Functions are uncapped while the query is empty, so only a typed
      // query can truncate them.
      totals: {
        function: fnSearch.total,
        department: deptSearch.total,
        process: procSearch.total,
      } satisfies Record<Result["kind"], number>,
    };
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

  const activeResult = activeRow >= 0 ? results[activeRow] : undefined;
  const groups = useMemo(() => groupConsecutive(results), [results]);
  const expanded = results.length > 0;

  // Scroll the active row into view as the user arrows through.
  useEffect(() => {
    if (activeRow >= 0) {
      rowRefs.current.get(activeRow)?.scrollIntoView({ block: "nearest" });
    }
  }, [activeRow]);

  // Debounced count for the live region. Setting the same text again is a
  // no-op, so an unchanged count is not re-announced. While closed it settles
  // to "", which also covers a parent closing the palette without going
  // through handleOpenChange.
  const anyTruncated = groups.some(
    (group) => totals[group.kind] > group.entries.length,
  );
  const countMessage = open
    ? resultCountMessage(results.length) +
      (anyTruncated ? ". More match; refine your search" : "")
    : "";
  useEffect(() => {
    const timer = setTimeout(
      () => setAnnouncement(countMessage),
      COUNT_ANNOUNCE_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [countMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(moveHighlight(activeRow, 1, results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(moveHighlight(activeRow, -1, results.length));
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
        <DialogTitle className="sr-only">Search the workspace</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <Search
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
          {/* ARIA 1.2 combobox: focus never leaves the input; the highlighted
              option is exposed through aria-activedescendant instead. */}
          <Input
            autoFocus
            role="combobox"
            aria-label="Search functions, departments and processes"
            aria-expanded={expanded}
            aria-controls={expanded ? listboxId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              activeResult ? optionId(activeResult.key) : undefined
            }
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search functions, departments, processes…"
            className="h-11 border-0 bg-transparent px-0 shadow-none focus-visible:outline-none"
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
            <div id={listboxId} role="listbox" aria-label="Search results">
              {groups.map((group) => {
                const GroupIcon = GROUP_META[group.kind].icon;
                const labelId = groupLabelId(group.kind);
                const truncation = truncationMessage(
                  group.entries.length,
                  totals[group.kind],
                );
                // The heading sits beside the group, not inside it, so the
                // listbox owns only groups and options. It names the group
                // through aria-labelledby and is hidden from the reading order.
                return (
                  <div key={group.kind} role="presentation">
                    <SectionLabel
                      id={labelId}
                      aria-hidden="true"
                      size="sm"
                      className="px-2 pt-2 pb-1"
                    >
                      {GROUP_META[group.kind].label}
                    </SectionLabel>
                    <div role="group" aria-labelledby={labelId}>
                      {group.entries.map(({ item: result, index }) => {
                        const isActive = index === activeRow;
                        return (
                          <button
                            key={result.key}
                            id={optionId(result.key)}
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            // Not a tab stop: the arrows move the highlight
                            // from the input. Mouse and touch still click it.
                            tabIndex={-1}
                            ref={(el) => {
                              if (el) rowRefs.current.set(index, el);
                              else rowRefs.current.delete(index);
                            }}
                            // Keeps focus (and the caret) in the input.
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={result.select}
                            onMouseMove={() => setActiveIndex(index)}
                            className={cn(
                              "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm outline-none transition-colors pointer-coarse:min-h-10",
                              isActive
                                ? "border border-org-accent-border bg-org-accent-selected text-org-accent-selected-foreground"
                                : "text-foreground",
                            )}
                          >
                            <GroupIcon
                              aria-hidden="true"
                              className={cn(
                                "size-4 shrink-0",
                                isActive
                                  ? "text-org-accent"
                                  : "text-muted-foreground",
                              )}
                            />
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {result.label}
                            </span>
                            {/* Capped below half the row, so on a phone a long
                                path truncates before it can squeeze the name
                                away. */}
                            {result.context && (
                              <span className="min-w-0 max-w-[45%] truncate text-xs text-muted-foreground">
                                {result.context}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {/* Hidden like the heading: the live region already says
                        that more results match. */}
                    {truncation && (
                      <p
                        aria-hidden="true"
                        className="px-2 pt-1 pb-2 text-xs text-muted-foreground"
                      >
                        {truncation}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>

        <div className="border-t px-3 py-2 text-2xs text-muted-foreground">
          <kbd className="font-sans">↑↓</kbd> navigate ·{" "}
          <kbd className="font-sans">↵</kbd> open ·{" "}
          <kbd className="font-sans">esc</kbd> close
        </div>
      </DialogContent>
    </Dialog>
  );
}

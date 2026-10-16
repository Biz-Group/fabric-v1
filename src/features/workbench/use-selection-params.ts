import type { useSearchParams } from "next/navigation";
import type { Id } from "../../../convex/_generated/dataModel";

// --- URL selection params ---
// The committed selection is mirrored into the `/[org]` query string so the
// view is refresh-safe, shareable, and traversable with the Back button.

const PARAM = {
  fn: "fn",
  dept: "dept",
  proc: "proc",
  tab: "tab",
  node: "node",
} as const;

// One-shot link to a contribution: the workbench opens it in the
// Contributions tab on load, and the next URL write drops it, so it never
// outlives the visit it was for.
const CONVERSATION_PARAM = "conv";

export type SelectionParams = {
  fn: Id<"functions"> | null;
  dept: Id<"departments"> | null;
  proc: Id<"processes"> | null;
  tab: number;
  node: string | null;
};

// Tab index <-> URL token. Only the default Overview tab is omitted.
export function tabToParam(tab: number): string | null {
  if (tab === 1) return "conversations";
  if (tab === 2) return "flow";
  if (tab === 3) return "insights";
  if (tab === 4) return "automations";
  return null;
}
export function paramToTab(value: string | null): number {
  // `summary` was the original public token. Both it and the explicit
  // `overview` alias continue to land on the renamed default surface.
  if (value === null || value === "overview" || value === "summary") return 0;
  if (value === "conversations") return 1;
  if (value === "flow") return 2;
  if (value === "insights") return 3;
  if (value === "automations") return 4;
  return 0;
}

export function readSelectionParams(
  searchParams: URLSearchParams | ReturnType<typeof useSearchParams>,
): SelectionParams {
  const fn = searchParams.get(PARAM.fn);
  const dept = searchParams.get(PARAM.dept);
  const proc = searchParams.get(PARAM.proc);
  const tab = paramToTab(searchParams.get(PARAM.tab));
  return {
    fn: fn ? (fn as Id<"functions">) : null,
    dept: dept ? (dept as Id<"departments">) : null,
    proc: proc ? (proc as Id<"processes">) : null,
    tab,
    node: proc && tab === 2 ? searchParams.get(PARAM.node) : null,
  };
}

export function readConversationParam(
  searchParams: URLSearchParams | ReturnType<typeof useSearchParams>,
): Id<"conversations"> | null {
  const conversationId = searchParams.get(CONVERSATION_PARAM);
  return conversationId ? (conversationId as Id<"conversations">) : null;
}

/** Query string that opens a process on its Contributions tab with one
 * contribution selected, e.g. from Admin → Contributions. */
export function processConversationQuery(
  ids: {
    fn: Id<"functions">;
    dept: Id<"departments">;
    proc: Id<"processes">;
  },
  conversationId: Id<"conversations">,
): string {
  const params = new URLSearchParams(
    buildSelectionQuery(new URLSearchParams(), { ...ids, tab: 1, node: null }),
  );
  params.set(CONVERSATION_PARAM, conversationId);
  return params.toString();
}

/** Link from an admin row into the contribution's process, or null when its
 * process, department or function is gone. */
export function processConversationHref(
  appHref: string,
  row: {
    _id: Id<"conversations">;
    processId: Id<"processes">;
    departmentId: Id<"departments"> | null;
    functionId: Id<"functions"> | null;
  },
): string | null {
  if (!row.functionId || !row.departmentId) return null;
  const query = processConversationQuery(
    { fn: row.functionId, dept: row.departmentId, proc: row.processId },
    row._id,
  );
  return `${appHref}?${query}`;
}

// Build a query string from the committed selection, deleting descendant keys
// when a parent is absent so the URL can never describe an impossible path
// (e.g. a process with no function). Starts from the current params to stay
// forward-compatible with any unrelated keys.
export function buildSelectionQuery(
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
  setOrDelete(
    PARAM.node,
    sel.fn && sel.dept && sel.proc && sel.tab === 2 ? sel.node : null,
  );
  params.delete(CONVERSATION_PARAM);

  return params.toString();
}

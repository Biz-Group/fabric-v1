import { describe, expect, it } from "vitest";
import {
  findTypeaheadMatch,
  getTreeKeyAction,
  isTypeaheadKey,
  pickTabStop,
  type TreeNavRow,
} from "./tree-keyboard";

// Finance (expanded) > Payroll (expanded) > Run payroll, Close books
//                   > Audit (collapsed)
// Operations (collapsed)
// Legal (leaf)
const rows: TreeNavRow[] = [
  { id: "fin", parentId: null, label: "Finance", expandable: true, expanded: true },
  { id: "pay", parentId: "fin", label: "Payroll", expandable: true, expanded: true },
  { id: "run", parentId: "pay", label: "Run payroll", expandable: false, expanded: false },
  { id: "close", parentId: "pay", label: "Close books", expandable: false, expanded: false },
  { id: "audit", parentId: "fin", label: "Audit", expandable: true, expanded: false },
  { id: "ops", parentId: null, label: "Operations", expandable: true, expanded: false },
  { id: "legal", parentId: null, label: "Legal", expandable: false, expanded: false },
];

const press = (id: string, key: string, mods: Partial<Record<"shiftKey" | "ctrlKey" | "metaKey" | "altKey", boolean>> = {}) =>
  getTreeKeyAction(rows, id, { key, ...mods });

describe("getTreeKeyAction", () => {
  it("moves between visible rows with Up and Down", () => {
    expect(press("fin", "ArrowDown")).toEqual({ type: "focus", id: "pay" });
    expect(press("close", "ArrowDown")).toEqual({ type: "focus", id: "audit" });
    expect(press("audit", "ArrowUp")).toEqual({ type: "focus", id: "close" });
  });

  it("stays put at either end but still claims the key", () => {
    expect(press("fin", "ArrowUp")).toEqual({ type: "none" });
    expect(press("legal", "ArrowDown")).toEqual({ type: "none" });
  });

  it("jumps to the first and last rows with Home and End", () => {
    expect(press("audit", "Home")).toEqual({ type: "focus", id: "fin" });
    expect(press("audit", "End")).toEqual({ type: "focus", id: "legal" });
    expect(press("fin", "Home")).toEqual({ type: "none" });
  });

  it("Right expands a collapsed node, then enters its first child", () => {
    expect(press("ops", "ArrowRight")).toEqual({ type: "expand", id: "ops" });
    expect(press("fin", "ArrowRight")).toEqual({ type: "focus", id: "pay" });
    expect(press("pay", "ArrowRight")).toEqual({ type: "focus", id: "run" });
  });

  it("Right does nothing on a leaf", () => {
    expect(press("run", "ArrowRight")).toEqual({ type: "none" });
    expect(press("legal", "ArrowRight")).toEqual({ type: "none" });
  });

  it("Left collapses an expanded node, else moves to the parent", () => {
    expect(press("pay", "ArrowLeft")).toEqual({ type: "collapse", id: "pay" });
    expect(press("close", "ArrowLeft")).toEqual({ type: "focus", id: "pay" });
    expect(press("audit", "ArrowLeft")).toEqual({ type: "focus", id: "fin" });
    expect(press("ops", "ArrowLeft")).toEqual({ type: "none" });
  });

  it("opens the row actions with Shift+F10 or the ContextMenu key", () => {
    expect(press("pay", "F10", { shiftKey: true })).toEqual({ type: "openActions", id: "pay" });
    expect(press("pay", "ContextMenu")).toEqual({ type: "openActions", id: "pay" });
    expect(press("pay", "F10")).toBeNull();
  });

  it("leaves Enter, Space, Tab and modified arrows alone", () => {
    expect(press("pay", "Enter")).toBeNull();
    expect(press("pay", " ")).toBeNull();
    expect(press("pay", "Tab")).toBeNull();
    expect(press("pay", "ArrowDown", { ctrlKey: true })).toBeNull();
    expect(press("pay", "ArrowDown", { shiftKey: true })).toBeNull();
  });

  it("ignores rows that aren't visible", () => {
    expect(getTreeKeyAction(rows, "missing", { key: "ArrowDown" })).toBeNull();
  });
});

describe("type-ahead", () => {
  it("accepts single printable characters only", () => {
    expect(isTypeaheadKey({ key: "a" })).toBe(true);
    expect(isTypeaheadKey({ key: "A", shiftKey: true })).toBe(true);
    expect(isTypeaheadKey({ key: " " })).toBe(false);
    expect(isTypeaheadKey({ key: "a", ctrlKey: true })).toBe(false);
    expect(isTypeaheadKey({ key: "ArrowDown" })).toBe(false);
  });

  it("cycles through rows starting with a repeated character", () => {
    expect(findTypeaheadMatch(rows, "fin", "o")).toBe("ops");
    expect(findTypeaheadMatch(rows, "fin", "a")).toBe("audit");
    expect(findTypeaheadMatch(rows, "fin", "r")).toBe("run");
    // The only "r…" row: a repeat wraps all the way back to it.
    expect(findTypeaheadMatch(rows, "run", "rr")).toBe("run");
    // Wraps past the end to an earlier row.
    expect(findTypeaheadMatch(rows, "legal", "p")).toBe("pay");
  });

  it("matches a longer prefix from the current row, case-insensitively", () => {
    expect(findTypeaheadMatch(rows, "pay", "pa")).toBe("pay");
    expect(findTypeaheadMatch(rows, "fin", "CLO")).toBe("close");
    expect(findTypeaheadMatch(rows, "fin", "zz top")).toBeNull();
  });
});

describe("pickTabStop", () => {
  it("prefers the first visible candidate", () => {
    expect(pickTabStop(rows, [null, "close", "pay", "fin"])).toBe("close");
    // A selection inside a collapsed branch falls back to its visible ancestor.
    expect(pickTabStop(rows, ["hidden-process", "audit", "fin"])).toBe("audit");
  });

  it("falls back to the first row, or null for an empty tree", () => {
    expect(pickTabStop(rows, [null, undefined])).toBe("fin");
    expect(pickTabStop([], ["fin"])).toBeNull();
  });
});

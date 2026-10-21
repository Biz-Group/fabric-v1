"use client";

import { useSyncExternalStore } from "react";

// Whether the desktop process tree is collapsed to its rail. Independent of
// the app sidebar's collapse, and remembered per browser like it. Open by
// default; storage can be unavailable (private mode, blocked site data), in
// which case the tree simply starts open.
const TREE_COLLAPSED_KEY = "fabric:process-tree-collapsed";
const TREE_COLLAPSED_EVENT = "fabric:process-tree-collapsed-change";

// Set only when storage throws, so the toggle still works for the visit.
let memoryFallback: boolean | null = null;

function getTreeCollapsedSnapshot(): boolean {
  if (memoryFallback !== null) return memoryFallback;
  try {
    return window.localStorage.getItem(TREE_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function getServerTreeCollapsedSnapshot(): boolean {
  return false;
}

function subscribeToTreeCollapsed(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(TREE_COLLAPSED_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(TREE_COLLAPSED_EVENT, onStoreChange);
  };
}

export function setTreeCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(TREE_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Not remembered, but still applied for this page via the event below.
    memoryFallback = collapsed;
  }
  window.dispatchEvent(new Event(TREE_COLLAPSED_EVENT));
}

export function useTreeCollapsed(): boolean {
  return useSyncExternalStore(
    subscribeToTreeCollapsed,
    getTreeCollapsedSnapshot,
    getServerTreeCollapsedSnapshot,
  );
}

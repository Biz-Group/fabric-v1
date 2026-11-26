"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { FlowDirection, FlowGrouping } from "./flow-layout";

export type FlowViewPreferences = {
  direction: FlowDirection;
  grouping: FlowGrouping;
  /**
   * The owner-lanes note starts as a small button and opens on a click; it
   * stays open until collapsed again.
   */
  ownerLanesNoteCollapsed: boolean;
};

export const DEFAULT_FLOW_VIEW_PREFERENCES: FlowViewPreferences = {
  direction: "horizontal",
  grouping: "process",
  ownerLanesNoteCollapsed: true,
};

const STORAGE_KEY = "fabric:process-flow-view";
const CHANGE_EVENT = "fabric:process-flow-view-change";

export function parseFlowViewPreferences(
  value: string | null,
): FlowViewPreferences {
  if (!value) return DEFAULT_FLOW_VIEW_PREFERENCES;

  try {
    const parsed = JSON.parse(value) as Partial<FlowViewPreferences>;
    return {
      direction: parsed.direction === "vertical" ? "vertical" : "horizontal",
      grouping: parsed.grouping === "owner" ? "owner" : "process",
      // Only an explicit "open" keeps it open; older stored values predate it.
      ownerLanesNoteCollapsed: parsed.ownerLanesNoteCollapsed !== false,
    };
  } catch {
    return DEFAULT_FLOW_VIEW_PREFERENCES;
  }
}

function getSnapshot() {
  return window.localStorage.getItem(STORAGE_KEY) ?? "";
}

function getServerSnapshot() {
  return "";
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

export function useFlowViewPreferences() {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const preferences = useMemo(
    () => parseFlowViewPreferences(snapshot),
    [snapshot],
  );
  const setPreferences = useCallback((next: FlowViewPreferences) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [preferences, setPreferences] as const;
}

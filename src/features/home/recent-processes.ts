"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

// Processes this browser opened most recently, per user and org, for the
// workspace home's "Pick up where you left off". Ids only: names and ancestry
// are resolved against the live tree, so renames, moves, and deletions never
// show stale labels. Storage can be blocked (private windows, site-data
// settings); every access fails soft to an empty list.

export const MAX_RECENT_PROCESSES = 5;

const STORAGE_KEY_PREFIX = "fabric:recent-processes:";
const CHANGE_EVENT = "fabric:recent-processes-change";

function storageKey(userId: string, orgId: string) {
  return `${STORAGE_KEY_PREFIX}${userId}:${orgId}`;
}

export function parseRecentProcessIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .slice(0, MAX_RECENT_PROCESSES);
  } catch {
    return [];
  }
}

export function pushRecentProcessId(ids: string[], processId: string) {
  return [processId, ...ids.filter((id) => id !== processId)].slice(
    0,
    MAX_RECENT_PROCESSES,
  );
}

function readRaw(key: string) {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

export function rememberRecentProcess(
  userId: string,
  orgId: string,
  processId: string,
) {
  const key = storageKey(userId, orgId);
  const current = parseRecentProcessIds(readRaw(key));
  if (current[0] === processId) return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify(pushRecentProcessId(current, processId)),
    );
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Storage blocked: the home simply has no recent processes to offer.
  }
}

export function useRecentProcessIds(
  userId: string | null,
  orgId: string | null,
): string[] {
  const key = userId && orgId ? storageKey(userId, orgId) : null;
  const getSnapshot = useCallback(() => (key ? readRaw(key) : ""), [key]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => "");
  return useMemo(() => parseRecentProcessIds(snapshot), [snapshot]);
}

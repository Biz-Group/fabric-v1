import * as React from "react"

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

function getReducedMotionSnapshot() {
  return window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false
}

function getServerReducedMotionSnapshot() {
  return false
}

function subscribeToReducedMotionChanges(onStoreChange: () => void) {
  const mql = window.matchMedia?.(REDUCED_MOTION_QUERY)
  mql?.addEventListener("change", onStoreChange)
  return () => mql?.removeEventListener("change", onStoreChange)
}

/**
 * True while the OS asks for reduced motion. Follows the setting live, unlike
 * motion's `useReducedMotion`, which reads it once per component mount.
 */
export function usePrefersReducedMotion() {
  return React.useSyncExternalStore(
    subscribeToReducedMotionChanges,
    getReducedMotionSnapshot,
    getServerReducedMotionSnapshot
  )
}

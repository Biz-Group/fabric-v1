import * as React from "react"

// Below `lg`: phones and portrait tablets share the drill-down layout, since
// the desktop tree leaves too little room for the detail panel and its
// hover-only actions fail on touch.
const MOBILE_BREAKPOINT = 1024
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function getMobileSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches
}

function getServerMobileSnapshot() {
  return false
}

function subscribeToMobileChanges(onStoreChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener("change", onStoreChange)
  return () => mql.removeEventListener("change", onStoreChange)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribeToMobileChanges,
    getMobileSnapshot,
    getServerMobileSnapshot
  )
}

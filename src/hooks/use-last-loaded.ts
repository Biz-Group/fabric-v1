import { useState } from "react"

/**
 * Keeps showing the last loaded `value` while new arguments load, so a
 * search or filter change updates the page in place instead of swapping it
 * for a spinner (which also unmounts the input being typed into).
 *
 * `value` must keep its identity between renders until it changes, as Convex
 * query results do; a fresh object every render would loop.
 */
export function useLastLoaded<T>(value: T, loading: boolean): T {
  const [last, setLast] = useState(value)
  if (!loading && last !== value) setLast(value)
  return loading ? last : value
}

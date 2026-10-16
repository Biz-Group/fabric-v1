// Keyboard and screen-reader maths for the audio scrubber's slider role.
// Pure, so the key map and the spoken time can be tested without a DOM.

export const SCRUBBER_STEP_SECONDS = 5
export const SCRUBBER_PAGE_SECONDS = 30

/**
 * The time a slider key moves to, clamped to [0, duration], or null when the
 * key isn't a slider key (or there's nothing to seek) so the caller lets the
 * event through. Follows the ARIA slider pattern: Left/Down step back,
 * Right/Up step forward, PageDown/PageUp take a bigger step, Home and End
 * jump to the ends.
 */
export function scrubberKeyTarget(
  key: string,
  current: number,
  duration: number
): number | null {
  if (!Number.isFinite(duration) || duration <= 0) return null
  const now = Number.isFinite(current)
    ? Math.max(0, Math.min(current, duration))
    : 0

  let target: number
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      target = now - SCRUBBER_STEP_SECONDS
      break
    case "ArrowRight":
    case "ArrowUp":
      target = now + SCRUBBER_STEP_SECONDS
      break
    case "PageDown":
      target = now - SCRUBBER_PAGE_SECONDS
      break
    case "PageUp":
      target = now + SCRUBBER_PAGE_SECONDS
      break
    case "Home":
      target = 0
      break
    case "End":
      target = duration
      break
    default:
      return null
  }
  return Math.max(0, Math.min(target, duration))
}

function unit(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`
}

/** "1 hour 2 minutes 3 seconds", "12 minutes", "0 seconds". */
export function spokenDuration(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60

  const parts: string[] = []
  if (hours > 0) parts.push(unit(hours, "hour"))
  if (minutes > 0) parts.push(unit(minutes, "minute"))
  if (secs > 0 || parts.length === 0) parts.push(unit(secs, "second"))
  return parts.join(" ")
}

/** aria-valuetext for the scrubber: "1 minute 23 seconds of 12 minutes". */
export function scrubberValueText(current: number, duration: number): string {
  if (!Number.isFinite(duration) || duration <= 0) {
    return spokenDuration(current)
  }
  return `${spokenDuration(current)} of ${spokenDuration(duration)}`
}

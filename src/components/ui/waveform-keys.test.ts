import { describe, expect, it } from "vitest"
import {
  scrubberKeyTarget,
  scrubberValueText,
  spokenDuration,
} from "./waveform-keys"

describe("scrubberKeyTarget", () => {
  it("steps 5 seconds with the arrow keys", () => {
    expect(scrubberKeyTarget("ArrowLeft", 60, 720)).toBe(55)
    expect(scrubberKeyTarget("ArrowDown", 60, 720)).toBe(55)
    expect(scrubberKeyTarget("ArrowRight", 60, 720)).toBe(65)
    expect(scrubberKeyTarget("ArrowUp", 60, 720)).toBe(65)
  })

  it("steps 30 seconds with Page Up and Page Down", () => {
    expect(scrubberKeyTarget("PageDown", 60, 720)).toBe(30)
    expect(scrubberKeyTarget("PageUp", 60, 720)).toBe(90)
  })

  it("jumps to the ends with Home and End", () => {
    expect(scrubberKeyTarget("Home", 60, 720)).toBe(0)
    expect(scrubberKeyTarget("End", 60, 720)).toBe(720)
  })

  it("clamps to the start and the end", () => {
    expect(scrubberKeyTarget("ArrowLeft", 2, 720)).toBe(0)
    expect(scrubberKeyTarget("PageDown", 10, 720)).toBe(0)
    expect(scrubberKeyTarget("ArrowRight", 718, 720)).toBe(720)
    expect(scrubberKeyTarget("PageUp", 700, 720)).toBe(720)
  })

  it("treats an out-of-range or missing current time as clamped", () => {
    expect(scrubberKeyTarget("ArrowLeft", 900, 720)).toBe(715)
    expect(scrubberKeyTarget("ArrowRight", Number.NaN, 720)).toBe(5)
  })

  it("ignores other keys", () => {
    expect(scrubberKeyTarget(" ", 60, 720)).toBeNull()
    expect(scrubberKeyTarget("Enter", 60, 720)).toBeNull()
    expect(scrubberKeyTarget("k", 60, 720)).toBeNull()
  })

  it("does nothing without a duration", () => {
    expect(scrubberKeyTarget("ArrowRight", 0, 0)).toBeNull()
    expect(scrubberKeyTarget("End", 0, Number.NaN)).toBeNull()
  })
})

describe("spokenDuration", () => {
  it("reads whole units with plurals", () => {
    expect(spokenDuration(0)).toBe("0 seconds")
    expect(spokenDuration(1)).toBe("1 second")
    expect(spokenDuration(83)).toBe("1 minute 23 seconds")
    expect(spokenDuration(720)).toBe("12 minutes")
    expect(spokenDuration(3723)).toBe("1 hour 2 minutes 3 seconds")
    expect(spokenDuration(7200)).toBe("2 hours")
  })

  it("drops fractions and bad values", () => {
    expect(spokenDuration(83.9)).toBe("1 minute 23 seconds")
    expect(spokenDuration(-4)).toBe("0 seconds")
    expect(spokenDuration(Number.NaN)).toBe("0 seconds")
  })
})

describe("scrubberValueText", () => {
  it("reads the position against the length", () => {
    expect(scrubberValueText(83, 720)).toBe("1 minute 23 seconds of 12 minutes")
  })

  it("reads the position alone when there's no length", () => {
    expect(scrubberValueText(83, 0)).toBe("1 minute 23 seconds")
  })
})

import { describe, expect, it } from "vitest";
import {
  controlsPositionFrom,
  isStackedBelow,
  shouldDockMiniPlayer,
} from "./playback-layout";

const VIEWPORT = 800;

describe("controlsPositionFrom", () => {
  it("is visible whenever the observer says so", () => {
    expect(
      controlsPositionFrom(
        { isIntersecting: true, boundingClientRect: { top: -10, bottom: 20 } },
        VIEWPORT,
      ),
    ).toBe("visible");
  });

  it("puts controls clipped under the workbench header above, not below", () => {
    // Scrolled past the tab panel's top edge but still inside the viewport.
    expect(
      controlsPositionFrom(
        { isIntersecting: false, boundingClientRect: { top: 120, bottom: 152 } },
        VIEWPORT,
      ),
    ).toBe("above");
  });

  it("puts controls past the tab panel's bottom edge below", () => {
    expect(
      controlsPositionFrom(
        { isIntersecting: false, boundingClientRect: { top: 900, bottom: 932 } },
        VIEWPORT,
      ),
    ).toBe("below");
  });
});

describe("shouldDockMiniPlayer", () => {
  it("stays hidden while the controls are on screen", () => {
    expect(
      shouldDockMiniPlayer({
        controls: "visible",
        isPlaying: true,
        activeItemIsShown: true,
      }),
    ).toBe(false);
  });

  it("stays docked after pausing the shown conversation", () => {
    expect(
      shouldDockMiniPlayer({
        controls: "above",
        isPlaying: false,
        activeItemIsShown: true,
      }),
    ).toBe(true);
  });

  it("docks for another conversation only while it plays", () => {
    expect(
      shouldDockMiniPlayer({
        controls: "below",
        isPlaying: true,
        activeItemIsShown: false,
      }),
    ).toBe(true);
    expect(
      shouldDockMiniPlayer({
        controls: "below",
        isPlaying: false,
        activeItemIsShown: false,
      }),
    ).toBe(false);
  });
});

describe("isStackedBelow", () => {
  const list = { top: 0, bottom: 640 };

  it("is true when the panel starts where the list ends", () => {
    expect(isStackedBelow(list, { top: 640, bottom: 1400 })).toBe(true);
    // Sub-pixel rounding at the shared edge.
    expect(isStackedBelow(list, { top: 639.5, bottom: 1400 })).toBe(true);
  });

  it("is false for side-by-side columns", () => {
    expect(isStackedBelow(list, { top: 0, bottom: 640 })).toBe(false);
  });
});

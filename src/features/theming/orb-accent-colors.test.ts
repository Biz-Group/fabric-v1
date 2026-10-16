import { describe, expect, it } from "vitest";
import { orbColorsFromAccent, rgbFromPixel } from "./orb-accent-colors";

describe("orbColorsFromAccent", () => {
  it("uses the accent, then a lighter tint of it", () => {
    expect(orbColorsFromAccent({ r: 0, g: 100, b: 200 })).toEqual([
      "#0064C8",
      "#66A2DE",
    ]);
  });

  it("keeps white white", () => {
    expect(orbColorsFromAccent({ r: 255, g: 255, b: 255 })).toEqual([
      "#FFFFFF",
      "#FFFFFF",
    ]);
  });
});

describe("rgbFromPixel", () => {
  it("reads an opaque pixel", () => {
    expect(rgbFromPixel([10, 20, 30, 255])).toEqual({ r: 10, g: 20, b: 30 });
  });

  it("treats a cleared pixel as unreadable", () => {
    expect(rgbFromPixel([0, 0, 0, 0])).toBeNull();
    expect(rgbFromPixel([])).toBeNull();
  });
});

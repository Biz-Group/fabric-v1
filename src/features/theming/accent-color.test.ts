import { describe, expect, test } from "vitest";
import { buildOrgThemeAccentRgb } from "../../../convex/themeColors";
import {
  describeAccentAdjustment,
  hexToRgb,
  normalizeHex,
  rgbToHex,
} from "./accent-color";

describe("hex helpers", () => {
  test("normalizes short, unprefixed and lower-case hex", () => {
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex(" 2563d2 ")).toBe("#2563D2");
    expect(normalizeHex("#2563D2")).toBe("#2563D2");
  });

  test("rejects anything that isn't 3 or 6 hex digits", () => {
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("#GGGGGG")).toBeNull();
    expect(normalizeHex("")).toBeNull();
    expect(hexToRgb("blue")).toBeNull();
  });

  test("round-trips between hex and RGB", () => {
    expect(hexToRgb("#2563D2")).toEqual({ r: 37, g: 99, b: 210 });
    expect(rgbToHex({ r: 37, g: 99, b: 210 })).toBe("#2563D2");
    expect(rgbToHex({ r: -4, g: 300, b: 127.6 })).toBe("#00FF80");
    expect(rgbToHex(null)).toBeNull();
  });
});

describe("describeAccentAdjustment", () => {
  test("reports the accent each mode ships when it differs from the entry", () => {
    const entered = { r: 37, g: 99, b: 210 };
    const shipped = buildOrgThemeAccentRgb(entered);
    const adjustment = describeAccentAdjustment(entered);

    expect(adjustment).toEqual({
      enteredHex: "#2563D2",
      lightHex: rgbToHex(shipped.light),
      darkHex: rgbToHex(shipped.dark),
      adjusted: true,
    });
    expect(adjustment.lightHex).not.toBe(adjustment.enteredHex);
  });

  test("says nothing was adjusted when light mode ships the colour as entered", () => {
    // Very dark greys all ship as the same readable grey, so that grey ships
    // unchanged.
    const shippedGrey = describeAccentAdjustment({ r: 20, g: 20, b: 20 }).lightHex;
    const adjustment = describeAccentAdjustment(hexToRgb(shippedGrey)!);

    expect(adjustment.adjusted).toBe(false);
    expect(adjustment.lightHex).toBe(shippedGrey);
    expect(adjustment.darkHex).not.toBe(shippedGrey);
  });

  test("clamps out-of-range channels before describing them", () => {
    expect(describeAccentAdjustment({ r: 300, g: -5, b: 64.4 }).enteredHex).toBe(
      "#FF0040",
    );
  });
});

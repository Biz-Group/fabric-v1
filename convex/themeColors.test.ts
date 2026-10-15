import { describe, expect, test } from "vitest";
import {
  ACCENT_MIN_CONTRAST,
  buildOrgThemeAccentRgb,
  buildOrgThemeTokens,
  clampRgb,
  type Rgb,
} from "./themeColors";

// WCAG contrast, written out here so the test doesn't trust the module's own.
function luminance({ r, g, b }: Rgb): number {
  const [red, green, blue] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

// OKLab lightness of an sRGB colour, to compare with a token's `oklch(L …)`.
function oklabLightness({ r, g, b }: Rgb): number {
  const [red, green, blue] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

function chroma(token: string): number {
  const match = token.match(/^oklch\([^\s]+\s+([^\s]+)\s+/);
  if (!match) throw new Error(`Unable to parse OKLCH token: ${token}`);
  return Number(match[1]);
}

function lightness(token: string): number {
  const match = token.match(/^oklch\(([^\s]+)\s+/);
  if (!match) throw new Error(`Unable to parse OKLCH token: ${token}`);
  return Number(match[1]);
}

describe("org theme color normalization", () => {
  test("clamps extracted RGB channel values", () => {
    expect(clampRgb({ r: -12, g: 128.4, b: 300 })).toEqual({
      r: 0,
      g: 128,
      b: 255,
    });
  });

  test("generates trusted OKLCH token sets for a saturated logo color", () => {
    const tokens = buildOrgThemeTokens({ r: 28, g: 95, b: 210 });

    expect(tokens.lightTokens.accent).toMatch(/^oklch\(/);
    expect(tokens.darkTokens.accent).toMatch(/^oklch\(/);
    expect(tokens.lightTokens.accentForeground).toBe("oklch(0.985 0 0)");
    expect(tokens.darkTokens.accentForeground).toBe("oklch(0.145 0 0)");
    expect(tokens.lightTokens.chart1).not.toBe(tokens.lightTokens.chart2);
  });

  test("preserves enough chroma for punchy saturated logo accents", () => {
    const tokens = buildOrgThemeTokens({ r: 28, g: 95, b: 210 });

    expect(chroma(tokens.lightTokens.accent)).toBeGreaterThanOrEqual(0.14);
    expect(chroma(tokens.lightTokens.selected)).toBeGreaterThanOrEqual(0.065);
    expect(chroma(tokens.lightTokens.subtle)).toBeGreaterThanOrEqual(0.05);
    expect(chroma(tokens.darkTokens.accent)).toBeGreaterThanOrEqual(0.13);
  });

  test("keeps monochrome logos in the neutral aesthetic", () => {
    const tokens = buildOrgThemeTokens({ r: 35, g: 35, b: 35 });

    expect(tokens.lightTokens.accent).toContain(" 0 ");
    expect(tokens.darkTokens.accent).toContain(" 0 ");
  });

  test.each([
    ["blue", { r: 28, g: 95, b: 210 }],
    ["orange", { r: 220, g: 76, b: 44 }],
    ["brown", { r: 145, g: 74, b: 31 }],
    ["green", { r: 30, g: 130, b: 82 }],
    ["low saturation", { r: 128, g: 130, b: 124 }],
  ])("keeps %s selected and subtle surfaces restrained", (_label, rgb) => {
    const tokens = buildOrgThemeTokens(rgb);
    const lightAccentChroma = chroma(tokens.lightTokens.accent);
    const darkAccentChroma = chroma(tokens.darkTokens.accent);

    expect(lightness(tokens.lightTokens.subtle)).toBeGreaterThanOrEqual(0.93);
    expect(lightness(tokens.lightTokens.selected)).toBeGreaterThanOrEqual(0.9);
    expect(chroma(tokens.lightTokens.subtle)).toBeLessThanOrEqual(
      lightAccentChroma,
    );
    expect(chroma(tokens.lightTokens.selected)).toBeLessThanOrEqual(
      lightAccentChroma,
    );
    expect(tokens.lightTokens.selectedForeground).toBe("oklch(0.145 0 0)");

    expect(lightness(tokens.darkTokens.subtle)).toBeGreaterThanOrEqual(0.24);
    expect(lightness(tokens.darkTokens.subtle)).toBeLessThanOrEqual(0.36);
    expect(lightness(tokens.darkTokens.selected)).toBeGreaterThanOrEqual(0.28);
    expect(lightness(tokens.darkTokens.selected)).toBeLessThanOrEqual(0.4);
    expect(chroma(tokens.darkTokens.subtle)).toBeLessThanOrEqual(
      darkAccentChroma,
    );
    expect(chroma(tokens.darkTokens.selected)).toBeLessThanOrEqual(
      darkAccentChroma,
    );
    expect(tokens.darkTokens.selectedForeground).toBe("oklch(0.985 0 0)");
  });
});

describe("shipped accent colours", () => {
  test.each([
    ["blue", { r: 28, g: 95, b: 210 }],
    ["orange", { r: 220, g: 76, b: 44 }],
    ["pale yellow", { r: 250, g: 235, b: 140 }],
    ["green", { r: 30, g: 130, b: 82 }],
    ["near black", { r: 12, g: 12, b: 12 }],
  ])("keeps text on the %s accent readable in both modes", (_label, rgb) => {
    const accents = buildOrgThemeAccentRgb(rgb);

    // Light mode puts white text on the accent, dark mode near-black.
    expect(contrast(accents.light, { r: 255, g: 255, b: 255 })).toBeGreaterThanOrEqual(
      ACCENT_MIN_CONTRAST,
    );
    expect(contrast(accents.dark, { r: 18, g: 18, b: 18 })).toBeGreaterThanOrEqual(
      ACCENT_MIN_CONTRAST,
    );
  });

  test("darkens a mid-tone input for light mode and lightens it for dark mode", () => {
    const input = { r: 28, g: 95, b: 210 };
    const accents = buildOrgThemeAccentRgb(input);

    expect(luminance(accents.light)).toBeLessThan(luminance(input));
    expect(luminance(accents.dark)).toBeGreaterThan(luminance(input));
  });

  test.each([
    ["blue", { r: 28, g: 95, b: 210 }],
    ["orange", { r: 220, g: 76, b: 44 }],
    ["grey", { r: 35, g: 35, b: 35 }],
  ])("matches the %s accent tokens the workspace applies", (_label, rgb) => {
    const tokens = buildOrgThemeTokens(rgb);
    const accents = buildOrgThemeAccentRgb(rgb);

    expect(oklabLightness(accents.light)).toBeCloseTo(
      lightness(tokens.lightTokens.accent),
      2,
    );
    expect(oklabLightness(accents.dark)).toBeCloseTo(
      lightness(tokens.darkTokens.accent),
      2,
    );
  });
});

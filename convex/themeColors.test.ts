import { describe, expect, test } from "vitest";
import { buildOrgThemeTokens, clampRgb } from "./themeColors";

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

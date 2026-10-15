import {
  buildOrgThemeAccentRgb,
  clampRgb,
  type Rgb,
} from "../../../convex/themeColors";

function rgbChannelToHex(channel: number) {
  return Math.round(Math.min(255, Math.max(0, channel)))
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
}

function formatHex(rgb: Rgb) {
  return `#${rgbChannelToHex(rgb.r)}${rgbChannelToHex(rgb.g)}${rgbChannelToHex(rgb.b)}`;
}

export function rgbToHex(rgb?: Rgb | null) {
  return rgb ? formatHex(rgb) : null;
}

/** `#RRGGBB` in upper case, from a 3- or 6-digit hex with or without `#`. */
export function normalizeHex(value: string) {
  const trimmed = value.trim();
  const candidate = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  const shortMatch = candidate.match(/^#([0-9a-fA-F]{3})$/);

  if (shortMatch) {
    const [red, green, blue] = shortMatch[1].split("");
    return `#${red}${red}${green}${green}${blue}${blue}`.toUpperCase();
  }

  if (/^#[0-9a-fA-F]{6}$/.test(candidate)) {
    return candidate.toUpperCase();
  }

  return null;
}

export function hexToRgb(value: string): Rgb | null {
  const normalized = normalizeHex(value);
  if (!normalized) return null;

  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

export type AccentAdjustment = {
  enteredHex: string;
  /** The accent light mode ships, after the server's readability pass. */
  lightHex: string;
  /** Dark mode's lighter counterpart. */
  darkHex: string;
  /** Light mode ships a different colour from the one entered. */
  adjusted: boolean;
};

/** What an entered accent ships as in each mode, from the server's own
 * derivation (convex/themeColors.ts). */
export function describeAccentAdjustment(input: Rgb): AccentAdjustment {
  const entered = clampRgb(input);
  const shipped = buildOrgThemeAccentRgb(entered);
  const enteredHex = formatHex(entered);
  const lightHex = formatHex(shipped.light);
  return {
    enteredHex,
    lightHex,
    darkHex: formatHex(shipped.dark),
    adjusted: lightHex !== enteredHex,
  };
}

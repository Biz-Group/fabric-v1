import type { Rgb } from "../../../convex/themeColors";
import { rgbToHex } from "./accent-color";

/** The Orb's colours before it followed the tenant accent; used when the
 * accent can't be read (no DOM yet, or a colour the browser can't paint). */
export const FALLBACK_ORB_COLORS: readonly [string, string] = [
  "#6366f1",
  "#8b5cf6",
];

/** How far the Orb's second colour moves from the accent toward white. */
const ORB_HIGHLIGHT_MIX = 0.4;

function mixTowardWhite(rgb: Rgb, amount: number): Rgb {
  return {
    r: rgb.r + (255 - rgb.r) * amount,
    g: rgb.g + (255 - rgb.g) * amount,
    b: rgb.b + (255 - rgb.b) * amount,
  };
}

/**
 * The Orb's two ramp colours from the accent: the accent itself, then a
 * lighter tint of it. The shader ramps black → first → second → white.
 */
export function orbColorsFromAccent(accent: Rgb): [string, string] {
  const base = rgbToHex(accent) ?? FALLBACK_ORB_COLORS[0];
  const highlight =
    rgbToHex(mixTowardWhite(accent, ORB_HIGHLIGHT_MIX)) ??
    FALLBACK_ORB_COLORS[1];
  return [base, highlight];
}

/** RGB from one RGBA pixel (`getImageData`), or null if it's transparent:
 * a colour the canvas couldn't paint leaves the pixel cleared. */
export function rgbFromPixel(pixel: ArrayLike<number>): Rgb | null {
  if (pixel.length < 4 || pixel[3] === 0) return null;
  return { r: pixel[0], g: pixel[1], b: pixel[2] };
}

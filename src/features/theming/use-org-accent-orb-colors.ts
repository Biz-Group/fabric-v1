"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  FALLBACK_ORB_COLORS,
  orbColorsFromAccent,
  rgbFromPixel,
} from "./orb-accent-colors";

const FALLBACK_KEY = FALLBACK_ORB_COLORS.join(",");

let probeContext: CanvasRenderingContext2D | null | undefined;

/** The accent as sRGB. `--org-accent` is an oklch string (or the neutral
 * `--primary`), and WebGL needs numbers: a probe element resolves the
 * variable to a computed colour, and a 1×1 canvas paints it and reads the
 * pixel back, which converts any CSS colour the browser supports. */
function readAccentKey(): string {
  try {
    const root = document.documentElement;
    if (!getComputedStyle(root).getPropertyValue("--org-accent").trim()) {
      return FALLBACK_KEY;
    }

    const probe = document.createElement("span");
    probe.style.display = "none";
    probe.style.color = "var(--org-accent)";
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    if (!computed) return FALLBACK_KEY;

    if (probeContext === undefined) {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      probeContext = canvas.getContext("2d", { willReadFrequently: true });
    }
    const context = probeContext;
    if (!context) return FALLBACK_KEY;

    context.clearRect(0, 0, 1, 1);
    // An unparseable fillStyle is ignored, so start from transparent: the
    // pixel then stays cleared and reads as unreadable.
    context.fillStyle = "rgba(0, 0, 0, 0)";
    context.fillStyle = computed;
    context.fillRect(0, 0, 1, 1);
    const rgb = rgbFromPixel(context.getImageData(0, 0, 1, 1).data);
    return rgb ? orbColorsFromAccent(rgb).join(",") : FALLBACK_KEY;
  } catch {
    return FALLBACK_KEY;
  }
}

let cachedKey: string | null = null;

function getSnapshot() {
  cachedKey ??= readAccentKey();
  return cachedKey;
}

function getServerSnapshot() {
  return FALLBACK_KEY;
}

// OrgThemeProvider writes the tenant tokens to the root's inline style, and
// the light/dark toggle flips its class (and `data-theme`).
function subscribe(onStoreChange: () => void) {
  cachedKey = null;
  const observer = new MutationObserver(() => {
    cachedKey = null;
    onStoreChange();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style", "class", "data-theme"],
  });
  return () => observer.disconnect();
}

/** The Orb's two colours from the tenant accent, following theme changes.
 * Falls back to the Orb's original indigo/violet if the accent can't be read. */
export function useOrgAccentOrbColors(): [string, string] {
  const key = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => {
    const [first, second] = key.split(",");
    return [first, second];
  }, [key]);
}

export type Rgb = {
  r: number;
  g: number;
  b: number;
};

type Oklch = {
  l: number;
  c: number;
  h: number;
};

export type OrgThemeTokens = {
  accent: string;
  accentForeground: string;
  subtle: string;
  border: string;
  ring: string;
  selected: string;
  selectedForeground: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
};

export type OrgThemeTokenSet = {
  lightTokens: OrgThemeTokens;
  darkTokens: OrgThemeTokens;
};

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 18, g: 18, b: 18 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeHue(hue: number): number {
  const normalized = hue % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function clampRgb(rgb: Rgb): Rgb {
  return {
    r: Math.round(clamp(rgb.r, 0, 255)),
    g: Math.round(clamp(rgb.g, 0, 255)),
    b: Math.round(clamp(rgb.b, 0, 255)),
  };
}

function srgbToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const clamped = clamp(value, 0, 1);
  const srgb =
    clamped <= 0.0031308
      ? 12.92 * clamped
      : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return clamp(Math.round(srgb * 255), 0, 255);
}

function rgbToOklch(input: Rgb): Oklch {
  const rgb = clampRgb(input);
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);

  const okL = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot;
  const okA = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
  const okB = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;

  return {
    l: okL,
    c: Math.sqrt(okA * okA + okB * okB),
    h: normalizeHue((Math.atan2(okB, okA) * 180) / Math.PI),
  };
}

function oklchToRgb(color: Oklch): Rgb {
  const hueRadians = (normalizeHue(color.h) * Math.PI) / 180;
  const a = color.c * Math.cos(hueRadians);
  const b = color.c * Math.sin(hueRadians);

  const lRoot = color.l + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = color.l - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = color.l - 0.0894841775 * a - 1.291485548 * b;

  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;

  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

function relativeLuminance(rgb: Rgb): number {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function formatOklch(color: Oklch, alpha?: number): string {
  const l = clamp(color.l, 0, 1).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  const c = clamp(color.c, 0, 0.4).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  const h = normalizeHue(color.h).toFixed(1).replace(/\.0$/, "");
  if (alpha !== undefined) {
    return `oklch(${l} ${c} ${h} / ${alpha}%)`;
  }
  return `oklch(${l} ${c} ${h})`;
}

function readableAccent(color: Oklch, foreground: Rgb, direction: "darker" | "lighter"): Oklch {
  let next = { ...color };
  for (let i = 0; i < 16; i += 1) {
    if (contrastRatio(oklchToRgb(next), foreground) >= 4.5) return next;
    next = {
      ...next,
      l: direction === "darker" ? next.l - 0.025 : next.l + 0.025,
    };
  }
  return { ...next, l: clamp(next.l, 0.18, 0.86) };
}

function chromaFor(source: Oklch, min: number, max: number): number {
  if (source.c < 0.025) return 0;
  return clamp(source.c * 0.88, min, max);
}

function tone(source: Oklch, l: number, cScale: number, maxC: number, hueShift = 0): Oklch {
  return {
    l,
    c: source.c < 0.025 ? 0 : clamp(source.c * cScale, 0.018, maxC),
    h: normalizeHue(source.h + hueShift),
  };
}

export function buildOrgThemeTokens(input: Rgb): OrgThemeTokenSet {
  const source = rgbToOklch(clampRgb(input));
  const lightAccent = readableAccent(
    {
      l: clamp(source.l * 0.62, 0.29, 0.44),
      c: chromaFor(source, 0.065, 0.16),
      h: source.h,
    },
    WHITE,
    "darker",
  );
  const darkAccent = readableAccent(
    {
      l: clamp(source.l + 0.16, 0.68, 0.78),
      c: chromaFor(source, 0.055, 0.14),
      h: source.h,
    },
    BLACK,
    "lighter",
  );

  return {
    lightTokens: {
      accent: formatOklch(lightAccent),
      accentForeground: "oklch(0.985 0 0)",
      subtle: formatOklch(tone(source, 0.955, 0.34, 0.065)),
      border: formatOklch(tone(source, 0.74, 0.44, 0.09)),
      ring: formatOklch(tone(source, 0.59, 0.64, 0.13)),
      selected: formatOklch(tone(source, 0.935, 0.42, 0.08)),
      selectedForeground: "oklch(0.145 0 0)",
      chart1: formatOklch(tone(source, 0.56, 0.88, 0.17)),
      chart2: formatOklch(tone(source, 0.6, 0.76, 0.15, 42)),
      chart3: formatOklch(tone(source, 0.52, 0.68, 0.135, 118)),
      chart4: formatOklch(tone(source, 0.48, 0.58, 0.12, 190)),
      chart5: formatOklch(tone(source, 0.44, 0.5, 0.105, 270)),
    },
    darkTokens: {
      accent: formatOklch(darkAccent),
      accentForeground: "oklch(0.145 0 0)",
      subtle: formatOklch(tone(source, 0.285, 0.34, 0.07)),
      border: formatOklch(tone(source, 0.48, 0.44, 0.095)),
      ring: formatOklch(tone(source, 0.7, 0.66, 0.13)),
      selected: formatOklch(tone(source, 0.32, 0.42, 0.085)),
      selectedForeground: "oklch(0.985 0 0)",
      chart1: formatOklch(tone(source, 0.72, 0.82, 0.16)),
      chart2: formatOklch(tone(source, 0.68, 0.7, 0.14, 42)),
      chart3: formatOklch(tone(source, 0.64, 0.62, 0.125, 118)),
      chart4: formatOklch(tone(source, 0.6, 0.54, 0.11, 190)),
      chart5: formatOklch(tone(source, 0.56, 0.48, 0.1, 270)),
    },
  };
}
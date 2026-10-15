import type { CSSProperties } from "react";
import type { OrgThemeTokens } from "../../../convex/themeColors";
import type { ResolvedTheme } from "./theme-config";

export type { OrgThemeTokens };

export const ORG_THEME_VARIABLES = [
  "--org-accent",
  "--org-accent-foreground",
  "--org-accent-subtle",
  "--org-accent-border",
  "--org-accent-ring",
  "--org-accent-selected",
  "--org-accent-selected-foreground",
  "--primary",
  "--primary-foreground",
  "--ring",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--sidebar-primary",
  "--sidebar-ring",
] as const;

export type OrgThemeVariable = (typeof ORG_THEME_VARIABLES)[number];

// The workspace keeps tinted surfaces restrained: they mix the accent into the
// page's own neutrals instead of using the stored subtle/selected/border
// tokens, so they follow light and dark mode on their own.
const RESTRAINED_SUBTLE_SURFACE =
  "color-mix(in oklch, var(--org-accent) 7%, var(--background))";
const RESTRAINED_SELECTED_SURFACE =
  "color-mix(in oklch, var(--org-accent) 11%, var(--background))";
const RESTRAINED_ACCENT_BORDER =
  "color-mix(in oklch, var(--org-accent) 34%, var(--border))";

/**
 * The CSS variables a tenant theme sets, from one mode's tokens. The workspace
 * applies them to the document root (OrgThemeProvider) and the Appearance
 * preview to its frames, so the preview shows exactly what ships.
 */
export function orgThemeVariables(
  tokens: OrgThemeTokens,
): Record<OrgThemeVariable, string> {
  return {
    "--org-accent": tokens.accent,
    "--org-accent-foreground": tokens.accentForeground,
    "--org-accent-subtle": RESTRAINED_SUBTLE_SURFACE,
    "--org-accent-border": RESTRAINED_ACCENT_BORDER,
    "--org-accent-ring": tokens.ring,
    "--org-accent-selected": RESTRAINED_SELECTED_SURFACE,
    "--org-accent-selected-foreground": "var(--foreground)",
    "--primary": tokens.accent,
    "--primary-foreground": tokens.accentForeground,
    "--ring": tokens.ring,
    "--chart-1": tokens.chart1,
    "--chart-2": tokens.chart2,
    "--chart-3": tokens.chart3,
    "--chart-4": tokens.chart4,
    "--chart-5": tokens.chart5,
    "--sidebar-primary": tokens.accent,
    "--sidebar-ring": tokens.ring,
  };
}

/**
 * The page neutrals a preview frame draws on, and that the restrained surfaces
 * mix into, per mode. Copied from `:root` and `.dark` in globals.css: a frame
 * inside a dark page has no other way to get the light values back. A test
 * keeps the copies equal.
 */
export const PREVIEW_NEUTRAL_VARIABLES: Record<
  ResolvedTheme,
  Record<"--background" | "--foreground" | "--muted" | "--muted-foreground" | "--border", string>
> = {
  light: {
    "--background": "oklch(1 0 0)",
    "--foreground": "oklch(0.145 0 0)",
    "--muted": "oklch(0.97 0 0)",
    "--muted-foreground": "oklch(0.556 0 0)",
    "--border": "oklch(0.922 0 0)",
  },
  dark: {
    "--background": "oklch(0.185 0.006 255)",
    "--foreground": "oklch(0.93 0.004 255)",
    "--muted": "oklch(0.255 0.006 255)",
    "--muted-foreground": "oklch(0.69 0.01 255)",
    "--border": "oklch(0.74 0.008 255 / 16%)",
  },
};

/** Inline style for a preview frame: one mode's neutrals plus the theme. */
export function themePreviewStyle(
  mode: ResolvedTheme,
  tokens: OrgThemeTokens,
): CSSProperties {
  return {
    colorScheme: mode,
    ...PREVIEW_NEUTRAL_VARIABLES[mode],
    ...orgThemeVariables(tokens),
  } as CSSProperties;
}

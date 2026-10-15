"use client";

import type { CSSProperties } from "react";
import { Toaster } from "sonner";
import { useTheme } from "@/features/theming/theme-provider";

// The dark tints are translucent, so each sits on the popover colour: a toast
// floats over content and must stay opaque. Sonner applies these with the
// `background` shorthand, which takes the layered value.
function onPopover(tint: string) {
  return `linear-gradient(var(${tint}), var(${tint})), var(--popover)`;
}

// Sonner's richColors read these variables. Pointing them at the status tokens
// makes a success or error toast match the badges, in both themes, instead of
// Sonner's own palette.
const RICH_COLOR_TOKENS = {
  "--success-bg": onPopover("--success-subtle"),
  "--success-border": "var(--success-border)",
  "--success-text": "var(--success)",
  "--info-bg": onPopover("--info-subtle"),
  "--info-border": "var(--info-border)",
  "--info-text": "var(--info)",
  "--warning-bg": onPopover("--warning-subtle"),
  "--warning-border": "var(--warning-border)",
  "--warning-text": "var(--warning)",
  "--error-bg": onPopover("--destructive-subtle"),
  "--error-border": "var(--destructive-border)",
  "--error-text": "var(--destructive)",
} as CSSProperties;

export function ThemeToaster() {
  const { resolvedTheme } = useTheme();

  return (
    <Toaster
      theme={resolvedTheme}
      richColors
      closeButton
      position="bottom-right"
      style={RICH_COLOR_TOKENS}
    />
  );
}

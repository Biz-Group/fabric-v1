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
  // Sonner's own z-index is 999999999; the toast layer of the app's scale
  // (globals.css) keeps it above dialogs, menus and the FAB.
  zIndex: "var(--z-index-toast)",
} as CSSProperties;

// Sonner's default offsets (24px, 16px on phones), lifted over a docked bottom
// bar (the audio mini-player) so a toast never covers its controls.
const OFFSET = { bottom: "calc(24px + var(--bottom-dock-height, 0px))" };
const MOBILE_OFFSET = { bottom: "calc(16px + var(--bottom-dock-height, 0px))" };

export function ThemeToaster() {
  const { resolvedTheme } = useTheme();

  return (
    <Toaster
      theme={resolvedTheme}
      richColors
      closeButton
      position="bottom-right"
      offset={OFFSET}
      mobileOffset={MOBILE_OFFSET}
      style={RICH_COLOR_TOKENS}
    />
  );
}

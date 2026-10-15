"use client";

import { useQuery } from "convex/react";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { api } from "../../../convex/_generated/api";
import {
  ORG_THEME_VARIABLES,
  orgThemeVariables,
  type OrgThemeTokens,
} from "./org-theme-variables";

function getIsDarkMode() {
  if (typeof document === "undefined") return false;
  const resolvedTheme = document.documentElement.dataset.theme;
  if (resolvedTheme === "dark") return true;
  if (resolvedTheme === "light") return false;
  return document.documentElement.classList.contains("dark");
}

function applyThemeTokens(tokens: OrgThemeTokens | null) {
  const style = document.documentElement.style;
  for (const variable of ORG_THEME_VARIABLES) {
    style.removeProperty(variable);
  }

  if (!tokens) return;

  for (const [variable, value] of Object.entries(orgThemeVariables(tokens))) {
    style.setProperty(variable, value);
  }
}

export function OrgThemeProvider({ children }: { children: ReactNode }) {
  const theme = useQuery(api.orgThemes.getForCurrentOrg);
  const [isDark, setIsDark] = useState(getIsDarkMode);

  const activeTokens = useMemo<OrgThemeTokens | null>(() => {
    if (!theme) return null;
    const tokens = isDark ? theme.darkTokens : theme.lightTokens;
    return tokens ?? null;
  }, [isDark, theme]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const updateDarkMode = () => setIsDark(getIsDarkMode());
    media?.addEventListener("change", updateDarkMode);

    const observer = new MutationObserver(updateDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      media?.removeEventListener("change", updateDarkMode);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    applyThemeTokens(activeTokens);
    return () => applyThemeTokens(null);
  }, [activeTokens]);

  return <>{children}</>;
}

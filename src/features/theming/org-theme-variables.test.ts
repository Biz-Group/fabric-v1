import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { buildOrgThemeTokens } from "../../../convex/themeColors";
import {
  ORG_THEME_VARIABLES,
  PREVIEW_NEUTRAL_VARIABLES,
  orgThemeVariables,
  themePreviewStyle,
} from "./org-theme-variables";

const tokens = buildOrgThemeTokens({ r: 28, g: 95, b: 210 });

function cssBlock(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  if (start === -1) throw new Error(`No ${selector} block in globals.css`);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

function cssVariable(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`\\s${name}:\\s*([^;]+);`));
  return match?.[1].trim();
}

describe("org theme CSS variables", () => {
  test("sets every variable the provider clears, and nothing else", () => {
    expect(Object.keys(orgThemeVariables(tokens.lightTokens)).sort()).toEqual(
      [...ORG_THEME_VARIABLES].sort(),
    );
  });

  test("drives primary, sidebar and charts from the mode's tokens", () => {
    const variables = orgThemeVariables(tokens.darkTokens);

    expect(variables["--org-accent"]).toBe(tokens.darkTokens.accent);
    expect(variables["--primary"]).toBe(tokens.darkTokens.accent);
    expect(variables["--sidebar-primary"]).toBe(tokens.darkTokens.accent);
    expect(variables["--primary-foreground"]).toBe(tokens.darkTokens.accentForeground);
    expect(variables["--ring"]).toBe(tokens.darkTokens.ring);
    expect(variables["--chart-3"]).toBe(tokens.darkTokens.chart3);
  });

  test("mixes the tinted surfaces into the page's own neutrals", () => {
    const variables = orgThemeVariables(tokens.lightTokens);

    expect(variables["--org-accent-subtle"]).toContain("var(--background)");
    expect(variables["--org-accent-selected"]).toContain("var(--background)");
    expect(variables["--org-accent-border"]).toContain("var(--border)");
    expect(variables["--org-accent-selected-foreground"]).toBe("var(--foreground)");
  });

  test("a preview frame carries its mode's neutrals and the theme", () => {
    const style = themePreviewStyle("dark", tokens.darkTokens) as Record<
      string,
      string
    >;

    expect(style.colorScheme).toBe("dark");
    expect(style["--background"]).toBe(PREVIEW_NEUTRAL_VARIABLES.dark["--background"]);
    expect(style["--org-accent"]).toBe(tokens.darkTokens.accent);
  });

  test("preview neutrals match globals.css in both modes", () => {
    const css = readFileSync(
      new URL("../../app/globals.css", import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const blocks = { light: cssBlock(css, ":root"), dark: cssBlock(css, ".dark") };

    for (const mode of ["light", "dark"] as const) {
      for (const [name, value] of Object.entries(PREVIEW_NEUTRAL_VARIABLES[mode])) {
        expect(cssVariable(blocks[mode], name), `${mode} ${name}`).toBe(value);
      }
    }
  });
});

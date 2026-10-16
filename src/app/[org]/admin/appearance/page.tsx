"use client";

import type { ReactNode } from "react";
import { useId, useMemo, useState } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import {
  Check,
  History,
  MoonStar,
  Palette,
  Pencil,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Sun,
  X,
} from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { api } from "../../../../../convex/_generated/api";
import {
  ACCENT_MIN_CONTRAST,
  buildOrgThemeTokens,
  type OrgThemeTokens,
  type OrgThemeTokenSet,
} from "../../../../../convex/themeColors";
import {
  describeAccentAdjustment,
  hexToRgb,
  normalizeHex,
  rgbToHex,
  type AccentAdjustment,
} from "@/features/theming/accent-color";
import { extractLogoAccentRgb } from "@/features/theming/logo-theme";
import { themePreviewStyle } from "@/features/theming/org-theme-variables";
import type { ResolvedTheme } from "@/features/theming/theme-config";
import { useTheme } from "@/features/theming/theme-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { StatusTone } from "@/features/status/status-meta";
import { describeError } from "@/lib/user-error-message";
import { cn } from "@/lib/utils";

const DEFAULT_ACCENT_HEX = "#2563D2";

const PREVIEW_MODES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: MoonStar },
] as const;

const TOKEN_SWATCHES = [
  ["Accent", "bg-org-accent"],
  ["Subtle", "bg-org-accent-subtle"],
  ["Selected", "bg-org-accent-selected"],
  ["Border", "bg-org-accent-border"],
  ["Ring", "bg-org-accent-ring"],
] as const;

const CHART_SWATCHES = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
] as const;

function tokenSet(
  lightTokens?: OrgThemeTokens,
  darkTokens?: OrgThemeTokens,
): OrgThemeTokenSet | null {
  return lightTokens && darkTokens ? { lightTokens, darkTokens } : null;
}

function getSafeHttpsUrl(imageUrl?: string | null): string | null {
  if (!imageUrl) return null;
  try {
    const url = new URL(imageUrl);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatDate(ts?: number | null) {
  if (!ts) return "Not generated yet";
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusTone(
  status?: "pending" | "extracting" | "ready" | "failed" | "override",
): StatusTone {
  if (status === "ready" || status === "override") return "success";
  if (status === "failed") return "destructive";
  if (status === "extracting") return "info";
  // A generated accent waits for an admin to approve it.
  if (status === "pending") return "warning";
  return "neutral";
}

/**
 * A frame drawn in one mode whatever mode the page is in. It carries the
 * theme's CSS variables exactly as the workspace applies them, and children
 * style with the ordinary tokens (`bg-background`, `org-selected-surface`), so
 * the preview resolves through the same variables as the live app. Children
 * avoid `dark:` variants, which follow the page rather than the frame.
 */
function PreviewFrame({
  mode,
  tokens,
  className,
  children,
}: {
  mode: ResolvedTheme;
  tokens: OrgThemeTokens;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        mode === "dark" && "dark",
        "bg-background text-foreground",
        className,
      )}
      style={themePreviewStyle(mode, tokens)}
    >
      {children}
    </div>
  );
}

function PreviewModeToggle({
  mode,
  onModeChange,
}: {
  mode: ResolvedTheme;
  onModeChange: (mode: ResolvedTheme) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Preview mode"
      className="inline-flex rounded-lg bg-muted p-[3px]"
    >
      {PREVIEW_MODES.map(({ value, label, icon: Icon }) => (
        <Button
          key={value}
          type="button"
          variant="ghost"
          size="xs"
          aria-pressed={mode === value}
          onClick={() => onModeChange(value)}
          className={cn(
            "text-muted-foreground",
            mode === value &&
              "bg-background text-foreground shadow-sm hover:bg-background dark:hover:bg-background",
          )}
        >
          <Icon />
          {label}
        </Button>
      ))}
    </div>
  );
}

function TokenSwatches({
  mode,
  tokens,
}: {
  mode: ResolvedTheme;
  tokens: OrgThemeTokens;
}) {
  return (
    <PreviewFrame
      mode={mode}
      tokens={tokens}
      className="space-y-2 rounded-lg border p-3"
    >
      <p className="text-xs font-medium">{mode === "dark" ? "Dark" : "Light"}</p>
      <div className="grid grid-cols-5 gap-2">
        {TOKEN_SWATCHES.map(([label, swatchClassName]) => (
          <div key={label} className="min-w-0 space-y-1">
            <div className={cn("h-8 rounded-md border", swatchClassName)} />
            <p className="truncate text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
    </PreviewFrame>
  );
}

// A slice of the workspace, styled only through theme variables.
function WorkspaceMock() {
  return (
    <div className="grid min-h-72 md:grid-cols-[12rem_minmax(0,1fr)]">
      <aside className="border-b bg-muted/20 p-3 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Fabric.</span>
          <span className="h-4 w-px bg-border" aria-hidden />
          <span className="flex size-7 items-center justify-center rounded-md border border-org-accent-border bg-org-accent-subtle text-[10px] font-semibold text-org-accent-selected-foreground">
            ORG
          </span>
        </div>
        <div className="mt-4 space-y-1 text-sm">
          <div className="org-selected-surface flex items-center gap-2 rounded-lg border px-2.5 py-2 font-medium">
            <span className="size-2 rounded-full bg-org-accent" />
            Processes
          </div>
          <div className="rounded-lg px-2.5 py-2 text-muted-foreground">
            Admin
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <div className="border-b p-3">
          <div className="truncate text-xs text-muted-foreground">
            Learning Technology / Axonify
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
            <h4 className="min-w-0 truncate text-base font-semibold">
              Axonify Support Ticketing
            </h4>
            <span className="inline-flex h-7 items-center rounded-lg bg-org-accent px-2.5 text-[0.8rem] font-medium text-org-accent-foreground">
              Primary action
            </span>
          </div>
        </div>

        <div className="grid md:grid-cols-[13rem_minmax(0,1fr)]">
          <div className="space-y-1 border-b p-3 text-sm md:border-b-0 md:border-r">
            <div className="flex items-center gap-2 px-2 py-1.5 font-medium">
              <span className="size-2 rounded-full bg-muted-foreground/50" />
              Learning Technology
            </div>
            <div className="flex items-center gap-2 px-5 py-1.5 text-muted-foreground">
              <span className="size-2 rounded-full bg-muted-foreground/35" />
              Axonify
            </div>
            <div className="org-selected-surface flex items-center gap-2 rounded-md border px-5 py-1.5 font-medium">
              <span className="size-2 rounded-full bg-org-accent" />
              <span className="min-w-0 truncate">Support Ticketing</span>
            </div>
          </div>

          <div className="space-y-3 p-3">
            <div className="flex items-center gap-3 border-b text-xs">
              <span className="border-b-2 border-org-accent px-1 pb-2 font-medium text-org-accent">
                Conversations
              </span>
              <span className="px-1 pb-2 text-muted-foreground">
                Process Flow
              </span>
              <span className="mb-2 flex h-5 min-w-5 items-center justify-center rounded-full border border-org-accent-border bg-org-accent-subtle px-1.5 text-[11px] font-semibold text-org-accent-selected-foreground">
                2
              </span>
            </div>

            <div className="org-selected-surface rounded-lg border p-3">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-sm font-semibold text-org-accent">
                  <PlayCircle className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    AI Interview with Saish
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Apr 22, 1:39 PM - 15:28
                  </div>
                </div>
                <span className="rounded-full border border-org-accent-border bg-org-accent-subtle px-2 py-0.5 text-[11px] font-medium text-org-accent-selected-foreground">
                  Completed
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full w-2/3 rounded-full bg-org-accent" />
              </div>
              <div className="flex gap-1.5">
                {CHART_SWATCHES.map((swatchClassName, index) => (
                  <div
                    key={swatchClassName}
                    className={cn("h-8 flex-1 rounded-md", swatchClassName)}
                    title={`Chart ${index + 1}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Both modes' tokens side by side, and the workspace in the chosen mode. */
function ThemePreviewBody({
  tokens,
  mode,
}: {
  tokens: OrgThemeTokenSet;
  mode: ResolvedTheme;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <TokenSwatches mode="light" tokens={tokens.lightTokens} />
        <TokenSwatches mode="dark" tokens={tokens.darkTokens} />
      </div>
      <PreviewFrame
        mode={mode}
        tokens={mode === "dark" ? tokens.darkTokens : tokens.lightTokens}
        className="overflow-hidden rounded-lg border"
      >
        <WorkspaceMock />
      </PreviewFrame>
    </div>
  );
}

function ThemePreview({
  title,
  tokens,
  mode,
  onModeChange,
  description = "Preview of the accent tokens before they affect the live workspace.",
  actions,
}: {
  title: string;
  tokens: OrgThemeTokenSet;
  mode: ResolvedTheme;
  onModeChange: (mode: ResolvedTheme) => void;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction className="flex flex-wrap items-center justify-end gap-2">
          <PreviewModeToggle mode={mode} onModeChange={onModeChange} />
          {actions}
        </CardAction>
      </CardHeader>
      <CardContent>
        <ThemePreviewBody tokens={tokens} mode={mode} />
      </CardContent>
    </Card>
  );
}

/** What the entered colour ships as, beside the field. */
function AccentAdjustmentNote({ adjustment }: { adjustment: AccentAdjustment }) {
  const swatches = [
    ["Entered", adjustment.enteredHex],
    ["Light mode", adjustment.lightHex],
    ["Dark mode", adjustment.darkHex],
  ] as const;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {swatches.map(([label, hex]) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className="size-8 shrink-0 rounded-md border"
              style={{ backgroundColor: hex }}
            />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="font-mono text-xs">{hex}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {adjustment.adjusted
          ? `Ships as ${adjustment.lightHex} in light mode and ${adjustment.darkHex} in dark mode, tuned to the workspace so text on it stays readable (${ACCENT_MIN_CONTRAST}:1).`
          : `Ships as entered in light mode. Dark mode uses ${adjustment.darkHex}, so text on it stays readable (${ACCENT_MIN_CONTRAST}:1).`}
      </p>
    </div>
  );
}

export default function AdminAppearancePage() {
  const { organization } = useOrganization();
  const { resolvedTheme } = useTheme();
  const theme = useQuery(api.orgThemes.getThemeAdminState);
  const startThemeGeneration = useMutation(api.orgThemes.startThemeGeneration);
  const saveGeneratedCandidate = useMutation(api.orgThemes.saveGeneratedCandidate);
  const saveManualCandidate = useMutation(api.orgThemes.saveManualCandidate);
  const approveCandidateTheme = useMutation(api.orgThemes.approveCandidateTheme);
  const rejectCandidateTheme = useMutation(api.orgThemes.rejectCandidateTheme);
  const markThemeGenerationFailed = useMutation(api.orgThemes.markThemeGenerationFailed);
  const resetToNeutral = useMutation(api.orgThemes.resetToNeutral);
  const restorePreviousTheme = useMutation(api.orgThemes.restorePreviousTheme);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [isEditingAccent, setIsEditingAccent] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [accentHex, setAccentHex] = useState(DEFAULT_ACCENT_HEX);
  const accentFieldId = useId();
  const accentHexId = `${accentFieldId}-hex`;
  const accentHexErrorId = `${accentFieldId}-hex-error`;
  // Every preview follows one switch, starting from the admin's own mode, so
  // the candidate and the active theme compare in the same mode.
  const [chosenPreviewMode, setPreviewMode] = useState<ResolvedTheme | null>(null);
  const previewMode = chosenPreviewMode ?? resolvedTheme;

  const logoUrl = getSafeHttpsUrl(
    organization?.hasImage ? organization.imageUrl : null,
  );
  const activeTokens = tokenSet(
    theme?.activeLightTokens ?? theme?.lightTokens,
    theme?.activeDarkTokens ?? theme?.darkTokens,
  );
  const candidateTokens = tokenSet(
    theme?.candidateLightTokens,
    theme?.candidateDarkTokens,
  );
  const hasCandidate = Boolean(candidateTokens);
  const hasPreviousTheme = Boolean(
    theme?.previousLightTokens && theme.previousDarkTokens,
  );
  const selectedAccentRgb =
    theme?.activeAccentRgb ?? theme?.accentRgb ?? theme?.candidateAccentRgb ?? null;
  const initialAccentHex = rgbToHex(selectedAccentRgb) ?? DEFAULT_ACCENT_HEX;
  const manualAccentRgb = hexToRgb(accentHex);
  const colorInputValue = normalizeHex(accentHex) ?? initialAccentHex;

  // Computed in the browser with the server's own derivation, so the preview
  // follows every keystroke before anything is saved.
  const draft = useMemo(() => {
    const rgb = hexToRgb(accentHex);
    if (!rgb) return null;
    return {
      tokens: buildOrgThemeTokens(rgb),
      adjustment: describeAccentAdjustment(rgb),
    };
  }, [accentHex]);

  const statusLabel = useMemo(() => {
    switch (theme?.status) {
      case undefined:
        return "Neutral";
      case "extracting":
        return "Generating";
      case "pending":
        // Also the state after a reset or a rejection with nothing active.
        return theme.candidateLightTokens ? "Awaiting approval" : "Neutral";
      case "ready":
        return "Logo accent active";
      case "override":
        return "Custom accent active";
      case "failed":
        return "Generation failed";
    }
  }, [theme]);

  const handleGenerate = async () => {
    if (!logoUrl) {
      toast.error("Add an organization logo in Clerk before generating a theme.");
      return;
    }

    setBusyAction("generate");
    try {
      await startThemeGeneration({ sourceLogoUrl: logoUrl });
      const accentRgb = await extractLogoAccentRgb(logoUrl);
      await saveGeneratedCandidate({ sourceLogoUrl: logoUrl, accentRgb });
      toast.success("Generated a theme candidate from the organization logo.");
    } catch (error) {
      const reason = describeError(error, "Theme generation failed.");
      try {
        await markThemeGenerationFailed({ sourceLogoUrl: logoUrl, reason });
      } catch {
        // Preserve the original extraction error in the user-facing toast.
      }
      toast.error(reason);
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenAccentEditor = () => {
    setAccentHex(initialAccentHex);
    setIsEditingAccent(true);
  };

  const handleSaveManualCandidate = async () => {
    const accentRgb = hexToRgb(accentHex);
    if (!accentRgb) {
      toast.error("Enter a valid hex color.");
      return;
    }

    setBusyAction("manual");
    try {
      await saveManualCandidate({
        accentRgb,
        ...(logoUrl ? { sourceLogoUrl: logoUrl } : {}),
      });
      setIsEditingAccent(false);
      toast.success("Theme candidate saved from the selected accent color.");
    } catch (error) {
      toast.error(describeError(error, "Failed to save color."));
    } finally {
      setBusyAction(null);
    }
  };

  const handleApprove = async () => {
    setBusyAction("approve");
    try {
      await approveCandidateTheme({});
      toast.success("Theme approved and applied to the workspace.");
    } catch (error) {
      toast.error(describeError(error, "Failed to approve theme."));
    } finally {
      setBusyAction(null);
    }
  };

  const handleReject = async () => {
    setBusyAction("reject");
    try {
      await rejectCandidateTheme({});
      toast.success("Theme candidate rejected.");
    } catch (error) {
      toast.error(describeError(error, "Failed to reject theme."));
    } finally {
      setBusyAction(null);
    }
  };

  const handleReset = async () => {
    setBusyAction("reset");
    try {
      await resetToNeutral({});
      toast.success("Workspace theme reset to neutral.");
    } catch (error) {
      toast.error(describeError(error, "Failed to reset theme."));
    } finally {
      setBusyAction(null);
    }
  };

  const handleRestore = async () => {
    setBusyAction("restore");
    try {
      await restorePreviousTheme({});
      toast.success("Previous theme restored.");
    } catch (error) {
      toast.error(describeError(error, "Failed to restore the previous theme."));
      // Keeps the confirmation open.
      throw error;
    } finally {
      setBusyAction(null);
    }
  };

  const candidateTitle =
    theme?.candidateSource === "manual" ? "Manual candidate" : "Generated candidate";

  const previousThemeName = [
    theme?.previousSource === "manual" ? "the custom accent" : "the logo accent",
    rgbToHex(theme?.previousAccentRgb),
  ]
    .filter(Boolean)
    .join(" ");
  const previousApproved = theme?.previousApprovedAt
    ? `, approved ${formatDate(theme.previousApprovedAt)},`
    : "";
  const restoreDescription = [
    `This brings back ${previousThemeName}${previousApproved} in place of ${activeTokens ? "the current theme" : "the neutral default"}.`,
    activeTokens ? "Restoring again switches back." : null,
    candidateTokens ? "The candidate awaiting approval is discarded." : null,
  ]
    .filter(Boolean)
    .join(" ");

  const manualAccentEditor = isEditingAccent ? (
    <Card>
      <CardHeader>
        <CardTitle>Manual accent</CardTitle>
        <CardDescription>
          Save a color candidate, then approve it when the preview looks right.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          {/* A wrapping <label> only names its first control, which left the
              hex field unnamed. The visible label names the hex field; the
              swatch picker carries its own name. */}
          <div className="space-y-2">
            <label htmlFor={accentHexId} className="block text-sm font-medium">
              Accent color
            </label>
            <div className="flex gap-2">
              <Input
                type="color"
                value={colorInputValue}
                onChange={(event) => setAccentHex(event.target.value.toUpperCase())}
                aria-label="Accent color picker"
                className="h-9 w-12 shrink-0 cursor-pointer p-1"
              />
              <Input
                id={accentHexId}
                value={accentHex}
                onChange={(event) => setAccentHex(event.target.value)}
                placeholder={DEFAULT_ACCENT_HEX}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!manualAccentRgb}
                aria-describedby={manualAccentRgb ? undefined : accentHexErrorId}
                className="h-9 font-mono uppercase"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsEditingAccent(false)}
              disabled={busyAction !== null}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSaveManualCandidate}
              disabled={busyAction !== null || !manualAccentRgb}
            >
              <Save />
              {busyAction === "manual" ? "Saving" : "Save candidate"}
            </Button>
          </div>
        </div>
        {draft ? (
          <AccentAdjustmentNote adjustment={draft.adjustment} />
        ) : (
          <p id={accentHexErrorId} className="text-xs text-destructive">
            Enter a valid hex color.
          </p>
        )}
        {draft && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Live preview</p>
                <p className="text-xs text-muted-foreground">
                  Follows the field as you edit. The workspace changes only after you save and approve.
                </p>
              </div>
              <PreviewModeToggle mode={previewMode} onModeChange={setPreviewMode} />
            </div>
            <ThemePreviewBody tokens={draft.tokens} mode={previewMode} />
          </div>
        )}
      </CardContent>
    </Card>
  ) : null;

  if (theme === undefined) {
    return (
      <LoadingScreen fullScreen={false} message="Loading appearance settings..." />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Appearance</h2>
          <p className="text-sm text-muted-foreground">
            Generate and approve a restrained workspace accent from your organization logo.
          </p>
        </div>
        <Badge tone={statusTone(theme?.status)}>{statusLabel}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organization logo</CardTitle>
          <CardDescription>
            The logo is sampled only when an admin starts generation.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-lg border bg-background p-2">
              {logoUrl ? (
                <Image
                  src={logoUrl}
                  alt={organization?.name ? `${organization.name} logo` : "Organization logo"}
                  width={48}
                  height={48}
                  unoptimized
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <Palette className="size-5 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {organization?.name ?? "Workspace"}
              </p>
              <p className="text-xs text-muted-foreground">
                Last generated: {formatDate(theme?.candidateGeneratedAt ?? theme?.extractedAt)}
              </p>
              {theme?.lastExtractionError && (
                <p className="mt-1 text-xs text-destructive">
                  {theme.lastExtractionError}
                </p>
              )}
            </div>
          </div>
          <div className="space-y-1.5 sm:text-right">
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Button
                type="button"
                onClick={handleGenerate}
                disabled={!logoUrl || busyAction !== null}
              >
                <RefreshCw />
                {hasCandidate ? "Regenerate" : "Generate"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRestoreConfirmOpen(true)}
                disabled={busyAction !== null || !hasPreviousTheme}
              >
                <History />
                Restore previous
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setResetConfirmOpen(true)}
                disabled={busyAction !== null || (!activeTokens && !candidateTokens)}
              >
                <RotateCcw />
                Reset neutral
              </Button>
            </div>
            {!hasPreviousTheme && (
              <p className="text-xs text-muted-foreground">
                Restore previous turns on once an approved theme is replaced or reset.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {!logoUrl && (
        <EmptyState
          icon={Palette}
          title="No organization logo"
          description="Add a logo in Clerk before generating an org accent theme. Fabric will stay neutral until then."
        />
      )}

      {candidateTokens && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">{candidateTitle}</h3>
              <p className="text-xs text-muted-foreground">
                Approving this promotes the candidate to the live workspace accent.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={handleApprove}
                disabled={busyAction !== null}
              >
                <Check />
                Approve
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleReject}
                disabled={busyAction !== null}
              >
                <X />
                Reject
              </Button>
            </div>
          </div>
          <ThemePreview
            title="Candidate preview"
            tokens={candidateTokens}
            mode={previewMode}
            onModeChange={setPreviewMode}
          />
        </div>
      )}

      {activeTokens ? (
        <div className="space-y-3">
          <ThemePreview
            title="Active workspace theme"
            description="Approved accent tokens currently applied to the workspace."
            tokens={activeTokens}
            mode={previewMode}
            onModeChange={setPreviewMode}
            actions={(
              <Button
                type="button"
                variant="outline"
                onClick={handleOpenAccentEditor}
                disabled={busyAction !== null}
              >
                <Pencil />
                Edit accent
              </Button>
            )}
          />
          {manualAccentEditor}
        </div>
      ) : (
        <div className="space-y-3">
          <EmptyState
            icon={Palette}
            title="Neutral theme active"
            description="No approved org accent is active yet. Generate and approve a candidate to apply one."
            action={(
              <Button
                type="button"
                variant="outline"
                onClick={handleOpenAccentEditor}
                disabled={busyAction !== null}
              >
                <Pencil />
                Choose accent
              </Button>
            )}
          />
          {manualAccentEditor}
        </div>
      )}
      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title="Reset workspace theme?"
        description={`This removes the active and candidate accent theme and returns the workspace to the neutral default.${activeTokens ? " Restore previous can bring the active theme back." : ""}`}
        confirmLabel="Reset theme"
        destructive
        onConfirm={handleReset}
      />
      <ConfirmDialog
        open={restoreConfirmOpen}
        onOpenChange={setRestoreConfirmOpen}
        title="Restore previous theme?"
        description={restoreDescription}
        confirmLabel="Restore theme"
        onConfirm={handleRestore}
      />
    </div>
  );
}

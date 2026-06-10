"use client";

import type { CSSProperties, ReactNode } from "react";
import { useMemo, useState } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { Check, Palette, Pencil, RefreshCw, RotateCcw, Save, X } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { api } from "../../../../../convex/_generated/api";
import { extractLogoAccentRgb } from "@/features/theming/logo-theme";
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

type ThemeTokens = {
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

type Rgb = {
  r: number;
  g: number;
  b: number;
};

const DEFAULT_ACCENT_HEX = "#2563D2";

function rgbChannelToHex(channel: number) {
  return Math.round(Math.min(255, Math.max(0, channel)))
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
}

function rgbToHex(rgb?: Rgb | null) {
  if (!rgb) return null;
  return `#${rgbChannelToHex(rgb.r)}${rgbChannelToHex(rgb.g)}${rgbChannelToHex(rgb.b)}`;
}

function normalizeHex(value: string) {
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

function hexToRgb(value: string): Rgb | null {
  const normalized = normalizeHex(value);
  if (!normalized) return null;

  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
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

function statusVariant(
  status?: "pending" | "extracting" | "ready" | "failed" | "override",
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "ready" || status === "override") return "default";
  if (status === "failed") return "destructive";
  if (status === "extracting") return "secondary";
  return "outline";
}

function TokenSwatches({ tokens }: { tokens: ThemeTokens }) {
  const swatches = [
    ["Accent", tokens.accent],
    ["Subtle", tokens.subtle],
    ["Selected", tokens.selected],
    ["Border", tokens.border],
    ["Ring", tokens.ring],
  ] as const;

  return (
    <div className="grid gap-2 sm:grid-cols-5">
      {swatches.map(([label, color]) => (
        <div key={label} className="space-y-1">
          <div
            className="h-10 rounded-lg border"
            style={{ backgroundColor: color }}
          />
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      ))}
    </div>
  );
}

function ThemePreview({
  title,
  tokens,
  description = "Preview of the accent tokens before they affect the live workspace.",
  actions,
}: {
  title: string;
  tokens: ThemeTokens;
  description?: string;
  actions?: ReactNode;
}) {
  const chartColors = [
    tokens.chart1,
    tokens.chart2,
    tokens.chart3,
    tokens.chart4,
    tokens.chart5,
  ];
  const selectedStyle = {
    backgroundColor: tokens.selected,
    borderColor: tokens.border,
    color: tokens.selectedForeground,
  } satisfies CSSProperties;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        {actions && <CardAction>{actions}</CardAction>}
      </CardHeader>
      <CardContent className="space-y-4">
        <TokenSwatches tokens={tokens} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 rounded-lg border p-3">
            <Button
              type="button"
              style={{
                backgroundColor: tokens.accent,
                color: tokens.accentForeground,
              }}
            >
              Primary action
            </Button>
            <div className="rounded-lg border px-3 py-2" style={selectedStyle}>
              Selected workspace row
            </div>
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex gap-1.5">
              {chartColors.map((color, index) => (
                <div
                  key={color}
                  className="h-12 flex-1 rounded-md"
                  style={{ backgroundColor: color }}
                  title={`Chart ${index + 1}`}
                />
              ))}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full w-2/3 rounded-full"
                style={{ backgroundColor: tokens.accent }}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminAppearancePage() {
  const { organization } = useOrganization();
  const theme = useQuery(api.orgThemes.getThemeAdminState);
  const startThemeGeneration = useMutation(api.orgThemes.startThemeGeneration);
  const saveGeneratedCandidate = useMutation(api.orgThemes.saveGeneratedCandidate);
  const saveManualCandidate = useMutation(api.orgThemes.saveManualCandidate);
  const approveCandidateTheme = useMutation(api.orgThemes.approveCandidateTheme);
  const rejectCandidateTheme = useMutation(api.orgThemes.rejectCandidateTheme);
  const markThemeGenerationFailed = useMutation(api.orgThemes.markThemeGenerationFailed);
  const resetToNeutral = useMutation(api.orgThemes.resetToNeutral);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [isEditingAccent, setIsEditingAccent] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [accentHex, setAccentHex] = useState(DEFAULT_ACCENT_HEX);

  const logoUrl = getSafeHttpsUrl(
    organization?.hasImage ? organization.imageUrl : null,
  );
  const activeTokens = theme?.activeLightTokens ?? theme?.lightTokens ?? null;
  const candidateTokens = theme?.candidateLightTokens ?? null;
  const hasCandidate = Boolean(candidateTokens);
  const selectedAccentRgb =
    theme?.activeAccentRgb ?? theme?.accentRgb ?? theme?.candidateAccentRgb ?? null;
  const initialAccentHex = rgbToHex(selectedAccentRgb) ?? DEFAULT_ACCENT_HEX;
  const manualAccentRgb = hexToRgb(accentHex);
  const colorInputValue = normalizeHex(accentHex) ?? initialAccentHex;

  const statusLabel = useMemo(() => {
    if (!theme) return "neutral";
    return theme.status;
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
      const reason =
        error instanceof Error ? error.message : "Theme generation failed.";
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
      toast.error(error instanceof Error ? error.message : "Failed to save color.");
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
      toast.error(error instanceof Error ? error.message : "Failed to approve theme.");
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
      toast.error(error instanceof Error ? error.message : "Failed to reject theme.");
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
      toast.error(error instanceof Error ? error.message : "Failed to reset theme.");
    } finally {
      setBusyAction(null);
    }
  };

  const candidateTitle =
    theme?.candidateSource === "manual" ? "Manual candidate" : "Generated candidate";

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
          <label className="space-y-2">
            <span className="text-sm font-medium">Accent color</span>
            <div className="flex gap-2">
              <Input
                type="color"
                value={colorInputValue}
                onChange={(event) => setAccentHex(event.target.value.toUpperCase())}
                aria-label="Accent color"
                className="h-9 w-12 shrink-0 cursor-pointer p-1"
              />
              <Input
                value={accentHex}
                onChange={(event) => setAccentHex(event.target.value)}
                placeholder={DEFAULT_ACCENT_HEX}
                aria-invalid={!manualAccentRgb}
                className="h-9 font-mono uppercase"
              />
            </div>
          </label>
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
        {!manualAccentRgb && (
          <p className="text-xs text-destructive">Enter a valid hex color.</p>
        )}
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <div
            className="size-10 shrink-0 rounded-md border"
            style={{ backgroundColor: colorInputValue }}
          />
          <div className="min-w-0">
            <p className="text-sm font-medium">Candidate accent</p>
            <p className="font-mono text-xs text-muted-foreground">
              {manualAccentRgb ? colorInputValue : "Invalid color"}
            </p>
          </div>
        </div>
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
        <Badge variant={statusVariant(theme?.status)} className="capitalize">
          {statusLabel}
        </Badge>
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
          <div className="flex flex-wrap gap-2">
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
              onClick={() => setResetConfirmOpen(true)}
              disabled={busyAction !== null || (!activeTokens && !candidateTokens)}
            >
              <RotateCcw />
              Reset neutral
            </Button>
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
          <ThemePreview title="Candidate preview" tokens={candidateTokens} />
        </div>
      )}

      {activeTokens ? (
        <div className="space-y-3">
          <ThemePreview
            title="Active workspace theme"
            description="Approved accent tokens currently applied to the workspace."
            tokens={activeTokens}
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
        description="This removes the active and candidate accent theme and returns the workspace to the neutral default."
        confirmLabel="Reset theme"
        destructive
        onConfirm={handleReset}
      />
    </div>
  );
}

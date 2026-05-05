"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { Check, Palette, RefreshCw, RotateCcw, X } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { api } from "../../../../../convex/_generated/api";
import { extractLogoAccentRgb } from "@/lib/logo-theme";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingScreen } from "@/components/ui/loading-screen";

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

function ThemePreview({ title, tokens }: { title: string; tokens: ThemeTokens }) {
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
        <CardDescription>
          Preview of the accent tokens before they affect the live workspace.
        </CardDescription>
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
  const approveCandidateTheme = useMutation(api.orgThemes.approveCandidateTheme);
  const rejectCandidateTheme = useMutation(api.orgThemes.rejectCandidateTheme);
  const markThemeGenerationFailed = useMutation(api.orgThemes.markThemeGenerationFailed);
  const resetToNeutral = useMutation(api.orgThemes.resetToNeutral);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const logoUrl = getSafeHttpsUrl(
    organization?.hasImage ? organization.imageUrl : null,
  );
  const activeTokens = theme?.activeLightTokens ?? theme?.lightTokens ?? null;
  const candidateTokens = theme?.candidateLightTokens ?? null;
  const hasCandidate = Boolean(candidateTokens);

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
              onClick={handleReset}
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
              <h3 className="text-sm font-semibold">Generated candidate</h3>
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
        <ThemePreview title="Active workspace theme" tokens={activeTokens} />
      ) : (
        <EmptyState
          icon={Palette}
          title="Neutral theme active"
          description="No approved org accent is active yet. Generate and approve a candidate to apply one."
        />
      )}
    </div>
  );
}
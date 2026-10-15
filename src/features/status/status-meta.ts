import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  Tag,
  type LucideIcon,
} from "lucide-react";
import type { Doc } from "../../../convex/_generated/dataModel";
import type { PendingWorkStatus } from "../../../convex/readModelHelpers";
import {
  OVERVIEW_STATE_META,
  type OverviewState,
} from "@/features/overview/overview-view-model";

/**
 * What each colour means, wherever a status or score shows:
 * - success: finished and healthy.
 * - warning: waiting on a person, e.g. speaker labels to confirm.
 * - info: worth knowing, nothing to do. Includes work the system is still
 *   doing, which resolves without anyone acting.
 * - destructive: failed.
 * - neutral: nothing to report, or not started.
 */
export type StatusTone =
  | "success"
  | "warning"
  | "info"
  | "destructive"
  | "neutral";

export type StatusMeta = {
  label: string;
  tone: StatusTone;
  icon: LucideIcon;
  /** Work in progress: the icon spins. */
  busy?: boolean;
};

export type ConversationStatus = Doc<"conversations">["status"];

export const conversationStatusMeta: Record<ConversationStatus, StatusMeta> = {
  done: { label: "Completed", tone: "success", icon: CheckCircle2 },
  processing: { label: "Processing", tone: "info", icon: Loader2, busy: true },
  needs_speaker_labels: { label: "Needs labels", tone: "warning", icon: Tag },
  failed: { label: "Failed", tone: "destructive", icon: AlertCircle },
};

/** A process takes its most urgent contribution's status, so it reuses the
 * contribution entries rather than restating them. */
export const processPendingStatusMeta: Record<PendingWorkStatus, StatusMeta> = {
  needs_labels: conversationStatusMeta.needs_speaker_labels,
  failed: conversationStatusMeta.failed,
  processing: conversationStatusMeta.processing,
  current: { label: "Up to date", tone: "success", icon: CheckCircle2 },
};

/** A function, department or process overview. Labels come from the overview
 * view model, which also holds each state's explanation. */
export const overviewStateMeta: Record<OverviewState, StatusMeta> = {
  missing: {
    label: OVERVIEW_STATE_META.missing.label,
    tone: "neutral",
    icon: CircleDashed,
  },
  current: {
    label: OVERVIEW_STATE_META.current.label,
    tone: "success",
    icon: CheckCircle2,
  },
  stale: {
    label: OVERVIEW_STATE_META.stale.label,
    tone: "warning",
    icon: AlertTriangle,
  },
  refreshing: {
    label: OVERVIEW_STATE_META.refreshing.label,
    tone: "info",
    icon: Loader2,
    busy: true,
  },
  partial: {
    label: OVERVIEW_STATE_META.partial.label,
    tone: "warning",
    icon: AlertTriangle,
  },
  // The same icon as a failed contribution, and a different shape from the
  // warning states beside it.
  failed: {
    label: OVERVIEW_STATE_META.failed.label,
    tone: "destructive",
    icon: AlertCircle,
  },
};

/** The status a process row in a list or tree should flag, or null when it's
 * up to date. */
export function processRowStatus(
  pendingWorkStatus: PendingWorkStatus,
): StatusMeta | null {
  return pendingWorkStatus === "current"
    ? null
    : processPendingStatusMeta[pendingWorkStatus];
}

/** The overview state a function or department row should flag: only the ones
 * waiting on a person. A refresh in flight resolves itself, and partial
 * coverage is a note for the overview page, not the tree. */
export function overviewRowStatus(state: OverviewState): StatusMeta | null {
  return state === "stale" || state === "failed"
    ? overviewStateMeta[state]
    : null;
}

/** For a status shown as coloured text or an icon, outside a badge. */
export const STATUS_TONE_TEXT: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  info: "text-info",
  destructive: "text-destructive",
  neutral: "text-muted-foreground",
};

/** A bordered tint for a callout or a highlighted row. Text inside stays
 * foreground-coloured; give the icon or title `STATUS_TONE_TEXT`. */
export const STATUS_TONE_SURFACE: Record<StatusTone, string> = {
  success: "border-success-border bg-success-subtle",
  warning: "border-warning-border bg-warning-subtle",
  info: "border-info-border bg-info-subtle",
  destructive: "border-destructive-border bg-destructive-subtle",
  neutral: "border-border bg-muted/40",
};

/** Tint plus tone text, for hand-built chips that can't use `Badge`. */
export const STATUS_TONE_CHIP: Record<StatusTone, string> = {
  success: "border-success-border bg-success-subtle text-success",
  warning: "border-warning-border bg-warning-subtle text-warning",
  info: "border-info-border bg-info-subtle text-info",
  destructive: "border-destructive-border bg-destructive-subtle text-destructive",
  neutral: "border-border bg-muted/40 text-muted-foreground",
};

export type AutomationPotential = "high" | "medium" | "low" | "none";
export type ConfidenceLevel = "high" | "medium" | "low";

/** More potential is better, and less is simply less, never a problem. */
export const automationPotentialTone: Record<AutomationPotential, StatusTone> = {
  high: "success",
  medium: "info",
  low: "neutral",
  none: "neutral",
};

/** Only low confidence asks for attention: someone should check it. */
export const confidenceTone: Record<ConfidenceLevel, StatusTone> = {
  high: "success",
  medium: "neutral",
  low: "warning",
};

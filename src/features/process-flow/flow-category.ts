import { ArrowRightLeft, Clock, GitBranch, Play, Square, Zap } from "lucide-react";

/**
 * How each kind of flow step looks: colour, icon, label. Shared by the flow
 * canvas, its step panel and AskFabric's flow snippet; kept apart from the
 * canvas nodes so the snippet doesn't load React Flow. These hues name a kind
 * of step, not a status, so they stay on the raw palette rather than the
 * status tones.
 */
export const CATEGORY_CONFIG = {
  start: {
    color: "border-l-emerald-500",
    iconBg: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    badgeClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    Icon: Play,
    label: "Start",
  },
  end: {
    color: "border-l-slate-500",
    iconBg: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
    badgeClass: "bg-slate-500/10 text-slate-700 dark:text-slate-400",
    Icon: Square,
    label: "End",
  },
  action: {
    color: "border-l-blue-500",
    iconBg: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    badgeClass: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    Icon: Zap,
    label: "Action",
  },
  decision: {
    color: "border-l-amber-500",
    // -700: amber-600 is under 3:1 on its own tint.
    iconBg: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    badgeClass: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    Icon: GitBranch,
    label: "Decision",
  },
  handoff: {
    color: "border-l-violet-500",
    iconBg: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    badgeClass: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
    Icon: ArrowRightLeft,
    label: "Handoff",
  },
  wait: {
    color: "border-l-orange-500",
    iconBg: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    badgeClass: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
    Icon: Clock,
    label: "Wait",
  },
} as const;

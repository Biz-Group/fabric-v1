import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Reaps flow generations whose heartbeat has gone stale. The staged pipeline
// hands off between scheduled actions, so an action killed between writing a
// batch and scheduling the next one leaves pending work with nothing to pick it
// up — invisible to any try/catch. Runs every 5 minutes against a 10-minute
// staleness window, so a wedged generation resolves within ~15 minutes rather
// than sitting in "generating" forever.
crons.interval(
  "reap stuck process flow generations",
  { minutes: 5 },
  internal.processFlows.reapStuckFlowGenerations,
  {},
);

// Recommendation runs hand off between a mutation and a scheduled action, so a
// killed action leaves a run "running" with nothing behind it. Failing it
// makes the tab's retry reachable.
crons.interval(
  "reap stuck recommendation runs",
  { minutes: 5 },
  internal.recommendations.reapStuckRecommendationRuns,
  {},
);

crons.interval(
  "reap stuck process summary generations",
  { minutes: 5 },
  internal.processSummaryV2.reapStuckProcessSummaryRuns,
  {},
);

crons.interval(
  "reap stuck hierarchy summary generations",
  { minutes: 5 },
  internal.hierarchySummaryV2.reapStuckHierarchySummaryRuns,
  {},
);

// AskFabric answers still streaming after 5 minutes are marked unfinished, so
// their thread unlocks (FR-2.11). The turn deadline is 4 minutes, so only a
// killed action is ever caught here.
crons.interval(
  "mark unfinished AskFabric answers",
  { minutes: 5 },
  internal.ask.markStaleTurns,
  {},
);

// Shared AskFabric exchanges are kept 90 days (FR-7.4, D38).
crons.cron(
  "expire shared AskFabric exchanges",
  "15 2 * * *",
  internal.askFeedback.expireSharedExchanges,
  {},
);

// AskFabric starter prompts are rebuilt daily for orgs with recent visitors
// (FR-6.3); pipeline completions also trigger a debounced rebuild.
crons.cron(
  "rebuild AskFabric starter prompts",
  "45 2 * * *",
  internal.askSuggestions.recomputeActiveOrgs,
  {},
);

// Ships dev-deployment AI usage rows to the prod sink so the platform console
// can show one merged view. A no-op on the sink itself (USAGE_SINK_URL unset).
// Deliberately not inline with the AI call: a cross-deployment request on the
// pipeline's critical path is what the reliability plan exists to prevent.
crons.interval(
  "forward AI usage to the sink deployment",
  { minutes: 5 },
  internal.aiUsage.forwardPendingUsage,
  {},
);

// Workspace offboarding (docs/client-offboarding-plan.md): deletes the data of
// workspaces suspended 30 days ago (D2), and resumes a purge that stalled.
crons.interval(
  "purge workspaces closed 30 days ago",
  { hours: 1 },
  internal.workspacePurge.startDuePurges,
  {},
);
crons.interval(
  "resume stalled person erasures",
  { hours: 1 },
  internal.personErasure.resumeStalled,
  {},
);

// Folds yesterday's ledger into rollups so the console reads O(1) for history
// instead of scanning. Runs at 00:30 UTC — after the day closes, with enough
// margin that a straggling forward from dev still lands in the right day.
crons.daily(
  "fold yesterday's AI usage into rollups",
  { hourUTC: 0, minuteUTC: 30 },
  internal.aiUsage.foldUsageDay,
  {},
);

// Fabric MCP metering (Phase 3): folds yesterday's tool calls into one
// mcpUsageDays row per workspace, then trims raw calls past retention, skipping
// any day the fold hasn't covered.
crons.daily(
  "fold yesterday's MCP calls into daily usage",
  { hourUTC: 0, minuteUTC: 40 },
  internal.mcpUsage.foldDay,
  {},
);
crons.daily(
  "prune MCP calls past retention",
  { hourUTC: 3, minuteUTC: 10 },
  internal.mcpUsage.pruneOldCalls,
  {},
);

// Trims raw ledger rows past the retention window. Skips any day that has not
// been rolled up, so a stalled fold shows up as a growing table rather than
// permanent data loss.
crons.daily(
  "prune AI usage rows past retention",
  { hourUTC: 3, minuteUTC: 0 },
  internal.aiUsage.pruneOldUsageEvents,
  {},
);

export default crons;

import { v, type Infer } from "convex/values";

/**
 * Validators for the AskFabric tables (PRD §4.5, FR-2, FR-3, FR-5, FR-7, FR-8).
 *
 * Thread content (question, answer, reasoning summaries, tool labels, cited
 * text) is author-only (D12). Telemetry and quality fields are read by admin
 * views, so they hold only numbers, booleans and literal unions: no field
 * outside the content fields can carry tenant text (FR-8.2).
 */

/** Tool names in registry order (FR-1, T1–T17). */
export const ASK_TOOL_NAMES = [
  "searchHierarchy",
  "browseHierarchy",
  "getOverview",
  "getProcessFlow",
  "listConversations",
  "getConversationEvidence",
  "getTranscript",
  "getCoverage",
  "whatsNew",
  "getFlowNode",
  "findHandoffs",
  "findProcessesUsing",
  "searchConversations",
  "getParticipation",
  "searchFabricHelp",
  "rankSignals",
  "listSystems",
  "findSimilarWork",
] as const;

export type AskToolName = (typeof ASK_TOOL_NAMES)[number];

export const askToolNameValidator = v.union(
  ...ASK_TOOL_NAMES.map((name) => v.literal(name)),
);

export const askThreadStatusValidator = v.union(
  v.literal("active"),
  v.literal("archived"),
  // Hidden from every read while a scheduled batch deletes it (FR-3.4).
  v.literal("deleting"),
);

/** A client-sent reference to an entity, never its content (FR-4.2). */
export const askEntityRefValidator = v.union(
  v.object({ kind: v.literal("function"), id: v.id("functions") }),
  v.object({ kind: v.literal("department"), id: v.id("departments") }),
  v.object({ kind: v.literal("process"), id: v.id("processes") }),
);

export const askMessageStatusValidator = v.union(
  v.literal("streaming"),
  v.literal("complete"),
  v.literal("stopped"),
  v.literal("error"),
);

/** FR-2.9 failures, plus the watchdog's (FR-2.11). The UI maps each to copy. */
export const askErrorReasonValidator = v.union(
  v.literal("modelError"),
  v.literal("busy"),
  v.literal("refusal"),
  v.literal("truncated"),
  v.literal("accessLost"),
  v.literal("deadline"),
  v.literal("unfinished"),
);

/**
 * Ordered message parts (FR-2.3). Reasoning parts hold summarized thinking
 * only; raw thinking blocks and signatures never leave the running action.
 */
export const askMessagePartValidator = v.union(
  v.object({
    type: v.literal("text"),
    text: v.string(),
  }),
  v.object({
    type: v.literal("reasoning"),
    text: v.string(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  }),
  v.object({
    type: v.literal("tool"),
    name: askToolNameValidator,
    status: v.union(v.literal("running"), v.literal("done"), v.literal("failed")),
    // Names the entity or query ("Searching 23 contributions for …"), so it is
    // thread content, not telemetry.
    label: v.string(),
    resultCount: v.optional(v.number()),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  }),
);

export type AskMessagePart = Infer<typeof askMessagePartValidator>;

/** Per tool call (FR-8.2). Content-free by construction. */
export const askToolTelemetryValidator = v.object({
  name: askToolNameValidator,
  latencyMs: v.number(),
  found: v.boolean(),
  resultTokens: v.number(),
  truncated: v.boolean(),
});

/** Per turn (FR-8.5). Content-free by construction. */
export const askTurnQualityValidator = v.object({
  modelCalls: v.number(),
  toolCalls: v.number(),
  citations: v.number(),
  zeroCitations: v.boolean(),
  durationMs: v.number(),
  firstVisibleMs: v.optional(v.number()),
  stopReason: v.union(
    v.literal("end_turn"),
    v.literal("max_tokens"),
    v.literal("refusal"),
    v.literal("stepCap"),
    v.literal("stopped"),
    v.literal("error"),
  ),
});

/** Summed over the turn's model calls; the per-call rows are in aiUsageEvents. */
export const askTurnUsageValidator = v.object({
  inputTokens: v.number(),
  outputTokens: v.number(),
  cachedReadTokens: v.number(),
  cacheWriteTokens: v.number(),
});

/**
 * The entity a citation depends on, for re-authorization on load (FR-5.5) and
 * for clearing cited text when the entity is deleted (FR-9.7).
 */
export const askSourceKindValidator = v.union(
  v.literal("function"),
  v.literal("department"),
  v.literal("process"),
  v.literal("conversation"),
  v.literal("org"),
  v.literal("help"),
);

export const askSuggestionCategoryValidator = v.union(
  v.literal("orgWide"),
  v.literal("entitySignal"),
  v.literal("department"),
  v.literal("whatsNew"),
  v.literal("help"),
);

/** What a starter prompt is about, for its card's label. */
export const askSuggestionTopicValidator = v.union(
  v.literal("friction"),
  v.literal("biggestMoves"),
  v.literal("systems"),
  v.literal("duplication"),
  v.literal("bottlenecks"),
  v.literal("handoffs"),
  v.literal("keyPersonRisk"),
  v.literal("gaps"),
  v.literal("whatsNew"),
  v.literal("coverage"),
  v.literal("usingFabric"),
);

/** Tool-call metadata in a shared exchange: no raw results (FR-7.2). */
export const askSharedToolCallValidator = v.object({
  name: askToolNameValidator,
  input: v.string(),
  found: v.boolean(),
  resultTokens: v.number(),
});

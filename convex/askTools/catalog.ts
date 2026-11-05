import { assertWithinStrictLimits, defineTool, type RegisteredAskTool } from "./registry";
import {
  browseHierarchy,
  browseHierarchyInput,
  searchHierarchy,
  searchHierarchyInput,
} from "./hierarchy";
import { getOverview, getOverviewInput, MAX_OVERVIEW_IDS } from "./overview";
import { getFlowNode, getFlowNodeInput, getProcessFlow, getProcessFlowInput } from "./flow";
import { getParticipation, getParticipationInput } from "./participation";
import {
  getConversationEvidence,
  getConversationEvidenceInput,
  getTranscript,
  getTranscriptInput,
  listConversations,
  listConversationsInput,
  searchConversations,
  searchConversationsInput,
} from "./conversations";
import { findHandoffs, findHandoffsInput, findProcessesUsing, findProcessesUsingInput } from "./graph";
import { searchFabricHelp, searchFabricHelpInput } from "./help";
import { rankSignals, rankSignalsInput, SIGNALS } from "./signals";
import { scopeInput } from "./scope";
import { findSimilarWork, listSystems } from "./systems";
import { getCoverage, getCoverageInput, whatsNew, whatsNewInput } from "./coverage";
import { DEFAULT_BUDGET_TOKENS, MAX_BUDGET_TOKENS } from "./results";
import { showEntities, showEntitiesInput } from "./display";
import { MAX_DISPLAY_REFS } from "../lib/askSchema";

/**
 * The AskFabric tools, in registry order (FR-1). The order is part of the
 * cached prompt prefix (FR-2.6), so append new tools rather than inserting.
 */

const cursorDescription =
  "\"\" for the first page; otherwise the cursor from the previous result.";

export const ASK_TOOLS: readonly RegisteredAskTool[] = [
  defineTool({
    name: "searchHierarchy",
    description:
      "Find functions, departments and processes by name. Returns each match's id, kind, path, overview state and contribution counts. Use it to turn a name the user mentions into an id for the other tools.",
    input: searchHierarchyInput,
    inputDescriptions: {
      query: "Words from the entity's name, e.g. \"accounts payable\".",
      kinds: "Limit to these kinds, or [] for all.",
      cursor: cursorDescription,
    },
    access: "member",
    executor: searchHierarchy,
    executorPath: "askTools/hierarchy:searchHierarchy",
    output: "Up to 25 entities: id, kind, path, overview state, counts.",
    citationSources: ["entity"],
    budgetTokens: DEFAULT_BUDGET_TOKENS,
    telemetryName: "searchHierarchy",
    label: (input) => `Searching the workspace for "${input.query}"`,
  }),
  defineTool({
    name: "browseHierarchy",
    description:
      "List the children of a node in the org structure: all functions (kind 'root'), a function's departments, or a department's processes with contribution counts, pending work, overview state and whether a process flow exists.",
    input: browseHierarchyInput,
    inputDescriptions: {
      kind: "\"function\" or \"department\" to open that node, or \"root\" for the list of functions.",
      id: "The id of the function or department to open; \"\" with kind \"root\".",
      cursor: cursorDescription,
    },
    access: "member",
    executor: browseHierarchy,
    executorPath: "askTools/hierarchy:browseHierarchy",
    output: "Up to 25 child entities with counts, pending work, overview state and flow availability.",
    citationSources: ["entity"],
    budgetTokens: DEFAULT_BUDGET_TOKENS,
    telemetryName: "browseHierarchy",
    label: (input) =>
      input.kind === "root"
        ? "Listing the organization's functions"
        : input.kind === "function"
          ? "Listing the departments in a function"
          : "Listing the processes in a department",
  }),
  defineTool({
    name: "getOverview",
    description: `Read the AI overviews of 1 to ${MAX_OVERVIEW_IDS} entities of one kind: headline, brief, freshness, coverage, pending contributions and findings with their evidence level. For organization-wide questions, read every function's overview in one call before ranking signals. With several ids, findings are shortened to title and evidence.`,
    input: getOverviewInput,
    inputDescriptions: {
      kind: "The kind of every id.",
      ids: `1 to ${MAX_OVERVIEW_IDS} entity ids of that kind.`,
      sections:
        "Finding sections to include, or [] for all. Process: scope, consensus, variations, gaps, notable. Department: crossProcessDependencies, sharedPatterns, variationsAndTensions, gaps, notable. Function: crossDepartmentDependencies, strategicPatterns, variationsAndTensions, gaps, notable.",
    },
    access: "member",
    executor: getOverview,
    executorPath: "askTools/overview:getOverview",
    output: "Per entity: an overview result, then finding results.",
    citationSources: ["overview", "finding"],
    budgetTokens: MAX_BUDGET_TOKENS,
    telemetryName: "getOverview",
    label: (input) =>
      input.ids.length === 1
        ? `Reading the ${input.kind} overview`
        : `Reading ${input.ids.length} ${input.kind} overviews`,
  }),
  defineTool({
    name: "getProcessFlow",
    description:
      "Read a process's flow: its key findings, automation opportunities, each step with actors, tools, pain points and flags, the edges between steps, and whether the flow is stale.",
    input: getProcessFlowInput,
    inputDescriptions: { processId: "The process id." },
    access: "member",
    executor: getProcessFlow,
    executorPath: "askTools/flow:getProcessFlow",
    output: "Key findings, automation opportunities and steps, plus status and edges.",
    citationSources: ["flowNode", "entity"],
    budgetTokens: MAX_BUDGET_TOKENS,
    telemetryName: "getProcessFlow",
    label: () => "Reading the process flow",
  }),
  defineTool({
    name: "listConversations",
    description:
      "List completed contributions (interviews, voice notes and uploaded files), newest first, in the whole organization or under one process, department or function. Shows title, contributor, type, recorded date and duration.",
    input: listConversationsInput,
    inputDescriptions: {
      processId: "Limit to this process, or \"\".",
      departmentId: "Limit to this department, or \"\".",
      functionId: "Limit to this function, or \"\".",
      since: "Only contributions recorded on or after this date (YYYY-MM-DD), or \"\".",
      cursor: cursorDescription,
    },
    access: "member",
    executor: listConversations,
    executorPath: "askTools/conversations:listConversations",
    output: "A citable count of completed contributions in scope, then up to 25 of them.",
    citationSources: ["conversation", "org", "entity"],
    budgetTokens: DEFAULT_BUDGET_TOKENS,
    telemetryName: "listConversations",
    label: (input) =>
      input.since ? `Listing contributions since ${input.since}` : "Listing completed contributions",
  }),
  defineTool({
    name: "getConversationEvidence",
    description:
      "Read what one completed contribution established: its summary, steps, friction points, handoffs, tools, actors, variations and open questions.",
    input: getConversationEvidenceInput,
    inputDescriptions: { conversationId: "The contribution id." },
    access: "member",
    executor: getConversationEvidence,
    executorPath: "askTools/conversations:getConversationEvidence",
    output: "The contribution's summary and extracted evidence.",
    citationSources: ["conversation"],
    budgetTokens: DEFAULT_BUDGET_TOKENS,
    telemetryName: "getConversationEvidence",
    label: () => "Reading a contribution's evidence",
  }),
  defineTool({
    name: "getTranscript",
    description:
      "Read transcript lines from one completed contribution, about 20 at a time: around a time, around a phrase, or from the start. Use full only when the user asks about the whole contribution; for a specific point, pass query or atSeconds.",
    input: getTranscriptInput,
    inputDescriptions: {
      conversationId: "The contribution id.",
      atSeconds: "Centre the window on this time in the recording, in seconds, or -1.",
      query: "Centre the window on the first line containing these words, or \"\".",
      full: "true to read the whole transcript (only when the user asks about the entire contribution); otherwise false.",
    },
    access: "member",
    executor: getTranscript,
    executorPath: "askTools/conversations:getTranscript",
    output: "Transcript lines, each with its line number, time and speaker.",
    citationSources: ["transcriptLine"],
    budgetTokens: DEFAULT_BUDGET_TOKENS,
    telemetryName: "getTranscript",
    label: (input) =>
      input.full
        ? "Reading the full transcript"
        : input.query
          ? `Searching a transcript for "${input.query}"`
          : "Reading a transcript",
  }),
  defineTool({
    name: "getCoverage",
    description:
      "How much of the organization (kind 'org') or of one entity has been interviewed: processes with and without completed contributions, unique contributors, pending contributions, and stale or missing overviews. Use it to state coverage on every organization-wide answer.",
    input: getCoverageInput,
    inputDescriptions: {
      kind: "The entity kind, or \"org\" for the whole organization.",
      id: "The entity id, or \"\" for the whole organization.",
    },
    access: "member",
    executor: getCoverage,
    executorPath: "askTools/coverage:getCoverage",
    output: "One coverage result for the scope.",
    citationSources: ["org", "entity"],
    budgetTokens: DEFAULT_BUDGET_TOKENS,
    telemetryName: "getCoverage",
    label: (input) =>
      input.kind === "org" ? "Checking coverage across the organization" : `Checking coverage of a ${input.kind}`,
  }),
  defineTool({
    name: "whatsNew",
    description:
      "What changed since a date: contributions recorded since then, and overviews and process flows regenerated since then, newest first. For the whole organization (kind 'org') or one entity.",
    input: whatsNewInput,
    inputDescriptions: {
      since: "The date to look from, YYYY-MM-DD.",
      kind: "The entity kind, or \"org\" for the whole organization.",
      id: "The entity id, or \"\" for the whole organization.",
      cursor: cursorDescription,
    },
    access: "member",
    executor: whatsNew,
    executorPath: "askTools/coverage:whatsNew",
    output: "Up to 25 changes, newest first.",
    citationSources: ["conversation", "overview", "entity"],
    budgetTokens: DEFAULT_BUDGET_TOKENS,
    telemetryName: "whatsNew",
    label: (input) => `Checking what's new since ${input.since}`,
  }),
  defineTool({
    name: "findHandoffs",
    description:
      "Find where work is handed to or from a party (a team, role or department, e.g. \"Finance\") across every process: flow steps where the work changes hands, and handoffs described in contributions.",
    input: findHandoffsInput,
    inputDescriptions: { party: "The team, role or department name, as people say it." },
    access: "member",
    executor: findHandoffs,
    executorPath: "askTools/graph:findHandoffs",
    output: "Processes with matching handoffs, each citing the steps or contributions.",
    citationSources: ["flowNode", "conversation", "org"],
    budgetTokens: MAX_BUDGET_TOKENS,
    telemetryName: "findHandoffs",
    label: (input) => `Finding handoffs involving ${input.party}`,
  }),
  defineTool({
    name: "findProcessesUsing",
    description:
      "Find processes and steps that use a tool or system, involve an actor or role, or both, across every process. For a ranked view of systems and their friction, use listSystems instead.",
    input: findProcessesUsingInput,
    inputDescriptions: {
      tool: "The tool or system name, or \"\".",
      actor: "The actor or role, or \"\". At least one of tool and actor is required.",
    },
    access: "member",
    executor: findProcessesUsing,
    executorPath: "askTools/graph:findProcessesUsing",
    output: "Processes with matching steps or contributions.",
    citationSources: ["flowNode", "conversation", "org"],
    budgetTokens: MAX_BUDGET_TOKENS,
    telemetryName: "findProcessesUsing",
    label: (input) =>
      `Finding processes that involve ${[input.tool, input.actor].filter(Boolean).join(" and ") || "a tool"}`,
  }),
  defineTool({
    name: "searchConversations",
    description:
      "Search completed contributions by title, contributor name or summary. Does not search transcript text; for what was said at a point in one contribution, use getTranscript with a query.",
    input: searchConversationsInput,
    inputDescriptions: {
      query: "Words to find in titles, contributor names or summaries.",
      processId: "Limit to this process, or \"\".",
      since: "Only contributions recorded on or after this date (YYYY-MM-DD), or \"\".",
      cursor: cursorDescription,
    },
    access: "member",
    executor: searchConversations,
    executorPath: "askTools/conversations:searchConversations",
    output: "Up to 25 matching completed contributions.",
    citationSources: ["conversation"],
    budgetTokens: DEFAULT_BUDGET_TOKENS,
    telemetryName: "searchConversations",
    label: (input) => `Searching contributions for "${input.query}"`,
  }),
  defineTool({
    name: "searchFabricHelp",
    description:
      "Search Fabric's product help: how to contribute, roles, reading overviews and flows, reports, admin tasks. Use it for any question about how Fabric works rather than about this organization's data.",
    input: searchFabricHelpInput,
    inputDescriptions: { query: "What the user wants to know how to do or understand." },
    access: "member",
    executor: searchFabricHelp,
    executorPath: "askTools/help:searchFabricHelp",
    output: "Up to 3 help articles written for the user's role.",
    citationSources: ["help"],
    budgetTokens: DEFAULT_BUDGET_TOKENS,
    telemetryName: "searchFabricHelp",
    label: (input) => `Searching Fabric help for "${input.query}"`,
  }),
  defineTool({
    name: "rankSignals",
    description: `Rank signals across every process in scope in one call, grouped by signal: ${SIGNALS.join(", ")}. Each item shows its score (3 × processes affected + 2 × distinct contributors + evidence weight) and where it occurs. manualRework is a keyword heuristic. For organization-wide questions, read the function overviews first.`,
    input: rankSignalsInput,
    inputDescriptions: {
      signals: "1 to 7 signals to rank.",
      kind: "Limit to this entity kind, or \"org\" for the whole organization.",
      id: "The entity id, or \"\" for the whole organization.",
      limit: "Items per signal, at most 25; 0 for the default of 8.",
    },
    access: "member",
    executor: rankSignals,
    executorPath: "askTools/signals:rankSignals",
    output: "Ranked items per signal, each with its score inputs and up to 5 sources.",
    citationSources: ["flowNode", "conversation", "finding", "entity", "org"],
    budgetTokens: MAX_BUDGET_TOKENS,
    telemetryName: "rankSignals",
    label: (input) =>
      `Ranking ${input.signals.join(", ")} across ${input.kind === "org" ? "the organization" : `a ${input.kind}`}`,
  }),
  defineTool({
    name: "listSystems",
    description:
      "List the systems and tools mentioned across the organization or one entity, ranked by evidenced friction: the processes and steps using each, mentions, pain points, manual re-keying and automation potential. Report evidence only; never recommend vendors or products.",
    input: scopeInput,
    inputDescriptions: {
      kind: "Limit to this entity kind, or \"org\" for the whole organization.",
      id: "The entity id, or \"\" for the whole organization.",
    },
    access: "member",
    executor: listSystems,
    executorPath: "askTools/systems:listSystems",
    output: "Up to 25 systems with usage and friction, each citing where it is used.",
    citationSources: ["flowNode", "conversation"],
    budgetTokens: MAX_BUDGET_TOKENS,
    telemetryName: "listSystems",
    label: (input) =>
      `Listing the systems used across ${input.kind === "org" ? "the organization" : `a ${input.kind}`}`,
  }),
  defineTool({
    name: "findSimilarWork",
    description:
      "Find possible duplication across processes: the same system on a similar step, the same handoff, or the same friction reported in several processes. Results are candidates to confirm, not conclusions; work described in different words is not detected.",
    input: scopeInput,
    inputDescriptions: {
      kind: "Limit to this entity kind, or \"org\" for the whole organization.",
      id: "The entity id, or \"\" for the whole organization.",
    },
    access: "member",
    executor: findSimilarWork,
    executorPath: "askTools/systems:findSimilarWork",
    output: "Up to 25 duplication candidates, each citing where it occurs.",
    citationSources: ["flowNode", "conversation", "entity", "org"],
    budgetTokens: MAX_BUDGET_TOKENS,
    telemetryName: "findSimilarWork",
    label: (input) =>
      `Looking for duplicated work across ${input.kind === "org" ? "the organization" : `a ${input.kind}`}`,
  }),
  defineTool({
    name: "getFlowNode",
    description:
      "Read one step of a process flow in full: its description, actors, tools, estimated duration, pain points, risks, flags, the contributions it came from, and the steps before and after it. Take the step id from getProcessFlow.",
    input: getFlowNodeInput,
    inputDescriptions: {
      processId: "The process id.",
      nodeId: "The step id, as getProcessFlow lists it.",
    },
    access: "member",
    executor: getFlowNode,
    executorPath: "askTools/flow:getFlowNode",
    output: "The step in full, then its neighbouring steps.",
    citationSources: ["flowNode"],
    budgetTokens: DEFAULT_BUDGET_TOKENS,
    telemetryName: "getFlowNode",
    label: () => "Reading a step of the process flow",
  }),
  defineTool({
    name: "getParticipation",
    description:
      "Admins only: who has contributed in a scope (names with contribution counts per process) and which members haven't, for planning interviews. Other roles get not found; use getCoverage for counts instead. A factual list, never a judgement of anyone.",
    input: getParticipationInput,
    inputDescriptions: {
      kind: "Limit to this entity kind, or \"org\" for the whole organization.",
      id: "The entity id, or \"\" for the whole organization.",
    },
    access: "admin",
    executor: getParticipation,
    executorPath: "askTools/participation:getParticipation",
    output: "Contributors per process, processes with none, and members with no completed contribution.",
    citationSources: ["entity", "org"],
    budgetTokens: DEFAULT_BUDGET_TOKENS,
    telemetryName: "getParticipation",
    label: (input) =>
      `Checking who has contributed across ${input.kind === "org" ? "the organization" : `a ${input.kind}`}`,
  }),
  // Display tools (D56): appended, so the cached tool prefix only grows.
  defineTool({
    name: "showEntities",
    description:
      "Show cards under your answer for the functions, departments or processes it is about. Each card shows the entity's current name, path, overview headline and counts, and opens its page. Use it when the answer names 2 or more entities a tool returned. Write your full, cited answer first, then call this in the same response as its last step: your answer ends where you call it. The cards replace no part of the answer. Returns a short acknowledgement, not data; never cite it.",
    input: showEntitiesInput,
    inputDescriptions: {
      refs: `2 to ${MAX_DISPLAY_REFS} entities, most relevant first: each kind and id exactly as a tool returned them.`,
    },
    access: "member",
    executor: showEntities,
    executorPath: "askTools/display:showEntities",
    output: "An acknowledgement of what was shown.",
    citationSources: [],
    budgetTokens: 200,
    telemetryName: "showEntities",
    label: (input) => `Showing ${input.refs.length} card${input.refs.length === 1 ? "" : "s"}`,
    display: "entities",
  }),
];

// Fails at load, before any request, if the catalog outgrows strict tool use.
assertWithinStrictLimits(ASK_TOOLS);

export function getAskTool(name: string): RegisteredAskTool | undefined {
  return ASK_TOOLS.find((tool) => tool.name === name);
}

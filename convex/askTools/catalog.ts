import { defineTool, type RegisteredAskTool } from "./registry";
import {
  browseHierarchy,
  browseHierarchyInput,
  searchHierarchy,
  searchHierarchyInput,
} from "./hierarchy";
import { getOverview, getOverviewInput, MAX_OVERVIEW_IDS } from "./overview";
import { getProcessFlow, getProcessFlowInput } from "./flow";
import {
  getConversationEvidence,
  getConversationEvidenceInput,
  getTranscript,
  getTranscriptInput,
  listConversations,
  listConversationsInput,
} from "./conversations";
import { getCoverage, getCoverageInput, whatsNew, whatsNewInput } from "./coverage";
import { DEFAULT_BUDGET_TOKENS, MAX_BUDGET_TOKENS } from "./results";

/**
 * The AskFabric tools, in registry order (FR-1). The order is part of the
 * cached prompt prefix (FR-2.6), so append new tools rather than inserting.
 */

const cursorDescription =
  "null for the first page; otherwise the cursor from the previous result.";

export const ASK_TOOLS: readonly RegisteredAskTool[] = [
  defineTool({
    name: "searchHierarchy",
    description:
      "Find functions, departments and processes by name. Returns each match's id, kind, path, overview state and contribution counts. Use it to turn a name the user mentions into an id for the other tools.",
    input: searchHierarchyInput,
    inputDescriptions: {
      query: "Words from the entity's name, e.g. \"accounts payable\".",
      kinds: "Limit to these kinds, or null for all.",
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
      "List the children of a node in the org structure: all functions (kind null), a function's departments, or a department's processes with contribution counts, pending work, overview state and whether a process flow exists.",
    input: browseHierarchyInput,
    inputDescriptions: {
      kind: "\"function\" or \"department\" to open that node, or null for the list of functions.",
      id: "The id of the function or department to open; null with kind null.",
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
      input.kind === null
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
        "Finding sections to include, or null for all. Process: scope, consensus, variations, gaps, notable. Department: crossProcessDependencies, sharedPatterns, variationsAndTensions, gaps, notable. Function: crossDepartmentDependencies, strategicPatterns, variationsAndTensions, gaps, notable.",
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
      processId: "Limit to this process, or null.",
      departmentId: "Limit to this department, or null.",
      functionId: "Limit to this function, or null.",
      since: "Only contributions recorded on or after this date (YYYY-MM-DD), or null.",
      cursor: cursorDescription,
    },
    access: "member",
    executor: listConversations,
    executorPath: "askTools/conversations:listConversations",
    output: "Up to 25 completed contributions.",
    citationSources: ["conversation"],
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
      atSeconds: "Centre the window on this time in the recording, or null.",
      query: "Centre the window on the first line containing these words, or null.",
      full: "true to read the whole transcript (only when the user asks about the entire contribution); otherwise null.",
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
      "How much of the organization (kind null) or of one entity has been interviewed: processes with and without completed contributions, unique contributors, pending contributions, and stale or missing overviews. Use it to state coverage on every organization-wide answer.",
    input: getCoverageInput,
    inputDescriptions: {
      kind: "The entity kind, or null for the whole organization.",
      id: "The entity id, or null for the whole organization.",
    },
    access: "member",
    executor: getCoverage,
    executorPath: "askTools/coverage:getCoverage",
    output: "One coverage result for the scope.",
    citationSources: ["org", "entity"],
    budgetTokens: DEFAULT_BUDGET_TOKENS,
    telemetryName: "getCoverage",
    label: (input) =>
      input.kind === null ? "Checking coverage across the organization" : `Checking coverage of a ${input.kind}`,
  }),
  defineTool({
    name: "whatsNew",
    description:
      "What changed since a date: contributions recorded since then, and overviews and process flows regenerated since then, newest first. For the whole organization (kind null) or one entity.",
    input: whatsNewInput,
    inputDescriptions: {
      since: "The date to look from, YYYY-MM-DD.",
      kind: "The entity kind, or null for the whole organization.",
      id: "The entity id, or null for the whole organization.",
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
];

export function getAskTool(name: string): RegisteredAskTool | undefined {
  return ASK_TOOLS.find((tool) => tool.name === name);
}

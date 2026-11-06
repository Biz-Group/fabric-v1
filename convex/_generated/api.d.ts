/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiUsage from "../aiUsage.js";
import type * as ask from "../ask.js";
import type * as askCharts from "../askCharts.js";
import type * as askDisplay from "../askDisplay.js";
import type * as askEval from "../askEval.js";
import type * as askFeedback from "../askFeedback.js";
import type * as askLifecycle from "../askLifecycle.js";
import type * as askShared from "../askShared.js";
import type * as askSpeech from "../askSpeech.js";
import type * as askSuggestions from "../askSuggestions.js";
import type * as askThreads from "../askThreads.js";
import type * as askTools_catalog from "../askTools/catalog.js";
import type * as askTools_conversations from "../askTools/conversations.js";
import type * as askTools_coverage from "../askTools/coverage.js";
import type * as askTools_display from "../askTools/display.js";
import type * as askTools_evidence from "../askTools/evidence.js";
import type * as askTools_executor from "../askTools/executor.js";
import type * as askTools_flow from "../askTools/flow.js";
import type * as askTools_graph from "../askTools/graph.js";
import type * as askTools_help from "../askTools/help.js";
import type * as askTools_helpCorpusBuild from "../askTools/helpCorpusBuild.js";
import type * as askTools_hierarchy from "../askTools/hierarchy.js";
import type * as askTools_overview from "../askTools/overview.js";
import type * as askTools_participation from "../askTools/participation.js";
import type * as askTools_registry from "../askTools/registry.js";
import type * as askTools_results from "../askTools/results.js";
import type * as askTools_scope from "../askTools/scope.js";
import type * as askTools_signals from "../askTools/signals.js";
import type * as askTools_systems from "../askTools/systems.js";
import type * as askUsage from "../askUsage.js";
import type * as askfabric_citationAccess from "../askfabric/citationAccess.js";
import type * as askfabric_context from "../askfabric/context.js";
import type * as askfabric_evalChecks from "../askfabric/evalChecks.js";
import type * as askfabric_followUps from "../askfabric/followUps.js";
import type * as askfabric_loop from "../askfabric/loop.js";
import type * as askfabric_modelClient from "../askfabric/modelClient.js";
import type * as askfabric_parts from "../askfabric/parts.js";
import type * as askfabric_suggestions from "../askfabric/suggestions.js";
import type * as askfabric_systemPrompt from "../askfabric/systemPrompt.js";
import type * as cleanup from "../cleanup.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as departments from "../departments.js";
import type * as descriptionSafety from "../descriptionSafety.js";
import type * as functions from "../functions.js";
import type * as hierarchy from "../hierarchy.js";
import type * as hierarchySummaryV2 from "../hierarchySummaryV2.js";
import type * as http from "../http.js";
import type * as invitations from "../invitations.js";
import type * as lib_aiPricing from "../lib/aiPricing.js";
import type * as lib_aiPromptSafety from "../lib/aiPromptSafety.js";
import type * as lib_aiProvider from "../lib/aiProvider.js";
import type * as lib_aiUsageMeter from "../lib/aiUsageMeter.js";
import type * as lib_aiUsageRollup from "../lib/aiUsageRollup.js";
import type * as lib_askFabricFeature from "../lib/askFabricFeature.js";
import type * as lib_askLimits from "../lib/askLimits.js";
import type * as lib_askNormalize from "../lib/askNormalize.js";
import type * as lib_askSchema from "../lib/askSchema.js";
import type * as lib_askSpeech from "../lib/askSpeech.js";
import type * as lib_audioPlaybackToken from "../lib/audioPlaybackToken.js";
import type * as lib_audioRange from "../lib/audioRange.js";
import type * as lib_audioUpload from "../lib/audioUpload.js";
import type * as lib_authErrors from "../lib/authErrors.js";
import type * as lib_clerkApi from "../lib/clerkApi.js";
import type * as lib_contributorAttribution from "../lib/contributorAttribution.js";
import type * as lib_conversationAnalysis from "../lib/conversationAnalysis.js";
import type * as lib_conversationEvidenceV2 from "../lib/conversationEvidenceV2.js";
import type * as lib_conversationFailure from "../lib/conversationFailure.js";
import type * as lib_conversationPipelines from "../lib/conversationPipelines.js";
import type * as lib_conversationTitle from "../lib/conversationTitle.js";
import type * as lib_descriptionSafetyValidators from "../lib/descriptionSafetyValidators.js";
import type * as lib_elevenLabsCharging from "../lib/elevenLabsCharging.js";
import type * as lib_elevenLabsConversation from "../lib/elevenLabsConversation.js";
import type * as lib_flowNeighbourhood from "../lib/flowNeighbourhood.js";
import type * as lib_flowQuality from "../lib/flowQuality.js";
import type * as lib_flowStages from "../lib/flowStages.js";
import type * as lib_hierarchyOverviewV2 from "../lib/hierarchyOverviewV2.js";
import type * as lib_insightsDerivations from "../lib/insightsDerivations.js";
import type * as lib_memberProfile from "../lib/memberProfile.js";
import type * as lib_onboarding from "../lib/onboarding.js";
import type * as lib_orgAuth from "../lib/orgAuth.js";
import type * as lib_orgRollout from "../lib/orgRollout.js";
import type * as lib_processOverviewV2 from "../lib/processOverviewV2.js";
import type * as lib_recommendationReconcile from "../lib/recommendationReconcile.js";
import type * as lib_recommendationScoring from "../lib/recommendationScoring.js";
import type * as lib_recommendationStage from "../lib/recommendationStage.js";
import type * as lib_roles from "../lib/roles.js";
import type * as lib_slugs from "../lib/slugs.js";
import type * as lib_summaryEvaluation from "../lib/summaryEvaluation.js";
import type * as lib_summaryV2Feature from "../lib/summaryV2Feature.js";
import type * as lib_textNormalization from "../lib/textNormalization.js";
import type * as lib_transcriptHash from "../lib/transcriptHash.js";
import type * as lib_userError from "../lib/userError.js";
import type * as migrations from "../migrations.js";
import type * as onboarding from "../onboarding.js";
import type * as orgIntegrity from "../orgIntegrity.js";
import type * as orgThemes from "../orgThemes.js";
import type * as platform from "../platform.js";
import type * as postCall from "../postCall.js";
import type * as processFlows from "../processFlows.js";
import type * as processSummaryV2 from "../processSummaryV2.js";
import type * as processes from "../processes.js";
import type * as readModelHelpers from "../readModelHelpers.js";
import type * as recommendationPreviews from "../recommendationPreviews.js";
import type * as recommendations from "../recommendations.js";
import type * as seed from "../seed.js";
import type * as summaries from "../summaries.js";
import type * as summariesHelpers from "../summariesHelpers.js";
import type * as summaryEvidence from "../summaryEvidence.js";
import type * as summaryOps from "../summaryOps.js";
import type * as summaryV2 from "../summaryV2.js";
import type * as tenants from "../tenants.js";
import type * as testFixtures_summaryV2 from "../testFixtures/summaryV2.js";
import type * as themeColors from "../themeColors.js";
import type * as users from "../users.js";
import type * as voiceRecordings from "../voiceRecordings.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aiUsage: typeof aiUsage;
  ask: typeof ask;
  askCharts: typeof askCharts;
  askDisplay: typeof askDisplay;
  askEval: typeof askEval;
  askFeedback: typeof askFeedback;
  askLifecycle: typeof askLifecycle;
  askShared: typeof askShared;
  askSpeech: typeof askSpeech;
  askSuggestions: typeof askSuggestions;
  askThreads: typeof askThreads;
  "askTools/catalog": typeof askTools_catalog;
  "askTools/conversations": typeof askTools_conversations;
  "askTools/coverage": typeof askTools_coverage;
  "askTools/display": typeof askTools_display;
  "askTools/evidence": typeof askTools_evidence;
  "askTools/executor": typeof askTools_executor;
  "askTools/flow": typeof askTools_flow;
  "askTools/graph": typeof askTools_graph;
  "askTools/help": typeof askTools_help;
  "askTools/helpCorpusBuild": typeof askTools_helpCorpusBuild;
  "askTools/hierarchy": typeof askTools_hierarchy;
  "askTools/overview": typeof askTools_overview;
  "askTools/participation": typeof askTools_participation;
  "askTools/registry": typeof askTools_registry;
  "askTools/results": typeof askTools_results;
  "askTools/scope": typeof askTools_scope;
  "askTools/signals": typeof askTools_signals;
  "askTools/systems": typeof askTools_systems;
  askUsage: typeof askUsage;
  "askfabric/citationAccess": typeof askfabric_citationAccess;
  "askfabric/context": typeof askfabric_context;
  "askfabric/evalChecks": typeof askfabric_evalChecks;
  "askfabric/followUps": typeof askfabric_followUps;
  "askfabric/loop": typeof askfabric_loop;
  "askfabric/modelClient": typeof askfabric_modelClient;
  "askfabric/parts": typeof askfabric_parts;
  "askfabric/suggestions": typeof askfabric_suggestions;
  "askfabric/systemPrompt": typeof askfabric_systemPrompt;
  cleanup: typeof cleanup;
  conversations: typeof conversations;
  crons: typeof crons;
  departments: typeof departments;
  descriptionSafety: typeof descriptionSafety;
  functions: typeof functions;
  hierarchy: typeof hierarchy;
  hierarchySummaryV2: typeof hierarchySummaryV2;
  http: typeof http;
  invitations: typeof invitations;
  "lib/aiPricing": typeof lib_aiPricing;
  "lib/aiPromptSafety": typeof lib_aiPromptSafety;
  "lib/aiProvider": typeof lib_aiProvider;
  "lib/aiUsageMeter": typeof lib_aiUsageMeter;
  "lib/aiUsageRollup": typeof lib_aiUsageRollup;
  "lib/askFabricFeature": typeof lib_askFabricFeature;
  "lib/askLimits": typeof lib_askLimits;
  "lib/askNormalize": typeof lib_askNormalize;
  "lib/askSchema": typeof lib_askSchema;
  "lib/askSpeech": typeof lib_askSpeech;
  "lib/audioPlaybackToken": typeof lib_audioPlaybackToken;
  "lib/audioRange": typeof lib_audioRange;
  "lib/audioUpload": typeof lib_audioUpload;
  "lib/authErrors": typeof lib_authErrors;
  "lib/clerkApi": typeof lib_clerkApi;
  "lib/contributorAttribution": typeof lib_contributorAttribution;
  "lib/conversationAnalysis": typeof lib_conversationAnalysis;
  "lib/conversationEvidenceV2": typeof lib_conversationEvidenceV2;
  "lib/conversationFailure": typeof lib_conversationFailure;
  "lib/conversationPipelines": typeof lib_conversationPipelines;
  "lib/conversationTitle": typeof lib_conversationTitle;
  "lib/descriptionSafetyValidators": typeof lib_descriptionSafetyValidators;
  "lib/elevenLabsCharging": typeof lib_elevenLabsCharging;
  "lib/elevenLabsConversation": typeof lib_elevenLabsConversation;
  "lib/flowNeighbourhood": typeof lib_flowNeighbourhood;
  "lib/flowQuality": typeof lib_flowQuality;
  "lib/flowStages": typeof lib_flowStages;
  "lib/hierarchyOverviewV2": typeof lib_hierarchyOverviewV2;
  "lib/insightsDerivations": typeof lib_insightsDerivations;
  "lib/memberProfile": typeof lib_memberProfile;
  "lib/onboarding": typeof lib_onboarding;
  "lib/orgAuth": typeof lib_orgAuth;
  "lib/orgRollout": typeof lib_orgRollout;
  "lib/processOverviewV2": typeof lib_processOverviewV2;
  "lib/recommendationReconcile": typeof lib_recommendationReconcile;
  "lib/recommendationScoring": typeof lib_recommendationScoring;
  "lib/recommendationStage": typeof lib_recommendationStage;
  "lib/roles": typeof lib_roles;
  "lib/slugs": typeof lib_slugs;
  "lib/summaryEvaluation": typeof lib_summaryEvaluation;
  "lib/summaryV2Feature": typeof lib_summaryV2Feature;
  "lib/textNormalization": typeof lib_textNormalization;
  "lib/transcriptHash": typeof lib_transcriptHash;
  "lib/userError": typeof lib_userError;
  migrations: typeof migrations;
  onboarding: typeof onboarding;
  orgIntegrity: typeof orgIntegrity;
  orgThemes: typeof orgThemes;
  platform: typeof platform;
  postCall: typeof postCall;
  processFlows: typeof processFlows;
  processSummaryV2: typeof processSummaryV2;
  processes: typeof processes;
  readModelHelpers: typeof readModelHelpers;
  recommendationPreviews: typeof recommendationPreviews;
  recommendations: typeof recommendations;
  seed: typeof seed;
  summaries: typeof summaries;
  summariesHelpers: typeof summariesHelpers;
  summaryEvidence: typeof summaryEvidence;
  summaryOps: typeof summaryOps;
  summaryV2: typeof summaryV2;
  tenants: typeof tenants;
  "testFixtures/summaryV2": typeof testFixtures_summaryV2;
  themeColors: typeof themeColors;
  users: typeof users;
  voiceRecordings: typeof voiceRecordings;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};

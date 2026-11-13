import type { TableNames } from "../_generated/dataModel";

/**
 * Where every table's client data lives, for offboarding, export and person
 * erasure (docs/client-offboarding-plan.md).
 *
 * Keyed by `TableNames`, so adding a table to the schema fails type checking
 * until it is classified here. `tenantDataRegistry.test.ts` then checks each
 * entry against the schema: the org index exists and leads with `clerkOrgId`,
 * and every storage-file field, user-id field and vendor-id field is listed.
 * Forgetting one of those would leave a client's data behind after a purge.
 */

export type TenantDataClass =
  /** Interview content and everything generated from it. */
  | "content"
  /** Who is in the workspace: names, emails, roles, invitations, audit. */
  | "people"
  /** Short-lived control rows: grants, counters, run state. */
  | "operational"
  /** Content-free cost ledger (org id, model, units, cost). */
  | "billing"
  /** The workspace's own registry row. */
  | "tenant";

/** What a workspace purge does to a table's rows for that org. */
export type PurgePolicy =
  | "delete"
  /** Kept after purge (pending D4 in the plan). */
  | "keep"
  /** Reduced to a minimal record, not removed (pending D4). */
  | "tombstone";

export type ExternalSystem = "elevenlabs" | "clerk";

type Common = {
  class: TenantDataClass;
  purge: PurgePolicy;
  /** `v.id("_storage")` fields: the file goes with the row. */
  storageFields?: readonly string[];
  /**
   * Fields holding a `users` id, as dotted paths (`[]` marks an array
   * element). Person erasure must clear or delete each one.
   */
  userIdFields?: readonly string[];
  /** Ids of records held by another vendor, to delete there first. */
  externalIdFields?: readonly { field: string; system: ExternalSystem }[];
};

export type OrgTableEntry = Common & {
  scope: "org";
  /** An index whose first field is `clerkOrgId`, for batched org-wide reads. */
  orgIndex: string;
};

/** Org data reachable only through a parent row, deleted with that parent. */
export type ChildTableEntry = Common & {
  scope: "orgChild";
  parent: TableNames;
  /** The parent's own deleter, which removes these rows. */
  deletedBy: string;
};

/** Not owned by one org. */
export type GlobalTableEntry = Common & {
  scope: "global";
  why: string;
};

export type TenantDataEntry = OrgTableEntry | ChildTableEntry | GlobalTableEntry;

export const TENANT_DATA: Record<TableNames, TenantDataEntry> = {
  // ---- Platform-wide ---------------------------------------------------------
  users: {
    scope: "global",
    why: "One profile per person across every workspace; erased only when the person is in no other workspace (D5).",
    class: "people",
    purge: "keep",
    externalIdFields: [{ field: "clerkUserId", system: "clerk" }],
  },
  processedWebhookEvents: {
    scope: "global",
    why: "Clerk event ids for de-duplication; no client content.",
    class: "operational",
    purge: "keep",
  },
  recommendationBackfills: {
    scope: "global",
    why: "Control row for a platform-wide backfill; holds a cursor, no client content.",
    class: "operational",
    purge: "keep",
  },

  // ---- The workspace itself --------------------------------------------------
  tenants: {
    scope: "org",
    orgIndex: "by_clerkOrgId",
    class: "tenant",
    purge: "tombstone",
    storageFields: ["logoStorageId"],
    userIdFields: ["createdBy", "offboarding.suspendedByUserId"],
  },
  orgThemes: {
    scope: "org",
    orgIndex: "by_clerkOrgId",
    class: "tenant",
    purge: "delete",
    userIdFields: ["approvedByUserId"],
  },
  orgFeatures: {
    scope: "org",
    orgIndex: "by_clerkOrgId",
    class: "tenant",
    purge: "delete",
    userIdFields: ["mcpGrantedByUserId", "mcpEnabledByUserId"],
  },

  // ---- People ----------------------------------------------------------------
  memberships: {
    scope: "org",
    orgIndex: "by_clerkOrgId",
    class: "people",
    purge: "delete",
    userIdFields: ["userId", "invitedBy"],
    externalIdFields: [{ field: "clerkUserId", system: "clerk" }],
  },
  membershipIntents: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_emailLower",
    class: "people",
    purge: "delete",
    userIdFields: ["invitedBy", "acceptedUserId"],
    externalIdFields: [
      { field: "clerkInvitationId", system: "clerk" },
      { field: "clerkUserId", system: "clerk" },
    ],
  },
  orgMembershipStats: {
    scope: "org",
    orgIndex: "by_clerkOrgId",
    class: "operational",
    purge: "delete",
  },
  authAuditEvents: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_createdAt",
    class: "people",
    purge: "delete",
    userIdFields: ["actorUserId", "targetUserId"],
  },

  // ---- Hierarchy -------------------------------------------------------------
  functions: { scope: "org", orgIndex: "by_clerkOrgId", class: "content", purge: "delete" },
  departments: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_functionId",
    class: "content",
    purge: "delete",
  },
  processes: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_departmentId",
    class: "content",
    purge: "delete",
  },

  // ---- Interviews ------------------------------------------------------------
  conversations: {
    scope: "org",
    orgIndex: "by_clerkOrgId",
    class: "content",
    purge: "delete",
    storageFields: ["audioStorageId"],
    userIdFields: ["userId", "subjectUserId", "speakerLabels[].userId"],
    // Agent interviews: ElevenLabs holds the only copy of the audio and a copy
    // of the transcript. Every client shares one agent, so this field is the
    // only record of which client a conversation belongs to: collect the ids
    // before deleting the rows.
    externalIdFields: [{ field: "elevenlabsConversationId", system: "elevenlabs" }],
  },
  conversationMoves: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_createdAt",
    class: "content",
    purge: "delete",
    userIdFields: ["actorUserId"],
  },
  conversationDeletions: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_createdAt",
    class: "content",
    purge: "delete",
    userIdFields: ["actorUserId"],
  },
  voiceUploadGrants: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_userId_and_processId",
    class: "operational",
    purge: "delete",
    userIdFields: ["userId"],
  },
  voiceUploadRateLimits: {
    scope: "org",
    orgIndex: "by_clerkOrgId",
    class: "operational",
    purge: "delete",
  },

  // ---- Generated outputs -----------------------------------------------------
  processFlows: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_processId",
    class: "content",
    purge: "delete",
  },
  processFlowNodeDetails: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_processFlowId_and_generationId_and_nodeId",
    class: "content",
    purge: "delete",
  },
  recommendationRuns: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_processId_and_createdAt",
    class: "content",
    purge: "delete",
  },
  processRecommendations: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_processId_and_source_and_lifecycle",
    class: "content",
    purge: "delete",
  },
  recommendationDecisions: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_recommendationId_and_createdAt",
    class: "content",
    purge: "delete",
    userIdFields: ["actorUserId"],
  },
  recommendationReviews: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_recommendationId_and_reviewerUserId",
    class: "content",
    purge: "delete",
    userIdFields: ["reviewerUserId"],
  },
  recommendationPreviews: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_processId",
    class: "content",
    purge: "delete",
  },
  summaryRuns: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_generationId",
    class: "content",
    purge: "delete",
    userIdFields: ["actorUserId"],
  },
  summaryChunks: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_summaryRunId_and_chunkIndex",
    class: "content",
    purge: "delete",
  },

  // ---- Billing ---------------------------------------------------------------
  // `actorUserId` here is an opaque string (it crosses deployments), not a
  // `users` id; person erasure clears it alongside `actorName`.
  aiUsageEvents: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_createdAt",
    class: "billing",
    purge: "keep",
  },
  aiUsageRollups: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_period",
    class: "billing",
    purge: "keep",
  },
  // Fabric MCP (Phase 3): the per-call audit names the member, so it goes
  // with the workspace; the daily counts are the add-on's billing record.
  mcpOAuthClients: {
    scope: "org",
    orgIndex: "by_clerkOrgId",
    class: "operational",
    purge: "delete",
    userIdFields: ["createdByUserId"],
    // The Clerk application is deleted when the add-on is revoked or the
    // workspace is closed (mcpClients.deleteAllMcpClientsForOrg), before purge.
    externalIdFields: [{ field: "clerkAppId", system: "clerk" }],
  },
  mcpCalls: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_createdAt",
    class: "operational",
    purge: "delete",
    userIdFields: ["userId"],
  },
  mcpUsageDays: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_period",
    class: "billing",
    purge: "keep",
  },

  // ---- AskFabric -------------------------------------------------------------
  askThreads: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_userId_and_status_and_lastMessageAt",
    class: "content",
    purge: "delete",
    userIdFields: ["userId"],
  },
  askMessages: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_role",
    class: "content",
    purge: "delete",
    userIdFields: ["userId"],
  },
  askCitations: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_sourceKind_and_sourceEntityId",
    class: "content",
    purge: "delete",
    userIdFields: ["userId"],
  },
  askSuggestions: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_userId",
    class: "content",
    purge: "delete",
    userIdFields: ["userId"],
  },
  askFeedback: {
    scope: "org",
    orgIndex: "by_clerkOrgId",
    class: "content",
    purge: "delete",
    userIdFields: ["userId"],
  },
  askSpeech: {
    scope: "orgChild",
    parent: "askThreads",
    deletedBy: "askThreads.deleteThreadBatch",
    class: "content",
    purge: "delete",
    storageFields: ["storageId"],
    userIdFields: ["userId"],
  },
  askSharedExchanges: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_userId",
    class: "content",
    purge: "delete",
    userIdFields: ["userId"],
  },

  // ---- Offboarding's own records ---------------------------------------------
  tenantExports: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_createdAt",
    class: "operational",
    purge: "delete",
    userIdFields: ["requestedByUserId"],
  },
  tenantExportFiles: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_exportId",
    class: "operational",
    purge: "delete",
    storageFields: ["storageId"],
  },
  tenantExportAudioEntries: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_exportId",
    class: "operational",
    purge: "delete",
  },
  // The purge's own records: the certificate stays (D4); the work list is
  // removed by the purge itself once it completes.
  tenantPurges: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_startedAt",
    class: "tenant",
    purge: "keep",
    userIdFields: ["requestedByUserId"],
  },
  tenantPurgeItems: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_purgeId_and_status",
    class: "operational",
    purge: "keep",
  },
  // Erasing one person (Phase 4). The record outlives the erasure as proof
  // it happened, holding an opaque user id and counts only.
  personErasures: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_startedAt",
    class: "people",
    purge: "delete",
    userIdFields: ["requestedByUserId", "userId"],
  },
  personErasureItems: {
    scope: "org",
    orgIndex: "by_clerkOrgId_and_erasureId_and_kind_and_status",
    class: "operational",
    purge: "delete",
  },
};

/**
 * What erasing one person from a workspace does to each table (Phase 4,
 * personErasure.ts). `scan`: the erasure pages through the org's rows and
 * applies the handler of the same name in personErasure.ts (the registry
 * test checks every scan table has one). A string: handled elsewhere, and
 * how. `null`: the table holds nothing about a person.
 */
export const ERASURE: Record<TableNames, "scan" | string | null> = {
  users: "The global profile: blanked, and the Clerk account deleted, only when the person is in no other workspace (D5).",
  processedWebhookEvents: null,
  recommendationBackfills: null,
  tenants: "Only Biz Group staff create workspaces; staff are never erased.",
  orgThemes: "scan",
  orgFeatures: "scan",
  memberships: "scan",
  membershipIntents: "scan",
  orgMembershipStats: null,
  authAuditEvents: "scan",
  functions: null,
  departments: null,
  processes: "Overviews built from their interviews are cleared and rebuilt (D7).",
  conversations: "scan",
  conversationMoves: "scan",
  conversationDeletions: "scan",
  voiceUploadGrants: "scan",
  voiceUploadRateLimits: null,
  processFlows: "Process maps built from their interviews are cleared and rebuilt (D7).",
  processFlowNodeDetails: "Deleted with their process map.",
  recommendationRuns: null,
  processRecommendations: null,
  recommendationDecisions: "scan",
  recommendationReviews: "scan",
  recommendationPreviews: null,
  summaryRuns: "scan",
  summaryChunks: null,
  aiUsageEvents: "scan",
  aiUsageRollups: null,
  mcpCalls: "scan",
  mcpOAuthClients: "scan",
  mcpUsageDays: null,
  askThreads: "Deleted with the rest of their AskFabric content (askLifecycle.purgeAskFabricForMember).",
  askMessages: "Deleted with their threads.",
  askCitations: "Deleted with their threads.",
  askSuggestions: "Deleted by askLifecycle.purgeAskFabricForMember.",
  askFeedback: "Deleted with their threads.",
  askSpeech: "Deleted with their threads.",
  askSharedExchanges: "Deleted by askLifecycle.purgeAskFabricForMember.",
  tenantExports: "Only Biz Group staff request exports.",
  tenantExportFiles: null,
  tenantExportAudioEntries: null,
  tenantPurges: "Only Biz Group staff start purges.",
  tenantPurgeItems: null,
  personErasures: "The erasure's own record: who was erased is an opaque id, no name or email once complete.",
  personErasureItems: null,
};

/**
 * Which tables go into a workspace export (D3), as JSON under `data/`.
 * `true` exports every row of the org's; a string is why the table is left
 * out, and the export's README lists those reasons.
 */
export const EXPORT_POLICY: Record<TableNames, true | string> = {
  users: "Covered by members.csv; the global profile also holds other workspaces' data.",
  processedWebhookEvents: "Platform bookkeeping.",
  recommendationBackfills: "Platform bookkeeping.",
  tenants: "Covered by the README; the row holds Biz Group's internal notes.",
  orgThemes: "Colours derived from the logo.",
  orgFeatures: true,
  memberships: true,
  membershipIntents: true,
  orgMembershipStats: "Counts derived from memberships.",
  authAuditEvents: true,
  functions: true,
  departments: true,
  processes: true,
  conversations: true,
  conversationMoves: true,
  conversationDeletions: true,
  voiceUploadGrants: "Short-lived upload credentials.",
  voiceUploadRateLimits: "Rate-limit counters.",
  processFlows: true,
  processFlowNodeDetails: true,
  recommendationRuns: "Processing records for recommendation runs.",
  processRecommendations: true,
  recommendationDecisions: true,
  recommendationReviews: true,
  recommendationPreviews: "Biz Group's prompt experiments, never shown in the workspace.",
  summaryRuns: "Processing records for overview generation.",
  summaryChunks: "Intermediate output of overview generation.",
  aiUsageEvents: "Biz Group's own cost records.",
  aiUsageRollups: "Biz Group's own cost records.",
  mcpCalls: true,
  mcpOAuthClients: "Credentials for the workspace's Copilot Studio connection; not useful outside Fabric.",
  mcpUsageDays: "Biz Group's own usage records.",
  // Saish 2026-11-11: AskFabric chats are private to each member (D12), so
  // they never leave the workspace in an export.
  askThreads: "AskFabric chats are private to each member.",
  askMessages: "AskFabric chats are private to each member.",
  askCitations: "AskFabric chats are private to each member.",
  askSuggestions: "AskFabric chats are private to each member.",
  askFeedback: "AskFabric chats are private to each member.",
  askSpeech: "AskFabric chats are private to each member.",
  askSharedExchanges: "AskFabric chats are private to each member.",
  tenantExports: "The export's own records.",
  tenantExportFiles: "The export's own records.",
  tenantExportAudioEntries: "The export's own records.",
  tenantPurges: "Deletion records.",
  tenantPurgeItems: "Deletion records.",
  personErasures: "Deletion records.",
  personErasureItems: "Deletion records.",
};

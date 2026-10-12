import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assertOrgOwns,
  isActiveMembership,
  requireOrgAdmin,
  requireOrgMember,
} from "./lib/orgAuth";
import { firmCounterpartyValidator } from "./schema";
import {
  buildFirmCatalog,
  buildFirmLinksAIRequest,
  buildFirmLinksUserContent,
  deriveProcessRoles,
  FIRM_LINK_CAPS,
  hasResolvableSignal,
  normalizeFirmLinks,
  type FirmDependencyMention,
  type FirmResolutionStep,
  type NormalizedFirmLink,
} from "./lib/firmLinks";
import {
  isAIConfigured,
  isTokenLimitFinishReason,
  type AICompletion,
} from "./lib/aiProvider";
import { meteredCompletion } from "./lib/aiUsageMeter";

/**
 * Firm view: one map of every process, owner, and handoff.
 *
 * Each process's flow and interview evidence already say who it hands work to,
 * as free text. Resolution turns those mentions into `firmLinks` rows pointing
 * at catalog ids — one bounded AI call per process, triggered when its flow
 * finishes — and `getFirmMap` reads them back as one org-wide graph.
 * See docs/firm-view-plan.md.
 */

const MAX_FUNCTIONS = 200;
const MAX_DEPARTMENTS = 1000;
const MAX_PROCESSES = 2000;
const MAX_LINKS = 8000;
const MAX_LINKS_PER_SOURCE = 200;
const MAX_EVIDENCE_CONVERSATIONS = 30;
const LINK_CLEANUP_BATCH = 200;

/** Spacing between backfill resolutions, so a full build never spikes Foundry TPM. */
const BUILD_STAGGER_MS = 3_000;
const BUILD_PAGE_SIZE = 50;

/** A resolution with no heartbeat for this long is treated as dead. */
const RESOLUTION_STALE_MS = 15 * 60_000;

const RESOLUTION_ERROR_MESSAGE =
  "We could not work out this process's handoffs. Try rebuilding the map.";

function sortBySortOrder<T extends { sortOrder: number; _creationTime: number }>(
  rows: T[],
) {
  return rows.sort(
    (a, b) => a.sortOrder - b.sortOrder || a._creationTime - b._creationTime,
  );
}

async function getProfile(
  ctx: QueryCtx,
  clerkOrgId: string,
  processId: Id<"processes">,
) {
  return await ctx.db
    .query("firmProcessProfiles")
    .withIndex("by_clerkOrgId_and_processId", (q) =>
      q.eq("clerkOrgId", clerkOrgId).eq("processId", processId),
    )
    .unique();
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

/**
 * Stamps a fresh resolution id and schedules the resolver. Any run already in
 * flight is superseded: its save will no longer match and is dropped. Called
 * from `finalizeNodeDetails` when a flow lands, and by the backfill.
 */
export async function enqueueFirmResolution(
  ctx: MutationCtx,
  args: {
    clerkOrgId: string;
    processId: Id<"processes">;
    delayMs?: number;
  },
): Promise<string> {
  const resolutionId = crypto.randomUUID();
  const now = Date.now();
  const existing = await getProfile(ctx, args.clerkOrgId, args.processId);
  if (existing) {
    await ctx.db.patch(existing._id, {
      status: "queued",
      resolutionId,
      errorMessage: undefined,
      lastProgressAt: now,
    });
  } else {
    await ctx.db.insert("firmProcessProfiles", {
      clerkOrgId: args.clerkOrgId,
      processId: args.processId,
      status: "queued",
      resolutionId,
      roles: [],
      linkCount: 0,
      lastProgressAt: now,
    });
  }
  await ctx.scheduler.runAfter(
    args.delayMs ?? 0,
    internal.firmMap.resolveProcessLinksInternal,
    {
      clerkOrgId: args.clerkOrgId,
      processId: args.processId,
      resolutionId,
    },
  );
  return resolutionId;
}

/**
 * Admin "Build firm map": resolves every process whose flow has landed and
 * whose links are missing, failed, or were read from an older flow. `force`
 * re-resolves everything. Pages through flows so a large org never reads every
 * flow document in one transaction.
 */
export const requestFirmMapBuild = mutation({
  args: { force: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ scheduled: true }> => {
    const caller = await requireOrgAdmin(ctx);
    await ctx.scheduler.runAfter(0, internal.firmMap.enqueueFirmBuildPage, {
      clerkOrgId: caller.orgId,
      cursor: null,
      enqueued: 0,
      force: args.force ?? false,
    });
    return { scheduled: true };
  },
});

export const enqueueFirmBuildPage = internalMutation({
  args: {
    clerkOrgId: v.string(),
    cursor: v.union(v.string(), v.null()),
    enqueued: v.number(),
    force: v.boolean(),
  },
  handler: async (ctx, args): Promise<void> => {
    const page = await ctx.db
      .query("processFlows")
      .withIndex("by_clerkOrgId_and_processId", (q) =>
        q.eq("clerkOrgId", args.clerkOrgId),
      )
      .paginate({ numItems: BUILD_PAGE_SIZE, cursor: args.cursor });

    let enqueued = args.enqueued;
    for (const flow of page.page) {
      if (flow.status !== "ready") continue;
      const profile = await getProfile(ctx, args.clerkOrgId, flow.processId);
      const inFlight =
        profile !== null &&
        (profile.status === "queued" || profile.status === "resolving") &&
        Date.now() - profile.lastProgressAt < RESOLUTION_STALE_MS;
      const current =
        profile !== null &&
        profile.status === "ready" &&
        profile.flowGenerationId === flowGenerationKey(flow);
      if (inFlight || (current && !args.force)) continue;

      await enqueueFirmResolution(ctx, {
        clerkOrgId: args.clerkOrgId,
        processId: flow.processId,
        delayMs: enqueued * BUILD_STAGGER_MS,
      });
      enqueued += 1;
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.firmMap.enqueueFirmBuildPage, {
        ...args,
        cursor: page.continueCursor,
        enqueued,
      });
    }
  },
});

/**
 * Legacy single-call flows carry no generationId; their `generatedAt` stands in
 * so a regenerated legacy flow still reads as newer than its links.
 */
function flowGenerationKey(flow: Doc<"processFlows">): string {
  return flow.generationId ?? `legacy:${flow.generatedAt}`;
}

// ---------------------------------------------------------------------------
// Resolve
// ---------------------------------------------------------------------------

export const markResolving = internalMutation({
  args: {
    clerkOrgId: v.string(),
    processId: v.id("processes"),
    resolutionId: v.string(),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const profile = await getProfile(ctx, args.clerkOrgId, args.processId);
    if (!profile || profile.resolutionId !== args.resolutionId) return false;
    await ctx.db.patch(profile._id, {
      status: "resolving",
      lastProgressAt: Date.now(),
    });
    return true;
  },
});

type ResolvedLink = NormalizedFirmLink<
  Id<"functions">,
  Id<"departments">,
  Id<"processes">
>;

type ResolutionInput = {
  flowGenerationId: string;
  steps: FirmResolutionStep[];
  dependencyMentions: FirmDependencyMention[];
  contributors: string[];
  hierarchy: {
    functions: Array<{ id: Id<"functions">; name: string }>;
    departments: Array<{
      id: Id<"departments">;
      name: string;
      functionId: Id<"functions">;
      description?: string;
    }>;
    processes: Array<{
      id: Id<"processes">;
      name: string;
      departmentId: Id<"departments">;
      description?: string;
    }>;
  };
};

export const getResolutionInput = internalQuery({
  args: {
    clerkOrgId: v.string(),
    processId: v.id("processes"),
  },
  handler: async (ctx, args): Promise<ResolutionInput | null> => {
    const process = await ctx.db.get(args.processId);
    if (!process || process.clerkOrgId !== args.clerkOrgId) return null;

    const flow = await ctx.db
      .query("processFlows")
      .withIndex("by_clerkOrgId_and_processId", (q) =>
        q.eq("clerkOrgId", args.clerkOrgId).eq("processId", args.processId),
      )
      .first();
    if (!flow || flow.status !== "ready") return null;

    // A staged flow's details live in the child table, scoped to the current
    // generation; a legacy flow carries them inline.
    let detailByNodeId = new Map<
      string,
      { description: string; actors: string[]; sources: string[] }
    >();
    if (flow.generationVersion !== undefined && flow.generationId) {
      const rows = await ctx.db
        .query("processFlowNodeDetails")
        .withIndex(
          "by_clerkOrgId_and_processFlowId_and_generationId_and_nodeId",
          (q) =>
            q
              .eq("clerkOrgId", args.clerkOrgId)
              .eq("processFlowId", flow._id)
              .eq("generationId", flow.generationId!),
        )
        .take(flow.nodes.length + 10);
      detailByNodeId = new Map(
        rows
          .filter((row) => row.status === "ready" && row.detail)
          .map((row) => [row.nodeId, row.detail!]),
      );
    } else {
      detailByNodeId = new Map(flow.nodes.map((node) => [node.id, node]));
    }

    const steps: FirmResolutionStep[] = flow.nodes.map((node) => {
      const detail = detailByNodeId.get(node.id);
      return {
        id: node.id,
        label: node.label,
        category: node.category,
        description: detail?.description || undefined,
        actors: detail?.actors ?? [],
        sources: detail?.sources ?? [],
      };
    });

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_processId_and_status", (q) =>
        q
          .eq("clerkOrgId", args.clerkOrgId)
          .eq("processId", args.processId)
          .eq("status", "done"),
      )
      .order("desc")
      .take(MAX_EVIDENCE_CONVERSATIONS);
    const dependencyMentions: FirmDependencyMention[] = [];
    for (const conversation of conversations) {
      for (const text of conversation.processSummaryEvidenceV2
        ?.handoffsAndDependencies ?? []) {
        if (dependencyMentions.length >= FIRM_LINK_CAPS.dependencyMentions) {
          break;
        }
        const trimmed = text.trim();
        if (!trimmed) continue;
        dependencyMentions.push({
          contributor: conversation.contributorName,
          text: trimmed.slice(0, FIRM_LINK_CAPS.dependencyMentionChars),
        });
      }
    }

    const functions = sortBySortOrder(
      await ctx.db
        .query("functions")
        .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", args.clerkOrgId))
        .take(MAX_FUNCTIONS),
    );
    const departments = sortBySortOrder(
      await ctx.db
        .query("departments")
        .withIndex("by_clerkOrgId_and_functionId", (q) =>
          q.eq("clerkOrgId", args.clerkOrgId),
        )
        .take(MAX_DEPARTMENTS),
    );
    const processes = sortBySortOrder(
      await ctx.db
        .query("processes")
        .withIndex("by_clerkOrgId_and_departmentId", (q) =>
          q.eq("clerkOrgId", args.clerkOrgId),
        )
        .take(MAX_PROCESSES),
    );

    // Hierarchy order — function, then department, then process — so related
    // entries sit together in the prompt.
    const departmentOrder = new Map<string, number>();
    for (const fn of functions) {
      for (const department of departments) {
        if (department.functionId === fn._id) {
          departmentOrder.set(department._id, departmentOrder.size);
        }
      }
    }
    const orderedDepartments = departments
      .filter((department) => departmentOrder.has(department._id))
      .sort(
        (a, b) => departmentOrder.get(a._id)! - departmentOrder.get(b._id)!,
      );
    const orderedProcesses = processes
      .filter((p) => departmentOrder.has(p.departmentId))
      .sort(
        (a, b) =>
          departmentOrder.get(a.departmentId)! -
          departmentOrder.get(b.departmentId)!,
      );

    return {
      flowGenerationId: flowGenerationKey(flow),
      steps,
      dependencyMentions,
      contributors: Array.from(
        new Set([
          ...conversations.map((c) => c.contributorName),
          ...steps.flatMap((step) => step.sources),
        ]),
      ),
      hierarchy: {
        functions: functions.map((fn) => ({ id: fn._id, name: fn.name })),
        departments: orderedDepartments.map((department) => ({
          id: department._id,
          name: department.name,
          functionId: department.functionId,
          description: department.description,
        })),
        processes: orderedProcesses.map((p) => ({
          id: p._id,
          name: p.name,
          departmentId: p.departmentId,
          description: p.description,
        })),
      },
    };
  },
});

const savedLinkValidator = v.object({
  direction: v.union(v.literal("outbound"), v.literal("inbound")),
  counterparty: firmCounterpartyValidator,
  counterpartyKey: v.string(),
  kind: v.union(v.literal("handoff"), v.literal("dependency")),
  label: v.string(),
  nodeIds: v.array(v.string()),
  evidence: v.array(v.string()),
  contributors: v.array(v.string()),
  confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
});

/**
 * Replaces this process's proposed AI links with a fresh set. Admin-added and
 * reviewed rows are never touched, and a fresh link that matches a reviewed one
 * (same counterparty and direction) is not re-proposed — an admin who rejected
 * a link must not see it come back on the next interview.
 */
export const saveProcessLinks = internalMutation({
  args: {
    clerkOrgId: v.string(),
    processId: v.id("processes"),
    resolutionId: v.string(),
    flowGenerationId: v.string(),
    roles: v.array(v.object({ name: v.string(), stepCount: v.number() })),
    links: v.array(savedLinkValidator),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const profile = await getProfile(ctx, args.clerkOrgId, args.processId);
    if (!profile || profile.resolutionId !== args.resolutionId) return false;
    const process = await ctx.db.get(args.processId);
    if (!process || process.clerkOrgId !== args.clerkOrgId) return false;

    const existing = await ctx.db
      .query("firmLinks")
      .withIndex("by_clerkOrgId_and_sourceProcessId", (q) =>
        q.eq("clerkOrgId", args.clerkOrgId).eq("sourceProcessId", args.processId),
      )
      .take(MAX_LINKS_PER_SOURCE);

    const kept = new Set<string>();
    let keptVisible = 0;
    for (const row of existing) {
      if (row.origin === "ai" && row.review === "proposed") {
        await ctx.db.delete(row._id);
      } else {
        kept.add(`${row.direction}|${row.counterpartyKey}`);
        if (row.review !== "rejected") keptVisible += 1;
      }
    }

    const now = Date.now();
    let inserted = 0;
    for (const link of args.links) {
      if (kept.has(`${link.direction}|${link.counterpartyKey}`)) continue;
      await ctx.db.insert("firmLinks", {
        clerkOrgId: args.clerkOrgId,
        sourceProcessId: args.processId,
        ...link,
        origin: "ai",
        review: "proposed",
        resolutionId: args.resolutionId,
        updatedAt: now,
      });
      inserted += 1;
    }

    await ctx.db.patch(profile._id, {
      status: "ready",
      flowGenerationId: args.flowGenerationId,
      roles: args.roles,
      linkCount: keptVisible + inserted,
      errorMessage: undefined,
      resolvedAt: now,
      lastProgressAt: now,
    });
    return true;
  },
});

export const failProcessResolution = internalMutation({
  args: {
    clerkOrgId: v.string(),
    processId: v.id("processes"),
    resolutionId: v.string(),
    errorMessage: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const profile = await getProfile(ctx, args.clerkOrgId, args.processId);
    if (!profile || profile.resolutionId !== args.resolutionId) return;
    await ctx.db.patch(profile._id, {
      status: "failed",
      errorMessage: args.errorMessage,
      lastProgressAt: Date.now(),
    });
  },
});

/** Removes the profile of a process that turned out to have no flow to read. */
export const clearProfile = internalMutation({
  args: {
    clerkOrgId: v.string(),
    processId: v.id("processes"),
    resolutionId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const profile = await getProfile(ctx, args.clerkOrgId, args.processId);
    if (!profile || profile.resolutionId !== args.resolutionId) return;
    await ctx.db.delete(profile._id);
  },
});

export const resolveProcessLinksInternal = internalAction({
  args: {
    clerkOrgId: v.string(),
    processId: v.id("processes"),
    resolutionId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const owns: boolean = await ctx.runMutation(
      internal.firmMap.markResolving,
      args,
    );
    // Superseded by a newer request — that run owns the profile now.
    if (!owns) return;

    const input: ResolutionInput | null = await ctx.runQuery(
      internal.firmMap.getResolutionInput,
      {
        clerkOrgId: args.clerkOrgId,
        processId: args.processId,
      },
    );
    if (input === null) {
      // The process was deleted, or its flow is gone or regenerating. A
      // regenerating flow re-enqueues itself when it lands.
      await ctx.runMutation(internal.firmMap.clearProfile, args);
      return;
    }

    const roles = deriveProcessRoles(input.steps);
    const save = async (links: ResolvedLink[]) => {
      await ctx.runMutation(internal.firmMap.saveProcessLinks, {
        ...args,
        flowGenerationId: input.flowGenerationId,
        roles,
        links,
      });
    };

    // Nothing in the flow or the interviews points outside the process, so a
    // call could only invent links. Save the roles and stop.
    if (!hasResolvableSignal(input)) {
      await save([]);
      return;
    }

    if (!isAIConfigured("synthesis")) {
      await ctx.runMutation(internal.firmMap.failProcessResolution, {
        ...args,
        errorMessage: RESOLUTION_ERROR_MESSAGE,
      });
      return;
    }

    const catalog = buildFirmCatalog({
      ...input.hierarchy,
      sourceProcessId: args.processId,
    });

    let completion: AICompletion;
    try {
      completion = await meteredCompletion(
        ctx,
        {
          clerkOrgId: args.clerkOrgId,
          entityType: "process",
          entityId: args.processId,
          runId: args.resolutionId,
        },
        buildFirmLinksAIRequest(
          buildFirmLinksUserContent({
            catalog,
            sourceProcessId: args.processId,
            steps: input.steps,
            dependencyMentions: input.dependencyMentions,
          }),
        ),
      );
    } catch (error) {
      console.error("Firm link resolution request failed", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      await ctx.runMutation(internal.firmMap.failProcessResolution, {
        ...args,
        errorMessage: RESOLUTION_ERROR_MESSAGE,
      });
      return;
    }

    if (isTokenLimitFinishReason(completion.finishReason)) {
      console.error("Firm link resolution hit the token limit", {
        processId: args.processId,
      });
      await ctx.runMutation(internal.firmMap.failProcessResolution, {
        ...args,
        errorMessage: RESOLUTION_ERROR_MESSAGE,
      });
      return;
    }

    let payload: unknown = completion.toolInput;
    if (payload === null && completion.text?.trim()) {
      try {
        payload = JSON.parse(completion.text);
      } catch {
        payload = null;
      }
    }
    if (payload === null) {
      await ctx.runMutation(internal.firmMap.failProcessResolution, {
        ...args,
        errorMessage: RESOLUTION_ERROR_MESSAGE,
      });
      return;
    }

    await save(
      normalizeFirmLinks(payload, {
        catalog,
        sourceProcessId: args.processId,
        knownNodeIds: input.steps.map((step) => step.id),
        knownContributors: input.contributors,
      }),
    );
  },
});

/**
 * Resolutions whose heartbeat went stale — an action killed mid-call leaves a
 * profile in "resolving" with nothing to pick it up. Marked failed so the map
 * stops showing them as in progress and the next build retries them.
 */
export const reapStuckFirmResolutions = internalMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    const cutoff = Date.now() - RESOLUTION_STALE_MS;
    for (const status of ["queued", "resolving"] as const) {
      const stuck = await ctx.db
        .query("firmProcessProfiles")
        .withIndex("by_status_and_lastProgressAt", (q) =>
          q.eq("status", status).lt("lastProgressAt", cutoff),
        )
        .take(100);
      for (const profile of stuck) {
        await ctx.db.patch(profile._id, {
          status: "failed",
          errorMessage: RESOLUTION_ERROR_MESSAGE,
          lastProgressAt: Date.now(),
        });
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Cascades
// ---------------------------------------------------------------------------

/**
 * Deletes everything the Firm view holds about one hierarchy entity: links
 * pointing at it, and — for a process — its own links and profile. Bounded
 * batches, rescheduling itself until done.
 */
export const deleteForEntity = internalMutation({
  args: {
    clerkOrgId: v.string(),
    entity: v.union(
      v.object({ kind: v.literal("process"), processId: v.id("processes") }),
      v.object({
        kind: v.literal("department"),
        departmentId: v.id("departments"),
      }),
      v.object({ kind: v.literal("function"), functionId: v.id("functions") }),
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    const { entity } = args;
    const counterpartyKey =
      entity.kind === "process"
        ? `process:${entity.processId}`
        : entity.kind === "department"
          ? `department:${entity.departmentId}`
          : `function:${entity.functionId}`;

    const inbound = await ctx.db
      .query("firmLinks")
      .withIndex("by_clerkOrgId_and_counterpartyKey", (q) =>
        q.eq("clerkOrgId", args.clerkOrgId).eq("counterpartyKey", counterpartyKey),
      )
      .take(LINK_CLEANUP_BATCH);
    for (const row of inbound) await ctx.db.delete(row._id);

    let own: Doc<"firmLinks">[] = [];
    if (entity.kind === "process") {
      own = await ctx.db
        .query("firmLinks")
        .withIndex("by_clerkOrgId_and_sourceProcessId", (q) =>
          q
            .eq("clerkOrgId", args.clerkOrgId)
            .eq("sourceProcessId", entity.processId),
        )
        .take(LINK_CLEANUP_BATCH);
      for (const row of own) await ctx.db.delete(row._id);
    }

    if (
      inbound.length === LINK_CLEANUP_BATCH ||
      own.length === LINK_CLEANUP_BATCH
    ) {
      await ctx.scheduler.runAfter(0, internal.firmMap.deleteForEntity, args);
      return;
    }

    if (entity.kind === "process") {
      const profile = await getProfile(ctx, args.clerkOrgId, entity.processId);
      if (profile) await ctx.db.delete(profile._id);
    }
  },
});

// ---------------------------------------------------------------------------
// Owners
// ---------------------------------------------------------------------------

export const setProcessOwner = mutation({
  args: {
    processId: v.id("processes"),
    ownerMembershipId: v.union(v.id("memberships"), v.null()),
  },
  handler: async (ctx, args): Promise<void> => {
    const caller = await requireOrgAdmin(ctx);
    const process = await ctx.db.get(args.processId);
    assertOrgOwns(caller, process);

    if (args.ownerMembershipId !== null) {
      const membership = await ctx.db.get(args.ownerMembershipId);
      if (
        !isActiveMembership(membership) ||
        membership.clerkOrgId !== caller.orgId
      ) {
        throw new Error("Not found");
      }
    }
    await ctx.db.patch(process._id, {
      ownerMembershipId: args.ownerMembershipId ?? undefined,
    });
  },
});

export const listOwnerCandidates = query({
  args: {},
  handler: async (ctx) => {
    const caller = await requireOrgAdmin(ctx);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", caller.orgId))
      .take(1000);
    const active = memberships.filter((m) => isActiveMembership(m));
    const rows = await Promise.all(
      active.map(async (m) => {
        const user = m.name ? null : await ctx.db.get(m.userId);
        return {
          membershipId: m._id,
          name: m.name ?? user?.name ?? m.email ?? "Unknown",
          jobTitle: m.jobTitle ?? user?.jobTitle ?? null,
        };
      }),
    );
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

export const getFirmMap = query({
  args: {},
  handler: async (ctx) => {
    const caller = await requireOrgMember(ctx);

    const functions = sortBySortOrder(
      await ctx.db
        .query("functions")
        .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", caller.orgId))
        .take(MAX_FUNCTIONS),
    );
    const departments = sortBySortOrder(
      await ctx.db
        .query("departments")
        .withIndex("by_clerkOrgId_and_functionId", (q) =>
          q.eq("clerkOrgId", caller.orgId),
        )
        .take(MAX_DEPARTMENTS),
    );
    const processes = sortBySortOrder(
      await ctx.db
        .query("processes")
        .withIndex("by_clerkOrgId_and_departmentId", (q) =>
          q.eq("clerkOrgId", caller.orgId),
        )
        .take(MAX_PROCESSES),
    );
    const profiles = await ctx.db
      .query("firmProcessProfiles")
      .withIndex("by_clerkOrgId_and_processId", (q) =>
        q.eq("clerkOrgId", caller.orgId),
      )
      .take(MAX_PROCESSES);
    const links = await ctx.db
      .query("firmLinks")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", caller.orgId))
      .take(MAX_LINKS);

    const ownerIds = Array.from(
      new Set(
        processes
          .map((p) => p.ownerMembershipId)
          .filter((id): id is Id<"memberships"> => id !== undefined),
      ),
    );
    const owners = new Map<
      Id<"memberships">,
      { name: string; jobTitle: string | null }
    >();
    for (const id of ownerIds) {
      const membership = await ctx.db.get(id);
      if (!isActiveMembership(membership)) continue;
      if (membership.clerkOrgId !== caller.orgId) continue;
      const user = membership.name ? null : await ctx.db.get(membership.userId);
      owners.set(id, {
        name: membership.name ?? user?.name ?? membership.email ?? "Unknown",
        jobTitle: membership.jobTitle ?? user?.jobTitle ?? null,
      });
    }

    const profileByProcess = new Map(profiles.map((p) => [p.processId, p]));
    const functionIds = new Set<string>(functions.map((fn) => fn._id));
    const departmentIds = new Set<string>(
      departments
        .filter((department) => functionIds.has(department.functionId))
        .map((department) => department._id),
    );
    const processIds = new Set<string>(
      processes
        .filter((p) => departmentIds.has(p.departmentId))
        .map((p) => p._id),
    );

    // A cascade runs after the delete that triggers it, so a link can briefly
    // point at something already gone. Dropped here rather than drawn as an
    // edge to nowhere.
    const endpointExists = (link: Doc<"firmLinks">) => {
      if (!processIds.has(link.sourceProcessId)) return false;
      switch (link.counterparty.kind) {
        case "process":
          return processIds.has(link.counterparty.processId);
        case "department":
          return departmentIds.has(link.counterparty.departmentId);
        case "function":
          return functionIds.has(link.counterparty.functionId);
        case "external":
          return true;
      }
    };

    const statusCounts = { queued: 0, resolving: 0, ready: 0, failed: 0 };
    for (const profile of profiles) statusCounts[profile.status] += 1;

    return {
      canManage: caller.role === "admin",
      truncated: {
        processes: processes.length === MAX_PROCESSES,
        links: links.length === MAX_LINKS,
      },
      resolution: {
        ...statusCounts,
        lastResolvedAt: profiles.reduce<number | null>(
          (latest, p) =>
            p.resolvedAt !== undefined && (latest === null || p.resolvedAt > latest)
              ? p.resolvedAt
              : latest,
          null,
        ),
      },
      functions: functions.map((fn) => ({ _id: fn._id, name: fn.name })),
      departments: departments
        .filter((department) => departmentIds.has(department._id))
        .map((department) => ({
          _id: department._id,
          functionId: department.functionId,
          name: department.name,
        })),
      processes: processes
        .filter((p) => processIds.has(p._id))
        .map((p) => {
          const profile = profileByProcess.get(p._id);
          // A removed owner's membership no longer resolves, and reads as unowned.
          const owner =
            p.ownerMembershipId !== undefined
              ? owners.get(p.ownerMembershipId)
              : undefined;
          return {
            _id: p._id,
            departmentId: p.departmentId,
            name: p.name,
            owner: owner
              ? { membershipId: p.ownerMembershipId!, ...owner }
              : null,
            mapped: profile?.status === "ready",
            resolutionStatus: profile?.status ?? null,
            roles: profile?.roles ?? [],
          };
        }),
      links: links
        .filter((link) => link.review !== "rejected" && endpointExists(link))
        .map((link) => ({
          _id: link._id,
          sourceProcessId: link.sourceProcessId,
          direction: link.direction,
          counterparty: link.counterparty,
          counterpartyKey: link.counterpartyKey,
          kind: link.kind,
          label: link.label,
          nodeIds: link.nodeIds,
          evidence: link.evidence,
          contributors: link.contributors,
          confidence: link.confidence,
          origin: link.origin,
          review: link.review,
        })),
    };
  },
});

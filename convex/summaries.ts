import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import {
  assertOrgOwns,
  requireOrgContributor,
  requireOrgMember,
} from "./lib/orgAuth";
import {
  getSummaryEntityKey,
  isEmptySourceFailure,
  readCompatibleSummary,
  summaryEntityRefValidator,
  type SummaryCompatibilityRead,
  type SummaryEntityRef,
  type SummaryOverviewResponse,
  type SummaryOverviewState,
} from "./summaryV2";
import { requestProcessEvidenceRefreshForOrg } from "./summaryEvidence";
import {
  departmentState,
  processState,
  requestDepartmentSummaryV2ForOrg,
  requestFunctionSummaryV2ForOrg,
} from "./hierarchySummaryV2";
import { isUsableHierarchyChild } from "./lib/hierarchyOverviewV2";

const SUMMARY_PIPELINE_STALE_MS = 10 * 60_000;

type SummaryOwner =
  | { kind: "process"; doc: Doc<"processes"> }
  | { kind: "department"; doc: Doc<"departments"> }
  | { kind: "function"; doc: Doc<"functions"> };

type SummaryRefreshResult = {
  status: "current" | "scheduled" | "coalesced";
  scheduled: boolean;
};

async function getSummaryOwner(
  ctx: Pick<QueryCtx, "db">,
  orgId: string,
  entity: SummaryEntityRef,
): Promise<SummaryOwner> {
  if (entity.kind === "process") {
    const doc = await ctx.db.get(entity.processId);
    assertOrgOwns({ orgId }, doc);
    return { kind: "process", doc };
  }
  if (entity.kind === "department") {
    const doc = await ctx.db.get(entity.departmentId);
    assertOrgOwns({ orgId }, doc);
    return { kind: "department", doc };
  }
  const doc = await ctx.db.get(entity.functionId);
  assertOrgOwns({ orgId }, doc);
  return { kind: "function", doc };
}

function hasLiveTimestamp(value: number | undefined, now: number): boolean {
  return value !== undefined && now - value < SUMMARY_PIPELINE_STALE_MS;
}

function hasActiveSummaryWork(
  owner: SummaryOwner,
  run: Doc<"summaryRuns"> | null,
  now = Date.now(),
): boolean {
  if (run?.state === "queued" || run?.state === "running") return true;
  if (owner.kind === "process") {
    return (
      hasLiveTimestamp(owner.doc.summaryEvidenceRefreshScheduledAt, now) ||
      hasLiveTimestamp(owner.doc.summaryRegenScheduledAt, now)
    );
  }
  return hasLiveTimestamp(owner.doc.summaryRegenScheduledAt, now);
}

function hasCurrentV2Artifact(owner: SummaryOwner): boolean {
  if (!owner.doc.summaryV2) return false;
  if (owner.kind === "process") {
    return (
      owner.doc.summaryV2SourceRevision ===
      (owner.doc.summaryEvidenceRevision ?? 0)
    );
  }
  return (
    owner.doc.summaryStale !== true &&
    owner.doc.summaryV2SourceRevision === (owner.doc.summarySourceRevision ?? 0)
  );
}

function hasStaleArtifact(owner: SummaryOwner): boolean {
  if (owner.kind === "process") {
    return (
      // The flag is authoritative and covers a legacy-only row, whose staleness
      // cannot be derived from the V2 revision pair.
      owner.doc.summaryStale === true ||
      Boolean(
        owner.doc.summaryV2 &&
          owner.doc.summaryV2SourceRevision !==
            (owner.doc.summaryEvidenceRevision ?? 0),
      )
    );
  }
  return (
    owner.doc.summaryStale === true ||
    Boolean(
      owner.doc.summaryV2 &&
        owner.doc.summaryV2SourceRevision !==
          (owner.doc.summarySourceRevision ?? 0),
    )
  );
}

function ownerRunId(owner: SummaryOwner): Id<"summaryRuns"> | undefined {
  return owner.doc.summaryV2RunId;
}

function ownerLastRunState(owner: SummaryOwner) {
  return owner.doc.summaryV2LastRunState;
}

function ownerLastError(owner: SummaryOwner) {
  return owner.doc.summaryV2LastError ?? null;
}

function ownerLegacyMarkdown(owner: SummaryOwner): string | null {
  return owner.kind === "process"
    ? (owner.doc.rollingSummary ?? null)
    : (owner.doc.summary ?? null);
}

function overviewRefreshKey(owner: SummaryOwner): string {
  if (owner.kind === "process") {
    return [
      owner.doc.summaryEvidenceRevision ?? 0,
      owner.doc.summaryV2SourceRevision ?? "none",
      owner.doc.summaryEvidenceRefreshGenerationId ?? "idle",
      owner.doc.summaryV2GenerationId ?? "idle",
    ].join(":");
  }
  return [
    owner.doc.summarySourceRevision ?? 0,
    owner.doc.summaryV2SourceRevision ?? "none",
    owner.doc.summaryStale === true ? "stale" : "settled",
    owner.doc.summaryV2GenerationId ?? "idle",
  ].join(":");
}

async function getRelevantRun(
  ctx: Pick<QueryCtx, "db">,
  orgId: string,
  entity: SummaryEntityRef,
  runId: Id<"summaryRuns"> | undefined,
): Promise<Doc<"summaryRuns"> | null> {
  const entityKey = getSummaryEntityKey(entity);
  if (runId) {
    const run = await ctx.db.get(runId);
    if (run?.clerkOrgId === orgId && run.entityKey === entityKey) return run;
  }

  const terminalRuns: Doc<"summaryRuns">[] = [];
  for (const state of ["succeeded", "partial", "failed"] as const) {
    const run = await ctx.db
      .query("summaryRuns")
      .withIndex(
        "by_clerkOrgId_and_entityKey_and_state_and_createdAt",
        (q) =>
          q
            .eq("clerkOrgId", orgId)
            .eq("entityKey", entityKey)
            .eq("state", state),
      )
      .order("desc")
      .first();
    if (run) terminalRuns.push(run);
  }
  terminalRuns.sort((a, b) => b.createdAt - a.createdAt);
  return terminalRuns[0] ?? null;
}

function runMatchesCurrentSource(
  owner: SummaryOwner,
  run: Doc<"summaryRuns"> | null,
): boolean {
  if (run?.sourceRevision === undefined) return false;
  const currentRevision =
    owner.kind === "process"
      ? (owner.doc.summaryEvidenceRevision ?? 0)
      : (owner.doc.summarySourceRevision ?? 0);
  return run.sourceRevision === currentRevision;
}

function flowGenerationStatus(flow: Doc<"processFlows"> | null) {
  if (!flow) return "idle" as const;
  return flow.status;
}

function insightsGenerationStatus(flow: Doc<"processFlows"> | null) {
  if (!flow) return "idle" as const;
  if (flow.status === "generating") return "generating" as const;
  if (flow.status === "failed") return "failed" as const;
  if (flow.generationVersion === undefined) return "ready" as const;
  if (flow.detailsStatus === "pending" || flow.detailsStatus === "generating") {
    return "generating" as const;
  }
  if (flow.detailsStatus === "failed") return "failed" as const;
  return "ready" as const;
}

function deriveOverviewState(
  owner: SummaryOwner,
  run: Doc<"summaryRuns"> | null,
  content: SummaryCompatibilityRead,
  hasEligibleSource: boolean,
): SummaryOverviewState {
  if (hasActiveSummaryWork(owner, run)) return "refreshing";
  const lastSuccessfulGenerationAt =
    content.format === "v2"
      ? content.artifact.provenance.generatedAt
      : content.format === "legacy"
        ? (owner.doc.summaryUpdatedAt ?? null)
        : null;
  const failure =
    run?.state === "failed"
      ? {
          completedAt: run.completedAt ?? run.createdAt,
          error: run.error ?? ownerLastError(owner),
        }
      : ownerLastRunState(owner) === "failed"
        ? {
            completedAt: owner.doc.summaryV2LastCompletedAt ?? null,
            error: ownerLastError(owner),
          }
        : null;
  const failureCompletedAt = failure?.completedAt ?? null;
  if (
    failureCompletedAt !== null &&
    (lastSuccessfulGenerationAt === null ||
      failureCompletedAt >= lastSuccessfulGenerationAt) &&
    !isEmptySourceFailure(failure?.error ?? null, hasEligibleSource)
  ) {
    return "failed";
  }
  if (content.format === "none") return "missing";
  if (hasStaleArtifact(owner)) return "stale";
  if (content.format === "v2" && !content.artifact.coverage.complete) {
    return "partial";
  }
  return "current";
}

/**
 * Whether a rebuild has any input the stored overview has not already read.
 *
 * Generation is the expensive step, and the control that spends it used to be
 * live unconditionally: a `current` overview could be rebuilt any number of
 * times, each pass paying full token cost to re-derive the same brief from the
 * same evidence. A rebuild is offered only where it can change the answer —
 * nothing generated yet, evidence recorded since the last pass, a failed run to
 * retry, or a legacy row that has never been built in the structured format.
 *
 * The other half of the same question is whether there is any input at all. A
 * process reduces completed conversations and a rollup reduces child overviews,
 * so one holding neither cannot produce an overview by any amount of pressing —
 * the run would scan zero sources and record a failure. That is a state to
 * explain at the control, not to discover by spending a generation on it.
 */
function overviewRefreshAvailable(
  entityKind: SummaryEntityRef["kind"],
  state: SummaryOverviewState,
  content: SummaryCompatibilityRead,
  hasEligibleSource: boolean,
): boolean {
  // A run already in flight is the rebuild; there is nothing to start.
  if (state === "refreshing") return false;
  // Applies at every other state, not just `missing`: a built process whose
  // conversations were all deleted has an artifact and no way to rebuild it,
  // and a legacy row with no source cannot migrate either.
  if (!hasEligibleSource) return false;
  if (state === "partial") {
    // Partial coverage means different things at the two levels, and only one
    // of them is unread input.
    //
    // A process excludes conversations whose evidence extraction did not land.
    // Extraction re-runs inside the rebuild, so pressing it can genuinely pull
    // those conversations in — the control stays live.
    //
    // A rollup excludes children that hold no current overview of their own,
    // including a process nobody has recorded a conversation for yet. Rebuilding
    // the parent cannot read those children; only building the child can, and
    // that bumps this row's source revision, which surfaces here as `stale`.
    // Left live, a department with one conversation-less process would offer an
    // endless rollup that returns the same brief every time.
    return entityKind === "process";
  }
  if (state !== "current") return true;
  // A legacy-only row reads as current because nothing has changed under it,
  // but it holds no structured artifact — the rebuild is how it migrates.
  return content.format !== "v2";
}

export type OverviewSnapshot = {
  owner: SummaryOwner;
  run: Doc<"summaryRuns"> | null;
  content: SummaryCompatibilityRead;
  state: SummaryOverviewState;
  hasEligibleSource: boolean;
};

/**
 * Whether the process holds a source a generation could read.
 *
 * The same filter the source scan applies — a conversation is evidence only
 * once it is `done` — asked with a single bounded read, so the gate and the scan
 * cannot disagree about whether there is anything to build from.
 */
async function processHasEligibleSource(
  ctx: Pick<QueryCtx, "db">,
  orgId: string,
  processId: Id<"processes">,
): Promise<boolean> {
  const first = await ctx.db
    .query("conversations")
    .withIndex("by_clerkOrgId_and_processId_and_status", (q) =>
      q
        .eq("clerkOrgId", orgId)
        .eq("processId", processId)
        .eq("status", "done"),
    )
    .first();
  return first !== null;
}

/**
 * How many children the rollup gate will look at before it stops asking.
 *
 * A readable child cannot be selected by an index — it is a computed state over
 * several fields — so the answer costs a scan of the children. The cap keeps
 * that read bounded on any org shape; the scan itself paginates children the
 * same way.
 */
const ROLLUP_CHILD_SCAN_CAP = 200;

/**
 * Whether a rollup holds a child overview a generation could read.
 *
 * `isUsableHierarchyChild` is the same predicate the rollup scan selects
 * sources with, so the gate and the scan agree on what counts: a child holding
 * an artifact that is neither stale nor mid-refresh. A child that has never
 * been built, or whose evidence moved on since, is not a source — building the
 * child is what makes it one.
 */
async function rollupHasReadableChild(
  ctx: Pick<QueryCtx, "db">,
  orgId: string,
  owner: Extract<SummaryOwner, { kind: "department" | "function" }>,
): Promise<boolean> {
  const states =
    owner.kind === "department"
      ? (
          await ctx.db
            .query("processes")
            .withIndex("by_clerkOrgId_and_departmentId", (q) =>
              q.eq("clerkOrgId", orgId).eq("departmentId", owner.doc._id),
            )
            .take(ROLLUP_CHILD_SCAN_CAP + 1)
        ).map(processState)
      : (
          await ctx.db
            .query("departments")
            .withIndex("by_clerkOrgId_and_functionId", (q) =>
              q.eq("clerkOrgId", orgId).eq("functionId", owner.doc._id),
            )
            .take(ROLLUP_CHILD_SCAN_CAP + 1)
        ).map(departmentState);
  if (states.slice(0, ROLLUP_CHILD_SCAN_CAP).some(isUsableHierarchyChild)) {
    return true;
  }
  // The cap was reached without finding one, so the answer is unknown rather
  // than no. The gate stays open on a subtree it did not finish reading: a
  // refused rebuild that should have run is worse than one wasted scan.
  return states.length > ROLLUP_CHILD_SCAN_CAP;
}

/**
 * The one read behind both the overview surface and the rebuild gate, so the
 * disabled control and the refused mutation can never disagree about whether
 * an overview has anything left to build from. AskFabric's overview tool reads
 * through it too, so the agent sees exactly what the overview page shows.
 */
export async function readOverviewSnapshot(
  ctx: Pick<QueryCtx, "db">,
  orgId: string,
  entity: SummaryEntityRef,
): Promise<OverviewSnapshot> {
  const owner = await getSummaryOwner(ctx, orgId, entity);
  const run = await getRelevantRun(ctx, orgId, entity, ownerRunId(owner));
  const content = readCompatibleSummary({
    summaryV2: owner.doc.summaryV2,
    // Only read for a row that has an old-format summary and no artifact.
    legacyMarkdown: ownerLegacyMarkdown(owner),
  });
  // Each level asks the question its own scan would: a process looks for a
  // completed conversation, a rollup for a child holding a readable overview.
  const hasEligibleSource =
    owner.kind === "process"
      ? await processHasEligibleSource(ctx, orgId, owner.doc._id)
      : await rollupHasReadableChild(ctx, orgId, owner);
  return {
    owner,
    run,
    content,
    state: deriveOverviewState(owner, run, content, hasEligibleSource),
    hasEligibleSource,
  };
}

async function requestSummaryRefresh(
  ctx: MutationCtx,
  orgId: string,
  actorUserId: Id<"users">,
  entity: SummaryEntityRef,
  forceRefresh: boolean,
): Promise<SummaryRefreshResult> {
  const { owner, run, content, state, hasEligibleSource } =
    await readOverviewSnapshot(ctx, orgId, entity);

  const active = hasActiveSummaryWork(owner, run);
  if (!forceRefresh && active) {
    return { status: "coalesced", scheduled: false };
  }
  // The same gate the surface disables its control on, enforced where the spend
  // actually starts. `forceRefresh` overrides coalescing, not arithmetic: an
  // overview holding every available source has nothing to rebuild from, and a
  // second pass would bill a full generation for the same brief. An in-flight
  // run is excluded here — it is reported by the coalescing paths instead.
  if (
    !active &&
    !overviewRefreshAvailable(entity.kind, state, content, hasEligibleSource)
  ) {
    return { status: "current", scheduled: false };
  }
  if (!forceRefresh && hasCurrentV2Artifact(owner)) {
    return { status: "current", scheduled: false };
  }
  if (
    !forceRefresh &&
    run?.state === "failed" &&
    runMatchesCurrentSource(owner, run)
  ) {
    return { status: "coalesced", scheduled: false };
  }

  const result =
    entity.kind === "process"
      ? await requestProcessEvidenceRefreshForOrg(ctx, {
          processId: entity.processId,
          clerkOrgId: orgId,
        })
      : entity.kind === "department"
        ? await requestDepartmentSummaryV2ForOrg(ctx, {
            departmentId: entity.departmentId,
            clerkOrgId: orgId,
            forceRefresh,
            actorUserId,
          })
        : await requestFunctionSummaryV2ForOrg(ctx, {
            functionId: entity.functionId,
            clerkOrgId: orgId,
            forceRefresh,
            actorUserId,
          });
  return {
    status: result.scheduled ? "scheduled" : "coalesced",
    scheduled: result.scheduled,
  };
}

/** One bounded read model for process, department, and function overviews. */
export const getOverview = query({
  args: { entity: summaryEntityRefValidator },
  handler: async (ctx, args): Promise<SummaryOverviewResponse> => {
    const caller = await requireOrgMember(ctx);
    const { owner, run, content, state, hasEligibleSource } =
      await readOverviewSnapshot(ctx, caller.orgId, args.entity);
    const flow =
      owner.kind === "process"
        ? ((await ctx.db
            .query("processFlows")
            .withIndex("by_clerkOrgId_and_processId", (q) =>
              q
                .eq("clerkOrgId", caller.orgId)
                .eq("processId", owner.doc._id),
            )
            .first()) ?? null)
        : null;
    const hasFlowArtifact = flow !== null && flow.nodes.length > 0;

    return {
      entity: args.entity,
      refreshKey: overviewRefreshKey(owner),
      state,
      refreshAvailable: overviewRefreshAvailable(
        args.entity.kind,
        state,
        content,
        hasEligibleSource,
      ),
      hasEvidenceSource: hasEligibleSource,
      content,
      coverage: content.format === "v2" ? content.artifact.coverage : null,
      lastSuccessfulGenerationAt:
        content.format === "v2"
          ? content.artifact.provenance.generatedAt
          : content.format === "legacy"
            ? (owner.doc.summaryUpdatedAt ?? null)
            : null,
      progress: run?.progress ?? null,
      error:
        state === "failed" ? (run?.error ?? ownerLastError(owner)) : null,
      flow:
        owner.kind === "process"
          ? {
              available: hasFlowArtifact,
              stale: flow?.stale ?? false,
              generationStatus: flowGenerationStatus(flow),
            }
          : null,
      insights:
        owner.kind === "process"
          ? {
              available: hasFlowArtifact,
              stale: flow?.stale ?? false,
              generationStatus: insightsGenerationStatus(flow),
            }
          : null,
    };
  },
});

/** Non-forcing refresh-on-view entrypoint for every authenticated org member. */
export const ensureCurrent = mutation({
  args: { entity: summaryEntityRefValidator },
  handler: async (ctx, args): Promise<SummaryRefreshResult> => {
    const caller = await requireOrgMember(ctx);
    return await requestSummaryRefresh(
      ctx,
      caller.orgId,
      caller.userId,
      args.entity,
      false,
    );
  },
});

/** Explicit regeneration entrypoint; authorization stays contributor-only. */
export const forceRefresh = mutation({
  args: { entity: summaryEntityRefValidator },
  handler: async (ctx, args): Promise<SummaryRefreshResult> => {
    const caller = await requireOrgContributor(ctx);
    return await requestSummaryRefresh(
      ctx,
      caller.orgId,
      caller.userId,
      args.entity,
      true,
    );
  },
});

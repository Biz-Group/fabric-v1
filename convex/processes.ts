import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import {
  buildSafeDescriptionFields,
  classifyDescriptionSafety,
  DescriptionSafetyRisk,
  normalizeDescriptionInput,
} from "./descriptionSafety";
import {
  assertOrgOwns,
  requireOrgContributor,
  requireOrgMember,
  resolveOrgForAction,
} from "./lib/orgAuth";

type DescriptionUpdate =
  | { kind: "unchanged" }
  | { kind: "clear" }
  | {
      kind: "set";
      description: string;
      descriptionSafetyStatus: "safe";
      descriptionSafetyCheckedAt: number;
      descriptionSafetyModel: string;
      descriptionSafetyPromptVersion: string;
      descriptionSafetyRisk: DescriptionSafetyRisk;
      descriptionSafetyReason: string;
    };

const descriptionUpdateValidator = v.union(
  v.object({ kind: v.literal("unchanged") }),
  v.object({ kind: v.literal("clear") }),
  v.object({
    kind: v.literal("set"),
    description: v.string(),
    descriptionSafetyStatus: v.literal("safe"),
    descriptionSafetyCheckedAt: v.number(),
    descriptionSafetyModel: v.string(),
    descriptionSafetyPromptVersion: v.string(),
    descriptionSafetyRisk: v.union(
      v.literal("none"),
      v.literal("prompt_injection"),
      v.literal("agent_instruction"),
      v.literal("policy_override"),
      v.literal("sensitive_data_request"),
      v.literal("malicious_or_abusive"),
      v.literal("irrelevant"),
    ),
    descriptionSafetyReason: v.string(),
  }),
);

function applyDescriptionUpdate(
  patch: Record<string, unknown>,
  descriptionUpdate: DescriptionUpdate,
) {
  if (descriptionUpdate.kind === "unchanged") return;
  if (descriptionUpdate.kind === "clear") {
    patch.description = undefined;
    patch.descriptionSafetyStatus = undefined;
    patch.descriptionSafetyCheckedAt = undefined;
    patch.descriptionSafetyModel = undefined;
    patch.descriptionSafetyPromptVersion = undefined;
    patch.descriptionSafetyRisk = undefined;
    patch.descriptionSafetyReason = undefined;
    return;
  }

  patch.description = descriptionUpdate.description;
  patch.descriptionSafetyStatus = descriptionUpdate.descriptionSafetyStatus;
  patch.descriptionSafetyCheckedAt = descriptionUpdate.descriptionSafetyCheckedAt;
  patch.descriptionSafetyModel = descriptionUpdate.descriptionSafetyModel;
  patch.descriptionSafetyPromptVersion =
    descriptionUpdate.descriptionSafetyPromptVersion;
  patch.descriptionSafetyRisk = descriptionUpdate.descriptionSafetyRisk;
  patch.descriptionSafetyReason = descriptionUpdate.descriptionSafetyReason;
}

async function buildDescriptionUpdate(
  description: string | undefined,
  current: Pick<Doc<"processes">, "description" | "descriptionSafetyStatus"> | null,
): Promise<DescriptionUpdate> {
  if (description === undefined) return { kind: "unchanged" };

  const normalized = normalizeDescriptionInput(description);
  if (normalized.kind === "empty") return { kind: "clear" };

  if (
    current?.description === normalized.value &&
    current.descriptionSafetyStatus === "safe"
  ) {
    return { kind: "unchanged" };
  }

  const decision = await classifyDescriptionSafety(
    normalized.value,
    process.env.OPENROUTER_API_KEY,
  );
  return { kind: "set", ...buildSafeDescriptionFields(normalized.value, decision) };
}

export const listByDepartment = query({
  args: { departmentId: v.id("departments") },
  handler: async (ctx, args) => {
    const caller = await requireOrgMember(ctx);
    const parent = await ctx.db.get(args.departmentId);
    if (!parent || parent.clerkOrgId !== caller.orgId) return [];
    return await ctx.db
      .query("processes")
      .withIndex("by_clerkOrgId_and_departmentId", (q) =>
        q
          .eq("clerkOrgId", caller.orgId)
          .eq("departmentId", args.departmentId),
      )
      .order("asc")
      .collect();
  },
});

export const get = query({
  args: { processId: v.id("processes") },
  handler: async (ctx, args) => {
    const caller = await requireOrgMember(ctx);
    const doc = await ctx.db.get(args.processId);
    if (!doc || doc.clerkOrgId !== caller.orgId) return null;
    return doc;
  },
});

export const create = action({
  args: {
    departmentId: v.id("departments"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"processes">> => {
    const { orgId } = await resolveOrgForAction(ctx);
    await ctx.runQuery(internal.postCall.requireOrgContributorInternal, {});
    const parentExists: boolean = await ctx.runQuery(
      internal.processes.departmentExistsInOrg,
      { departmentId: args.departmentId, clerkOrgId: orgId },
    );
    if (!parentExists) throw new Error("Not found");
    const descriptionUpdate = await buildDescriptionUpdate(args.description, null);
    return await ctx.runMutation(internal.processes.createInternal, {
      departmentId: args.departmentId,
      name: args.name,
      clerkOrgId: orgId,
      descriptionUpdate,
    });
  },
});

export const departmentExistsInOrg = internalQuery({
  args: { departmentId: v.id("departments"), clerkOrgId: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const dept = await ctx.db.get(args.departmentId);
    return !!dept && dept.clerkOrgId === args.clerkOrgId;
  },
});

export const createInternal = internalMutation({
  args: {
    departmentId: v.id("departments"),
    name: v.string(),
    clerkOrgId: v.string(),
    descriptionUpdate: descriptionUpdateValidator,
  },
  handler: async (ctx, args): Promise<Id<"processes">> => {
    const parentDepartment = await ctx.db.get(args.departmentId);
    if (!parentDepartment || parentDepartment.clerkOrgId !== args.clerkOrgId) {
      throw new Error("Not found");
    }

    const existing = await ctx.db
      .query("processes")
      .withIndex("by_clerkOrgId_and_departmentId", (q) =>
        q
          .eq("clerkOrgId", args.clerkOrgId)
          .eq("departmentId", args.departmentId),
      )
      .order("desc")
      .take(1);
    const maxSortOrder = existing.length > 0 ? existing[0].sortOrder : 0;
    const row = {
      departmentId: args.departmentId,
      name: args.name,
      sortOrder: maxSortOrder + 1,
      clerkOrgId: args.clerkOrgId,
    };
    const descriptionFields =
      args.descriptionUpdate.kind === "set"
        ? {
            description: args.descriptionUpdate.description,
            descriptionSafetyStatus:
              args.descriptionUpdate.descriptionSafetyStatus,
            descriptionSafetyCheckedAt:
              args.descriptionUpdate.descriptionSafetyCheckedAt,
            descriptionSafetyModel: args.descriptionUpdate.descriptionSafetyModel,
            descriptionSafetyPromptVersion:
              args.descriptionUpdate.descriptionSafetyPromptVersion,
            descriptionSafetyRisk: args.descriptionUpdate.descriptionSafetyRisk,
            descriptionSafetyReason:
              args.descriptionUpdate.descriptionSafetyReason,
          }
        : {};
    const id = await ctx.db.insert("processes", {
      ...row,
      ...descriptionFields,
    });
    // Mark department summary as stale (cascades to function)
    await ctx.runMutation(internal.summariesHelpers.markDepartmentSummaryStale, {
      departmentId: args.departmentId,
    });
    return id;
  },
});

export const update = action({
  args: {
    processId: v.id("processes"),
    name: v.string(),
    departmentId: v.optional(v.id("departments")),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    const { orgId } = await resolveOrgForAction(ctx);
    await ctx.runQuery(internal.postCall.requireOrgContributorInternal, {});
    const proc: Doc<"processes"> | null = await ctx.runQuery(
      internal.processes.getForDescriptionUpdate,
      { processId: args.processId, clerkOrgId: orgId },
    );
    if (!proc) throw new Error("Not found");

    const descriptionUpdate = await buildDescriptionUpdate(
      args.description,
      proc,
    );

    await ctx.runMutation(internal.processes.updateInternal, {
      processId: args.processId,
      name: args.name,
      departmentId: args.departmentId,
      clerkOrgId: orgId,
      descriptionUpdate,
    });
    return null;
  },
});

export const getForDescriptionUpdate = internalQuery({
  args: { processId: v.id("processes"), clerkOrgId: v.string() },
  handler: async (ctx, args) => {
    const proc = await ctx.db.get(args.processId);
    if (!proc || proc.clerkOrgId !== args.clerkOrgId) return null;
    return proc;
  },
});

export const updateInternal = internalMutation({
  args: {
    processId: v.id("processes"),
    name: v.string(),
    departmentId: v.optional(v.id("departments")),
    clerkOrgId: v.string(),
    descriptionUpdate: descriptionUpdateValidator,
  },
  handler: async (ctx, args) => {
    const proc = await ctx.db.get(args.processId);
    if (!proc || proc.clerkOrgId !== args.clerkOrgId) {
      throw new Error("Not found");
    }

    const patch: Record<string, unknown> = { name: args.name };
    const isMoving =
      args.departmentId !== undefined &&
      args.departmentId !== proc.departmentId;

    if (isMoving) {
      const targetDepartment = await ctx.db.get(args.departmentId!);
      if (!targetDepartment || targetDepartment.clerkOrgId !== args.clerkOrgId) {
        throw new Error("Not found");
      }
      const existing = await ctx.db
        .query("processes")
        .withIndex("by_clerkOrgId_and_departmentId", (q) =>
          q
            .eq("clerkOrgId", args.clerkOrgId)
            .eq("departmentId", args.departmentId!),
        )
        .order("desc")
        .take(1);
      patch.departmentId = args.departmentId;
      patch.sortOrder = (existing.length > 0 ? existing[0].sortOrder : 0) + 1;
    }

    applyDescriptionUpdate(patch, args.descriptionUpdate);
    await ctx.db.patch(args.processId, patch);

    if (isMoving) {
      const previousDepartment = await ctx.db.get(proc.departmentId);
      // Check if old department still has processes with summaries
      const remaining = await ctx.db
        .query("processes")
        .withIndex("by_clerkOrgId_and_departmentId", (q) =>
          q
            .eq("clerkOrgId", args.clerkOrgId)
            .eq("departmentId", proc.departmentId),
        )
        .collect();
      const hasSummaries = remaining.some((p) => p.rollingSummary);
      if (previousDepartment && (remaining.length === 0 || !hasSummaries)) {
        await ctx.db.patch(proc.departmentId, {
          summary: undefined,
          summaryUpdatedAt: undefined,
          summaryStale: undefined,
        });
        await ctx.runMutation(
          internal.summariesHelpers.markFunctionSummaryStale,
          { functionId: previousDepartment.functionId },
        );
      } else if (previousDepartment) {
        await ctx.runMutation(
          internal.summariesHelpers.markDepartmentSummaryStale,
          { departmentId: proc.departmentId },
        );
      }
      // Mark new parent department stale
      await ctx.runMutation(internal.summariesHelpers.markDepartmentSummaryStale, {
        departmentId: args.departmentId!,
      });
    }
  },
});

export const childCount = query({
  args: { processId: v.id("processes") },
  handler: async (ctx, args) => {
    const caller = await requireOrgMember(ctx);
    const parent = await ctx.db.get(args.processId);
    assertOrgOwns(caller, parent);
    const children = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_processId", (q) =>
        q.eq("clerkOrgId", caller.orgId).eq("processId", args.processId),
      )
      .collect();
    return children.length;
  },
});

export const remove = mutation({
  args: { processId: v.id("processes") },
  handler: async (ctx, args) => {
    const caller = await requireOrgContributor(ctx);
    const process = await ctx.db.get(args.processId);
    assertOrgOwns(caller, process);

    const children = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_processId", (q) =>
        q.eq("clerkOrgId", caller.orgId).eq("processId", args.processId),
      )
      .take(1);
    if (children.length > 0) {
      throw new Error(
        "Cannot delete this process because it still has conversations. Remove all conversations first.",
      );
    }
    const departmentId = process.departmentId;
    await ctx.db.delete(args.processId);

    // Clean up department summary
    const department = await ctx.db.get(departmentId);
    const remaining = await ctx.db
      .query("processes")
      .withIndex("by_clerkOrgId_and_departmentId", (q) =>
        q.eq("clerkOrgId", caller.orgId).eq("departmentId", departmentId),
      )
      .collect();
    const hasSummaries = remaining.some((p) => p.rollingSummary);
    if (department && (remaining.length === 0 || !hasSummaries)) {
      await ctx.db.patch(departmentId, {
        summary: undefined,
        summaryUpdatedAt: undefined,
        summaryStale: undefined,
      });
      await ctx.runMutation(internal.summariesHelpers.markFunctionSummaryStale, {
        functionId: department.functionId,
      });
    } else if (department) {
      await ctx.runMutation(internal.summariesHelpers.markDepartmentSummaryStale, {
        departmentId,
      });
    }
  },
});

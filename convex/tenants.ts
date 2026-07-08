import { v } from "convex/values";
import {
  action,
  ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  MutationCtx,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { requireSuperAdmin } from "./lib/orgAuth";
import { clerkFetch, clerkUserIdFromTokenIdentifier } from "./lib/clerkApi";
import { isValidTenantSlug } from "./lib/slugs";
import {
  fanOutImpl,
  normalizeEmailDomains,
  setAllowedEmailDomainsImpl,
  type FanOutResult,
} from "./platform";
import { inviteRedirectUrl } from "./invitations";

// ---------------------------------------------------------------------------
// Platform tenant registry backing tenants.<root> (the Biz Group console).
//
// Clerk is the source of truth for organizations; the `tenants` table mirrors
// it for reactive console queries and carries provisioning state Clerk has no
// place for. Sync paths: the createTenant action (console), organization.*
// webhooks (Clerk dashboard edits), and the CLI backfill below.
//
// Every public function here is super-admin gated — this file is the backend
// of a platform surface, never a tenant surface.
// ---------------------------------------------------------------------------

const roleValidator = v.union(
  v.literal("admin"),
  v.literal("contributor"),
  v.literal("viewer"),
);

type Role = "admin" | "contributor" | "viewer";

type ClerkOrganizationResponse = {
  id: string;
  name: string;
  slug: string;
  image_url?: string | null;
  public_metadata?: Record<string, unknown> | null;
};

type ClerkOrganizationListResponse = {
  data: ClerkOrganizationResponse[];
  total_count?: number;
};

type ClerkInvitationResponse = {
  id: string;
  email_address: string;
  status: string;
  organization_id: string;
  created_at: number;
  expires_at?: number | null;
};

export function allowedDomainsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string[] {
  const raw = metadata?.allowedEmailDomains;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/** Idempotent mirror upsert from a Clerk organization. Shared by the webhook
 * handler (users.ts), the backfill, and the provisioning action. Preserves
 * console-only fields (provisioning state, createdBy) on update. */
export async function upsertTenantFromClerkOrg(
  ctx: MutationCtx,
  org: {
    clerkOrgId: string;
    name: string;
    slug: string;
    logoUrl?: string | null;
    allowedEmailDomains: string[];
  },
  source: "console" | "clerkSync",
): Promise<Id<"tenants">> {
  const existing = await ctx.db
    .query("tenants")
    .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", org.clerkOrgId))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      name: org.name,
      slug: org.slug,
      logoUrl: org.logoUrl ?? existing.logoUrl,
      allowedEmailDomains: org.allowedEmailDomains,
      // An org resurfacing from Clerk is live again regardless of prior state.
      status: existing.status === "deleted" ? "active" : existing.status,
      updatedAt: Date.now(),
    });
    return existing._id;
  }

  return await ctx.db.insert("tenants", {
    clerkOrgId: org.clerkOrgId,
    name: org.name,
    slug: org.slug,
    logoUrl: org.logoUrl ?? undefined,
    allowedEmailDomains: org.allowedEmailDomains,
    status: "active",
    source,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

/** Marks the mirror row deleted when Clerk reports the org gone. Kept (not
 * removed) for audit/history; the slug becomes reusable via Clerk anyway. */
export async function markTenantDeleted(
  ctx: MutationCtx,
  clerkOrgId: string,
): Promise<void> {
  const existing = await ctx.db
    .query("tenants")
    .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", clerkOrgId))
    .unique();
  if (existing && existing.status !== "deleted") {
    await ctx.db.patch(existing._id, {
      status: "deleted",
      updatedAt: Date.now(),
    });
  }
}

async function uploadOrgLogo(
  clerkOrgId: string,
  blob: Blob,
  uploaderClerkUserId: string,
): Promise<string | null> {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("CLERK_SECRET_KEY is not set in Convex env");

  const form = new FormData();
  form.append("file", blob, "logo");
  form.append("uploader_user_id", uploaderClerkUserId);

  const res = await fetch(
    `https://api.clerk.com/v1/organizations/${clerkOrgId}/logo`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    },
  );
  if (!res.ok) {
    throw new Error(
      `Clerk logo upload failed with ${res.status}: ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { image_url?: string | null };
  return body.image_url ?? null;
}

function isDuplicateInviteOrMemberError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("duplicate_record") ||
    message.includes("already_a_member_in_organization")
  );
}

async function createTenantInvitation(
  ctx: ActionCtx,
  args: {
    clerkOrgId: string;
    slug: string;
    email: string;
    role: Role;
    inviterClerkUserId: string;
    invitedBy: Id<"users">;
  },
): Promise<void> {
  const redirectUrl = inviteRedirectUrl(args.slug);
  const invitation = (await clerkFetch(
    `/organizations/${args.clerkOrgId}/invitations`,
    {
      method: "POST",
      body: {
        email_address: args.email,
        role: "org:member",
        inviter_user_id: args.inviterClerkUserId,
        ...(redirectUrl ? { redirect_url: redirectUrl } : {}),
      },
    },
  )) as ClerkInvitationResponse;

  await ctx.runMutation(internal.users.createMembershipIntent, {
    clerkOrgId: args.clerkOrgId,
    email: invitation.email_address,
    requestedRole: args.role,
    source: "adminInvite",
    invitedBy: args.invitedBy,
    clerkInvitationId: invitation.id,
  });
}

// --- Internal plumbing -------------------------------------------------------

export const getTenantInternal = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.tenantId);
  },
});

export const getTenantBySlugInternal = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
  },
});

export const upsertFromClerkInternal = internalMutation({
  args: {
    clerkOrgId: v.string(),
    name: v.string(),
    slug: v.string(),
    logoUrl: v.optional(v.string()),
    allowedEmailDomains: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    return await upsertTenantFromClerkOrg(ctx, args, "clerkSync");
  },
});

export const recordProvisionedTenant = internalMutation({
  args: {
    clerkOrgId: v.string(),
    name: v.string(),
    slug: v.string(),
    logoUrl: v.optional(v.string()),
    allowedEmailDomains: v.array(v.string()),
    provisioningErrors: v.array(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
    firstInviteEmail: v.optional(v.string()),
    firstInviteRole: v.optional(roleValidator),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const tenantId = await upsertTenantFromClerkOrg(
      ctx,
      {
        clerkOrgId: args.clerkOrgId,
        name: args.name,
        slug: args.slug,
        logoUrl: args.logoUrl,
        allowedEmailDomains: args.allowedEmailDomains,
      },
      "console",
    );
    await ctx.db.patch(tenantId, {
      status: args.provisioningErrors.length > 0 ? "needsAttention" : "active",
      provisioningErrors:
        args.provisioningErrors.length > 0 ? args.provisioningErrors : undefined,
      logoStorageId: args.logoStorageId,
      firstInviteEmail: args.firstInviteEmail,
      firstInviteRole: args.firstInviteRole,
      createdBy: args.createdBy,
      updatedAt: Date.now(),
    });
    return tenantId;
  },
});

export const patchTenantInternal = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    name: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
    allowedEmailDomains: v.optional(v.array(v.string())),
    provisioningErrors: v.optional(v.array(v.string())),
    clearProvisioningErrors: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) throw new Error("Tenant not found");

    const patch: Partial<Doc<"tenants">> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = args.name;
    if (args.logoUrl !== undefined) patch.logoUrl = args.logoUrl;
    if (args.logoStorageId !== undefined) patch.logoStorageId = args.logoStorageId;
    if (args.allowedEmailDomains !== undefined) {
      patch.allowedEmailDomains = args.allowedEmailDomains;
    }
    if (args.clearProvisioningErrors) {
      patch.provisioningErrors = undefined;
      patch.status = tenant.status === "needsAttention" ? "active" : tenant.status;
    } else if (args.provisioningErrors !== undefined) {
      patch.provisioningErrors =
        args.provisioningErrors.length > 0 ? args.provisioningErrors : undefined;
      patch.status =
        args.provisioningErrors.length > 0
          ? "needsAttention"
          : tenant.status === "needsAttention"
            ? "active"
            : tenant.status;
    }
    await ctx.db.patch(args.tenantId, patch);
  },
});

export const listActiveTenantsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("tenants").take(500);
    return rows
      .filter((t) => t.status !== "deleted")
      .map((t) => ({ tenantId: t._id, clerkOrgId: t.clerkOrgId, slug: t.slug }));
  },
});

// --- Console queries ---------------------------------------------------------

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);
    const rows = await ctx.db.query("tenants").order("desc").take(500);
    return await Promise.all(
      rows.map(async (tenant) => {
        const stats = await ctx.db
          .query("orgMembershipStats")
          .withIndex("by_clerkOrgId", (q) =>
            q.eq("clerkOrgId", tenant.clerkOrgId),
          )
          .unique();
        return {
          tenantId: tenant._id,
          clerkOrgId: tenant.clerkOrgId,
          name: tenant.name,
          slug: tenant.slug,
          logoUrl: tenant.logoUrl ?? null,
          allowedEmailDomains: tenant.allowedEmailDomains,
          status: tenant.status,
          provisioningErrors: tenant.provisioningErrors ?? [],
          createdAt: tenant.createdAt,
          memberCount: stats?.activeCount ?? null,
          adminCount: stats?.adminCount ?? null,
          pendingInviteCount: stats?.pendingInviteCount ?? null,
        };
      }),
    );
  },
});

export const get = query({
  // v.string() (not v.id) so a malformed URL param renders "not found"
  // instead of throwing a validator error before the page can handle it.
  args: { tenantId: v.string() },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const tenantId = ctx.db.normalizeId("tenants", args.tenantId);
    if (!tenantId) return null;
    const tenant = await ctx.db.get(tenantId);
    if (!tenant) return null;
    const stats = await ctx.db
      .query("orgMembershipStats")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", tenant.clerkOrgId))
      .unique();
    return {
      tenantId: tenant._id,
      clerkOrgId: tenant.clerkOrgId,
      name: tenant.name,
      slug: tenant.slug,
      logoUrl: tenant.logoUrl ?? null,
      allowedEmailDomains: tenant.allowedEmailDomains,
      status: tenant.status,
      provisioningErrors: tenant.provisioningErrors ?? [],
      firstInviteEmail: tenant.firstInviteEmail ?? null,
      hasRetainedLogo: tenant.logoStorageId !== undefined,
      createdAt: tenant.createdAt,
      memberCount: stats?.activeCount ?? null,
      adminCount: stats?.adminCount ?? null,
      pendingInviteCount: stats?.pendingInviteCount ?? null,
    };
  },
});

export const listTenantMembers = query({
  args: { clerkOrgId: v.string() },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .take(500);
    return memberships
      .map((m) => ({
        membershipId: m._id,
        name: m.name ?? "Unknown",
        email: m.email ?? "",
        role: m.role,
        platformRole: m.platformRole ?? null,
        createdAt: m.createdAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Console upload handoff for tenant logos: browser POSTs the file to this
 * URL, then passes the returned storageId to createTenant/updateLogo. */
export const generateLogoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

// --- Provisioning ------------------------------------------------------------

type CreateTenantResult = {
  tenantId: Id<"tenants">;
  clerkOrgId: string;
  slug: string;
  errors: string[];
};

/**
 * Creates a fully provisioned tenant:
 *   1. Clerk org (name + slug + allowedEmailDomains metadata; caller is
 *      created_by so the org always has an owner).
 *   2. Super-admin fan-out (all Biz Group super-admins become org admins).
 *   3. Optional logo upload to Clerk.
 *   4. Optional "first user" invitation with a Fabric role intent.
 * The org creation is fatal on failure; steps 2–4 are recorded per-tenant in
 * provisioningErrors and re-runnable via retryProvisioning.
 */
export const createTenant = action({
  args: {
    name: v.string(),
    slug: v.string(),
    allowedEmailDomains: v.array(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
    firstInvite: v.optional(
      v.object({ email: v.string(), role: roleValidator }),
    ),
  },
  handler: async (ctx, args): Promise<CreateTenantResult> => {
    const caller: { userId: Id<"users">; tokenIdentifier: string } =
      await ctx.runQuery(internal.platform.requireSuperAdminInternal, {});
    const callerClerkUserId = clerkUserIdFromTokenIdentifier(
      caller.tokenIdentifier,
    );

    const name = args.name.trim();
    if (!name || name.length > 120) {
      throw new Error("Tenant name is required (max 120 characters).");
    }
    const slug = args.slug.trim().toLowerCase();
    if (!isValidTenantSlug(slug)) {
      throw new Error(
        "Invalid slug: use lowercase letters, numbers and hyphens (not a reserved name).",
      );
    }
    const allowedEmailDomains = normalizeEmailDomains(args.allowedEmailDomains);

    const existingBySlug: Doc<"tenants"> | null = await ctx.runQuery(
      internal.tenants.getTenantBySlugInternal,
      { slug },
    );
    if (existingBySlug && existingBySlug.status !== "deleted") {
      throw new Error(`A tenant with slug "${slug}" already exists.`);
    }

    // Step 1 — Clerk org. Fatal on failure (nothing to roll back yet). Clerk
    // enforces slug uniqueness authoritatively.
    const organization = (await clerkFetch("/organizations", {
      method: "POST",
      body: {
        name,
        slug,
        created_by: callerClerkUserId,
        public_metadata: { allowedEmailDomains },
      },
    })) as ClerkOrganizationResponse;

    const errors: string[] = [];
    let logoUrl: string | null = organization.image_url ?? null;

    // Step 2 — staff fan-out.
    try {
      const fanOut: FanOutResult = await fanOutImpl(
        ctx,
        organization.id,
        caller.userId,
      );
      for (const apiError of fanOut.clerkApiErrors) {
        errors.push(`Staff fan-out failed for ${apiError.email}: ${apiError.message}`);
      }
    } catch (error) {
      errors.push(
        `Staff fan-out failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Step 3 — logo.
    if (args.logoStorageId) {
      try {
        const blob = await ctx.storage.get(args.logoStorageId);
        if (!blob) throw new Error("Uploaded logo file not found in storage");
        logoUrl =
          (await uploadOrgLogo(organization.id, blob, callerClerkUserId)) ??
          logoUrl;
      } catch (error) {
        errors.push(
          `Logo upload failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Step 4 — first user invitation.
    if (args.firstInvite) {
      try {
        await createTenantInvitation(ctx, {
          clerkOrgId: organization.id,
          slug,
          email: args.firstInvite.email.trim(),
          role: args.firstInvite.role,
          inviterClerkUserId: callerClerkUserId,
          invitedBy: caller.userId,
        });
      } catch (error) {
        errors.push(
          `First-user invitation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const tenantId: Id<"tenants"> = await ctx.runMutation(
      internal.tenants.recordProvisionedTenant,
      {
        clerkOrgId: organization.id,
        name: organization.name,
        slug: organization.slug,
        ...(logoUrl ? { logoUrl } : {}),
        allowedEmailDomains,
        provisioningErrors: errors,
        ...(args.logoStorageId ? { logoStorageId: args.logoStorageId } : {}),
        ...(args.firstInvite
          ? {
              firstInviteEmail: args.firstInvite.email.trim(),
              firstInviteRole: args.firstInvite.role,
            }
          : {}),
        createdBy: caller.userId,
      },
    );

    try {
      await ctx.runMutation(internal.users.rebuildOrgMembershipStats, {
        clerkOrgId: organization.id,
      });
    } catch {
      // Stats are a denormalized nicety; never fail provisioning over them.
    }

    return { tenantId, clerkOrgId: organization.id, slug, errors };
  },
});

/** Re-runs the non-fatal provisioning steps (fan-out, logo, first invite)
 * idempotently for a tenant in needsAttention state. */
export const retryProvisioning = action({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args): Promise<{ errors: string[] }> => {
    const caller: { userId: Id<"users">; tokenIdentifier: string } =
      await ctx.runQuery(internal.platform.requireSuperAdminInternal, {});
    const callerClerkUserId = clerkUserIdFromTokenIdentifier(
      caller.tokenIdentifier,
    );

    const tenant: Doc<"tenants"> | null = await ctx.runQuery(
      internal.tenants.getTenantInternal,
      { tenantId: args.tenantId },
    );
    if (!tenant || tenant.status === "deleted") {
      throw new Error("Tenant not found");
    }

    const errors: string[] = [];

    try {
      const fanOut: FanOutResult = await fanOutImpl(
        ctx,
        tenant.clerkOrgId,
        caller.userId,
      );
      for (const apiError of fanOut.clerkApiErrors) {
        errors.push(`Staff fan-out failed for ${apiError.email}: ${apiError.message}`);
      }
    } catch (error) {
      errors.push(
        `Staff fan-out failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (tenant.logoStorageId) {
      try {
        const blob = await ctx.storage.get(tenant.logoStorageId);
        if (blob) {
          const logoUrl = await uploadOrgLogo(
            tenant.clerkOrgId,
            blob,
            callerClerkUserId,
          );
          if (logoUrl) {
            await ctx.runMutation(internal.tenants.patchTenantInternal, {
              tenantId: tenant._id,
              logoUrl,
            });
          }
        }
      } catch (error) {
        errors.push(
          `Logo upload failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (tenant.firstInviteEmail && tenant.firstInviteRole) {
      try {
        await createTenantInvitation(ctx, {
          clerkOrgId: tenant.clerkOrgId,
          slug: tenant.slug,
          email: tenant.firstInviteEmail,
          role: tenant.firstInviteRole,
          inviterClerkUserId: callerClerkUserId,
          invitedBy: caller.userId,
        });
      } catch (error) {
        // Already invited or already joined counts as success on retry.
        if (!isDuplicateInviteOrMemberError(error)) {
          errors.push(
            `First-user invitation failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    await ctx.runMutation(internal.tenants.patchTenantInternal, {
      tenantId: tenant._id,
      provisioningErrors: errors,
      ...(errors.length === 0 ? { clearProvisioningErrors: true } : {}),
    });

    return { errors };
  },
});

// --- Tenant settings ----------------------------------------------------------

export const updateAllowedEmailDomains = action({
  args: { tenantId: v.id("tenants"), domains: v.array(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ allowedEmailDomains: string[] }> => {
    await ctx.runQuery(internal.platform.requireSuperAdminInternal, {});
    const tenant: Doc<"tenants"> | null = await ctx.runQuery(
      internal.tenants.getTenantInternal,
      { tenantId: args.tenantId },
    );
    if (!tenant || tenant.status === "deleted") {
      throw new Error("Tenant not found");
    }

    const result = await setAllowedEmailDomainsImpl(
      tenant.clerkOrgId,
      args.domains,
    );
    await ctx.runMutation(internal.tenants.patchTenantInternal, {
      tenantId: tenant._id,
      allowedEmailDomains: result.allowedEmailDomains,
    });
    return { allowedEmailDomains: result.allowedEmailDomains };
  },
});

/** Renames the tenant's display name. Slugs are intentionally immutable in
 * the console (changing one breaks the client's URL) — edit directly in Clerk
 * if it's ever truly needed. */
export const renameTenant = action({
  args: { tenantId: v.id("tenants"), name: v.string() },
  handler: async (ctx, args): Promise<{ name: string }> => {
    await ctx.runQuery(internal.platform.requireSuperAdminInternal, {});
    const name = args.name.trim();
    if (!name || name.length > 120) {
      throw new Error("Tenant name is required (max 120 characters).");
    }
    const tenant: Doc<"tenants"> | null = await ctx.runQuery(
      internal.tenants.getTenantInternal,
      { tenantId: args.tenantId },
    );
    if (!tenant || tenant.status === "deleted") {
      throw new Error("Tenant not found");
    }

    await clerkFetch(`/organizations/${tenant.clerkOrgId}`, {
      method: "PATCH",
      body: { name },
    });
    await ctx.runMutation(internal.tenants.patchTenantInternal, {
      tenantId: tenant._id,
      name,
    });
    return { name };
  },
});

export const updateLogo = action({
  args: { tenantId: v.id("tenants"), logoStorageId: v.id("_storage") },
  handler: async (ctx, args): Promise<{ logoUrl: string | null }> => {
    const caller: { userId: Id<"users">; tokenIdentifier: string } =
      await ctx.runQuery(internal.platform.requireSuperAdminInternal, {});
    const tenant: Doc<"tenants"> | null = await ctx.runQuery(
      internal.tenants.getTenantInternal,
      { tenantId: args.tenantId },
    );
    if (!tenant || tenant.status === "deleted") {
      throw new Error("Tenant not found");
    }

    const blob = await ctx.storage.get(args.logoStorageId);
    if (!blob) throw new Error("Uploaded logo file not found in storage");
    const logoUrl = await uploadOrgLogo(
      tenant.clerkOrgId,
      blob,
      clerkUserIdFromTokenIdentifier(caller.tokenIdentifier),
    );
    await ctx.runMutation(internal.tenants.patchTenantInternal, {
      tenantId: tenant._id,
      ...(logoUrl ? { logoUrl } : {}),
      logoStorageId: args.logoStorageId,
    });
    return { logoUrl };
  },
});

// --- Invitations (platform-scoped: caller's active org is irrelevant) --------

export const listTenantInvitations = action({
  args: { tenantId: v.id("tenants") },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      id: string;
      email: string;
      role: Role;
      status: string;
      createdAt: number;
      expiresAt: number | null;
    }>
  > => {
    await ctx.runQuery(internal.platform.requireSuperAdminInternal, {});
    const tenant: Doc<"tenants"> | null = await ctx.runQuery(
      internal.tenants.getTenantInternal,
      { tenantId: args.tenantId },
    );
    if (!tenant) throw new Error("Tenant not found");

    const response = (await clerkFetch(
      `/organizations/${tenant.clerkOrgId}/invitations`,
      { query: { status: "pending", limit: "100" } },
    )) as { data: ClerkInvitationResponse[] } | ClerkInvitationResponse[];
    const rows = Array.isArray(response) ? response : response.data;

    const intentRoles: Array<{
      clerkInvitationId: string | null;
      emailLower: string;
      requestedRole: Role;
    }> = await ctx.runQuery(internal.users.getInvitationIntentRoles, {
      clerkOrgId: tenant.clerkOrgId,
    });

    return rows
      .filter((row) => row.organization_id === tenant.clerkOrgId)
      .map((row) => ({
        id: row.id,
        email: row.email_address,
        role:
          intentRoles.find(
            (intent) =>
              intent.clerkInvitationId === row.id ||
              intent.emailLower === row.email_address.trim().toLowerCase(),
          )?.requestedRole ?? "contributor",
        status: row.status,
        createdAt: row.created_at,
        expiresAt: row.expires_at ?? null,
      }));
  },
});

export const inviteTenantUser = action({
  args: { tenantId: v.id("tenants"), email: v.string(), role: roleValidator },
  handler: async (ctx, args): Promise<void> => {
    const caller: { userId: Id<"users">; tokenIdentifier: string } =
      await ctx.runQuery(internal.platform.requireSuperAdminInternal, {});
    const tenant: Doc<"tenants"> | null = await ctx.runQuery(
      internal.tenants.getTenantInternal,
      { tenantId: args.tenantId },
    );
    if (!tenant || tenant.status === "deleted") {
      throw new Error("Tenant not found");
    }

    await createTenantInvitation(ctx, {
      clerkOrgId: tenant.clerkOrgId,
      slug: tenant.slug,
      email: args.email.trim(),
      role: args.role,
      inviterClerkUserId: clerkUserIdFromTokenIdentifier(caller.tokenIdentifier),
      invitedBy: caller.userId,
    });
  },
});

export const revokeTenantInvitation = action({
  args: { tenantId: v.id("tenants"), invitationId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const caller: { userId: Id<"users">; tokenIdentifier: string } =
      await ctx.runQuery(internal.platform.requireSuperAdminInternal, {});
    const tenant: Doc<"tenants"> | null = await ctx.runQuery(
      internal.tenants.getTenantInternal,
      { tenantId: args.tenantId },
    );
    if (!tenant) throw new Error("Tenant not found");

    const result = (await clerkFetch(
      `/organizations/${tenant.clerkOrgId}/invitations/${args.invitationId}/revoke`,
      {
        method: "POST",
        body: {
          requesting_user_id: clerkUserIdFromTokenIdentifier(
            caller.tokenIdentifier,
          ),
        },
      },
    )) as ClerkInvitationResponse;
    if (result.organization_id !== tenant.clerkOrgId) {
      throw new Error("Revoke returned a record for a different organization");
    }

    await ctx.runMutation(internal.users.markInvitationRevoked, {
      clerkOrgId: tenant.clerkOrgId,
      clerkInvitationId: args.invitationId,
    });
  },
});

// --- Staff sync ---------------------------------------------------------------

/** Fan out all super-admins to every non-deleted tenant. Used from the
 * console's Team page after promoting someone. */
export const fanOutToAllTenants = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ tenantsProcessed: number; errors: string[] }> => {
    const caller: { userId: Id<"users">; tokenIdentifier: string } =
      await ctx.runQuery(internal.platform.requireSuperAdminInternal, {});
    const tenants: Array<{
      tenantId: Id<"tenants">;
      clerkOrgId: string;
      slug: string;
    }> = await ctx.runQuery(internal.tenants.listActiveTenantsInternal, {});

    const errors: string[] = [];
    for (const tenant of tenants) {
      try {
        const result: FanOutResult = await fanOutImpl(
          ctx,
          tenant.clerkOrgId,
          caller.userId,
        );
        for (const apiError of result.clerkApiErrors) {
          errors.push(`${tenant.slug}: ${apiError.email} — ${apiError.message}`);
        }
      } catch (error) {
        errors.push(
          `${tenant.slug}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { tenantsProcessed: tenants.length, errors };
  },
});

// --- Backfill -----------------------------------------------------------------

/**
 * Seeds/refreshes the mirror from every organization in Clerk. Run once at
 * rollout (existing orgs predate the mirror), and any time drift is suspected:
 *
 *   npx convex run tenants:backfillTenantsFromClerk --prod
 */
export const backfillTenantsFromClerk = internalAction({
  args: {},
  handler: async (ctx): Promise<{ processed: number }> => {
    let offset = 0;
    let processed = 0;

    for (;;) {
      const response = (await clerkFetch("/organizations", {
        query: { limit: "100", offset: String(offset) },
      })) as ClerkOrganizationListResponse;
      const orgs = response.data ?? [];
      if (orgs.length === 0) break;

      for (const org of orgs) {
        await ctx.runMutation(internal.tenants.upsertFromClerkInternal, {
          clerkOrgId: org.id,
          name: org.name,
          slug: org.slug,
          ...(org.image_url ? { logoUrl: org.image_url } : {}),
          allowedEmailDomains: allowedDomainsFromMetadata(org.public_metadata),
        });
        processed++;
      }

      offset += orgs.length;
      if (
        response.total_count !== undefined &&
        offset >= response.total_count
      ) {
        break;
      }
    }

    return { processed };
  },
});

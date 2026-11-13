import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ClerkApiError, clerkFetch } from "./lib/clerkApi";
import { requireOrgAdmin } from "./lib/orgAuth";
import { userError } from "./lib/userError";
import { mcpAccessFor } from "./mcpSettings";
import { mcpIssuer } from "./mcp/auth";
import { COPILOT_SERVER_DESCRIPTION, COPILOT_SERVER_NAME } from "./mcp/protocol";
import { workspaceMcpUrl } from "./mcp/urls";

/**
 * Self-service Copilot Studio credentials (docs/fabric-mcp-build-task-list.md,
 * Phase 6, B7). Copilot Studio's MCP onboarding needs OAuth 2.0 "Manual": a
 * confidential client id and secret, and each connector's own callback URL
 * registered with the authorization server. A workspace admin creates one
 * dedicated Clerk OAuth application for their workspace under Admin → MCP,
 * and pastes each connector's callback URL there.
 *
 * - The secret is shown once (on create or regenerate) and never stored.
 * - Tokens from this client are accepted only for this workspace's URL
 *   (`workspaceClientFor`, enforced in convex/mcp/routes.ts), and may carry
 *   no audience: Copilot Studio sends no `resource`, so Clerk issues no `aud`.
 * - The Clerk application is deleted when the add-on is revoked or the
 *   workspace is closed (`deleteAllMcpClientsForOrg`).
 */

const SCOPES = "profile email";
/** Microsoft's consent redirect for Power Platform connectors, with or without the connector id. */
const CALLBACK_URL = /^https:\/\/[a-z0-9-]+\.consent\.azure-apim\.net\/redirect(\/[A-Za-z0-9._-]+)?$/;
/** Registered until the first real callback URL is added; Clerk needs at least one. */
const PLACEHOLDER_CALLBACK = "https://global.consent.azure-apim.net/redirect";
const MAX_CALLBACKS = 20;

type ClerkOAuthApp = { id: string; client_id: string; client_secret?: string };

// ---- Lookups ---------------------------------------------------------------------

/** For the MCP endpoint: which workspace, if any, owns this OAuth client. */
export const workspaceClientFor = internalQuery({
  args: { clientId: v.string() },
  handler: async (ctx, { clientId }): Promise<{ clerkOrgId: string } | null> => {
    const row = await ctx.db
      .query("mcpOAuthClients")
      .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
      .first();
    return row ? { clerkOrgId: row.clerkOrgId } : null;
  },
});

/**
 * For the web app's sign-in redirect: the workspace slug that owns a
 * Copilot Studio client. Copilot Studio's consent request carries no
 * `resource`, so its client id is the only way to know which workspace's
 * sign-in page to show. Client ids are random and not secret; the slug is a
 * public subdomain.
 */
export const workspaceSlugForClient = internalQuery({
  args: { clientId: v.string() },
  handler: async (ctx, { clientId }): Promise<string | null> => {
    const row = await ctx.db
      .query("mcpOAuthClients")
      .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
      .first();
    if (!row) return null;
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", row.clerkOrgId))
      .first();
    return tenant && tenant.status === "active" ? tenant.slug : null;
  },
});

function oauthUrls() {
  const issuer = mcpIssuer();
  return {
    authorizationUrl: issuer ? `${issuer}/oauth/authorize` : null,
    tokenUrl: issuer ? `${issuer}/oauth/token` : null,
    scopes: SCOPES,
  };
}

/** For Admin → MCP: the workspace's Copilot Studio setup. */
export const copilotStudioSetup = query({
  args: {},
  handler: async (ctx) => {
    const org = await requireOrgAdmin(ctx);
    const access = await mcpAccessFor(ctx, org.orgId);
    if (!access.enabled) return { available: false as const };
    const row = await ctx.db
      .query("mcpOAuthClients")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", org.orgId))
      .first();
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", org.orgId))
      .first();
    const createdBy = row?.createdByUserId ? await ctx.db.get(row.createdByUserId) : null;
    return {
      available: true as const,
      serverName: COPILOT_SERVER_NAME,
      serverDescription: COPILOT_SERVER_DESCRIPTION,
      serverUrl: tenant ? workspaceMcpUrl(tenant.slug) : null,
      ...oauthUrls(),
      client: row
        ? {
            clientId: row.clientId,
            callbackUrls: row.callbackUrls,
            createdAt: row.createdAt,
            createdByName: createdBy?.name ?? createdBy?.email ?? null,
            secretRotatedAt: row.secretRotatedAt ?? null,
          }
        : null,
    };
  },
});

// ---- Internal steps ---------------------------------------------------------------

/** The calling admin's workspace, checked in a query so actions can use the same rules. */
export const adminContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await requireOrgAdmin(ctx);
    const access = await mcpAccessFor(ctx, org.orgId);
    if (!access.enabled) throw userError("MCP_OFF", "Switch on MCP for this workspace first.");
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", org.orgId))
      .first();
    const row = await ctx.db
      .query("mcpOAuthClients")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", org.orgId))
      .first();
    return {
      clerkOrgId: org.orgId,
      userId: org.userId,
      workspaceName: tenant?.name ?? tenant?.slug ?? org.orgSlug,
      client: row ? { id: row._id, clerkAppId: row.clerkAppId, clientId: row.clientId, callbackUrls: row.callbackUrls } : null,
    };
  },
});

export const insertClient = internalMutation({
  args: { clerkOrgId: v.string(), clerkAppId: v.string(), clientId: v.string(), createdByUserId: v.id("users") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mcpOAuthClients")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .first();
    if (existing) return false;
    await ctx.db.insert("mcpOAuthClients", { ...args, kind: "copilotStudio", callbackUrls: [], createdAt: Date.now() });
    await ctx.db.insert("authAuditEvents", {
      clerkOrgId: args.clerkOrgId,
      actorUserId: args.createdByUserId,
      action: "mcpClientCreated",
      detail: `Copilot Studio client ${args.clientId}`,
      createdAt: Date.now(),
    });
    return true;
  },
});

export const updateClient = internalMutation({
  args: {
    id: v.id("mcpOAuthClients"),
    actorUserId: v.id("users"),
    callbackUrls: v.optional(v.array(v.string())),
    secretRotated: v.optional(v.boolean()),
    detail: v.string(),
  },
  handler: async (ctx, { id, actorUserId, callbackUrls, secretRotated, detail }) => {
    const row = await ctx.db.get(id);
    if (!row) return null;
    await ctx.db.patch(id, {
      ...(callbackUrls ? { callbackUrls } : {}),
      ...(secretRotated ? { secretRotatedAt: Date.now() } : {}),
    });
    await ctx.db.insert("authAuditEvents", { clerkOrgId: row.clerkOrgId, actorUserId, action: "mcpClientChanged", detail, createdAt: Date.now() });
    return null;
  },
});

export const deleteClientRow = internalMutation({
  args: { id: v.id("mcpOAuthClients"), actorUserId: v.optional(v.id("users")), detail: v.string() },
  handler: async (ctx, { id, actorUserId, detail }) => {
    const row = await ctx.db.get(id);
    if (!row) return null;
    await ctx.db.delete(id);
    await ctx.db.insert("authAuditEvents", {
      clerkOrgId: row.clerkOrgId,
      ...(actorUserId ? { actorUserId } : {}),
      action: "mcpClientDeleted",
      detail,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const clientsForOrg = internalQuery({
  args: { clerkOrgId: v.string() },
  handler: async (ctx, { clerkOrgId }) =>
    (
      await ctx.db
        .query("mcpOAuthClients")
        .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", clerkOrgId))
        .take(50)
    ).map((row) => ({ id: row._id, clerkAppId: row.clerkAppId })),
});

async function deleteClerkApp(clerkAppId: string): Promise<void> {
  try {
    await clerkFetch(`/oauth_applications/${clerkAppId}`, { method: "DELETE" });
  } catch (error) {
    if (!(error instanceof ClerkApiError && error.status === 404)) throw error;
  }
}

/**
 * Deletes every MCP OAuth client of a workspace, at Clerk and here. Called
 * when the add-on is revoked and when the workspace is closed; a closed
 * workspace refuses MCP anyway, so the credentials never outlive access.
 */
export async function deleteAllMcpClientsForOrg(ctx: ActionCtx, clerkOrgId: string, reason: string): Promise<{ deleted: number; errors: string[] }> {
  const rows: Array<{ id: Id<"mcpOAuthClients">; clerkAppId: string }> = await ctx.runQuery(internal.mcpClients.clientsForOrg, { clerkOrgId });
  const errors: string[] = [];
  let deleted = 0;
  for (const row of rows) {
    try {
      await deleteClerkApp(row.clerkAppId);
      await ctx.runMutation(internal.mcpClients.deleteClientRow, { id: row.id, detail: `Copilot Studio client deleted: ${reason}` });
      deleted += 1;
    } catch (error) {
      errors.push(`${row.clerkAppId}: ${(error as Error).message}`);
    }
  }
  if (errors.length) console.error("MCP client cleanup failed", { clerkOrgId, errors });
  return { deleted, errors };
}

export const deleteAllForOrg = internalAction({
  args: { clerkOrgId: v.string(), reason: v.string() },
  handler: async (ctx, { clerkOrgId, reason }) => await deleteAllMcpClientsForOrg(ctx, clerkOrgId, reason),
});

// ---- Admin actions ---------------------------------------------------------------

type Credentials = { clientId: string; clientSecret: string };

export const createCopilotStudioClient = action({
  args: {},
  handler: async (ctx): Promise<Credentials> => {
    const admin: {
      clerkOrgId: string;
      userId: Id<"users">;
      workspaceName: string;
      client: { id: Id<"mcpOAuthClients"> } | null;
    } = await ctx.runQuery(internal.mcpClients.adminContext, {});
    if (admin.client) throw userError("MCP_CLIENT_EXISTS", "This workspace already has Copilot Studio credentials. Regenerate the secret instead.");
    const app = (await clerkFetch("/oauth_applications", {
      method: "POST",
      body: {
        name: `Fabric MCP – ${admin.workspaceName} – Copilot Studio`.slice(0, 250),
        redirect_uris: [PLACEHOLDER_CALLBACK],
        scopes: SCOPES,
        public: false,
      },
    })) as ClerkOAuthApp;
    if (!app?.client_secret) {
      await deleteClerkApp(app.id).catch(() => undefined);
      throw userError("MCP_CLIENT_FAILED", "Couldn't create the credentials. Try again.");
    }
    const inserted: boolean = await ctx.runMutation(internal.mcpClients.insertClient, {
      clerkOrgId: admin.clerkOrgId,
      clerkAppId: app.id,
      clientId: app.client_id,
      createdByUserId: admin.userId,
    });
    if (!inserted) {
      // Another admin created one at the same moment: keep theirs.
      await deleteClerkApp(app.id).catch(() => undefined);
      throw userError("MCP_CLIENT_EXISTS", "This workspace already has Copilot Studio credentials.");
    }
    return { clientId: app.client_id, clientSecret: app.client_secret };
  },
});

async function setCallbacks(ctx: ActionCtx, change: (current: string[]) => string[], detail: (urls: string[]) => string) {
  const admin: {
    userId: Id<"users">;
    client: { id: Id<"mcpOAuthClients">; clerkAppId: string; callbackUrls: string[] } | null;
  } = await ctx.runQuery(internal.mcpClients.adminContext, {});
  if (!admin.client) throw userError("MCP_NO_CLIENT", "Create Copilot Studio credentials first.");
  const callbackUrls = change(admin.client.callbackUrls);
  await clerkFetch(`/oauth_applications/${admin.client.clerkAppId}`, {
    method: "PATCH",
    body: { redirect_uris: callbackUrls.length ? callbackUrls : [PLACEHOLDER_CALLBACK] },
  });
  await ctx.runMutation(internal.mcpClients.updateClient, {
    id: admin.client.id,
    actorUserId: admin.userId,
    callbackUrls,
    detail: detail(callbackUrls),
  });
  return null;
}

export const addCallbackUrl = action({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    const trimmed = url.trim();
    if (!CALLBACK_URL.test(trimmed)) {
      throw userError(
        "MCP_BAD_CALLBACK",
        "That isn't a Copilot Studio callback URL. It starts with https://global.consent.azure-apim.net/redirect/.",
      );
    }
    return await setCallbacks(
      ctx,
      (current) => {
        if (current.includes(trimmed)) return current;
        if (current.length >= MAX_CALLBACKS) throw userError("MCP_TOO_MANY_CALLBACKS", `At most ${MAX_CALLBACKS} callback URLs. Remove one first.`);
        return [...current, trimmed];
      },
      () => `Callback URL added: ${trimmed}`,
    );
  },
});

export const removeCallbackUrl = action({
  args: { url: v.string() },
  handler: async (ctx, { url }) =>
    await setCallbacks(ctx, (current) => current.filter((existing) => existing !== url), () => `Callback URL removed: ${url}`),
});

export const regenerateSecret = action({
  args: {},
  handler: async (ctx): Promise<Credentials> => {
    const admin: {
      userId: Id<"users">;
      client: { id: Id<"mcpOAuthClients">; clerkAppId: string; clientId: string } | null;
    } = await ctx.runQuery(internal.mcpClients.adminContext, {});
    if (!admin.client) throw userError("MCP_NO_CLIENT", "Create Copilot Studio credentials first.");
    const app = (await clerkFetch(`/oauth_applications/${admin.client.clerkAppId}/rotate_secret`, { method: "POST" })) as ClerkOAuthApp;
    if (!app?.client_secret) throw userError("MCP_CLIENT_FAILED", "Couldn't regenerate the secret. Try again.");
    await ctx.runMutation(internal.mcpClients.updateClient, {
      id: admin.client.id,
      actorUserId: admin.userId,
      secretRotated: true,
      detail: "Copilot Studio client secret regenerated",
    });
    return { clientId: admin.client.clientId, clientSecret: app.client_secret };
  },
});

export const deleteCopilotStudioClient = action({
  args: {},
  handler: async (ctx) => {
    const admin: {
      userId: Id<"users">;
      client: { id: Id<"mcpOAuthClients">; clerkAppId: string } | null;
    } = await ctx.runQuery(internal.mcpClients.adminContext, {});
    if (!admin.client) return null;
    await deleteClerkApp(admin.client.clerkAppId);
    await ctx.runMutation(internal.mcpClients.deleteClientRow, {
      id: admin.client.id,
      actorUserId: admin.userId,
      detail: "Copilot Studio client deleted by an admin",
    });
    return null;
  },
});

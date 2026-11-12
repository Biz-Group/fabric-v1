import { v } from "convex/values";
import { env, internalQuery } from "../_generated/server";
import { orgViewerValidator, requireOrgViewer, resolveOrgViewer } from "../lib/orgAuth";
import { isOrgInRollout, parseOrgRollout } from "../lib/orgRollout";
import { citationPathResolver } from "../askfabric/citationAccess";
import { citationTarget } from "../lib/citationLinks";

/**
 * Tenant and member resolution for the Fabric MCP server (SPIKE).
 *
 * The tenant comes from the URL slug, never from the token or the model. The
 * member comes from the verified token. Every tool call then re-resolves both
 * through `requireOrgViewer` inside the executor, as AskFabric does.
 */

export type McpViewerLookup =
  | {
      ok: true;
      viewer: { tokenIdentifier: string; orgId: string };
      slug: string;
      role: "admin" | "contributor" | "viewer";
      /** False when the workspace hasn't turned MCP on: the connection is refused (403). */
      enabled: boolean;
    }
  | { ok: false; status: 404; reason: "UNKNOWN_WORKSPACE" };

/**
 * The workspace is named one of two ways (M8): by the slug in a per-workspace
 * URL (`/mcp/<slug>`), or by the org the user picked on Clerk's consent screen
 * (`/mcp`, the token's `org_id`). Either way membership decides access.
 */
export const resolveViewer = internalQuery({
  args: {
    workspace: v.union(v.object({ slug: v.string() }), v.object({ clerkOrgId: v.string() })),
    tokenIdentifier: v.string(),
  },
  handler: async (ctx, { workspace, tokenIdentifier }): Promise<McpViewerLookup> => {
    const tenant =
      "slug" in workspace
        ? await ctx.db
            .query("tenants")
            .withIndex("by_slug", (q) => q.eq("slug", workspace.slug.toLowerCase()))
            .first()
        : await ctx.db
            .query("tenants")
            .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", workspace.clerkOrgId))
            .first();
    // Unknown, deleted and closed workspaces answer alike, before membership,
    // so the endpoint never confirms a workspace to a non-member.
    if (!tenant || tenant.status !== "active") return { ok: false, status: 404, reason: "UNKNOWN_WORKSPACE" };
    const viewer = { tokenIdentifier, orgId: tenant.clerkOrgId };
    const resolved = await resolveOrgViewer(ctx, viewer);
    if (!resolved) return { ok: false, status: 404, reason: "UNKNOWN_WORKSPACE" };
    const enabled = isOrgInRollout(parseOrgRollout(env.FABRIC_MCP), tenant.clerkOrgId);
    return { ok: true, viewer, slug: tenant.slug, role: resolved.role, enabled };
  },
});

/** The workspace origin a member opens in a browser, e.g. https://biz-group.bizfabric.ai. */
function workspaceOrigin(slug: string): string | null {
  const root = process.env.ROOT_DOMAIN?.trim();
  if (!root) return null;
  // Dev runs the app on lvh.me:3000 over http.
  return root === "lvh.me" ? `http://${slug}.lvh.me:3000` : `https://${slug}.${root}`;
}

/**
 * Workbench links for a result's Fabric sources, resolved for this viewer.
 * A source the viewer can't reach gets no link.
 */
export const citationLinks = internalQuery({
  args: { viewer: orgViewerValidator, slug: v.string(), sources: v.array(v.string()) },
  handler: async (ctx, { viewer, slug, sources }): Promise<Array<{ source: string; href: string }>> => {
    await requireOrgViewer(ctx, viewer);
    const origin = workspaceOrigin(slug);
    if (!origin) return [];
    const pathOf = citationPathResolver(ctx, viewer.orgId);
    const appHref = `/${slug}`;
    const links: Array<{ source: string; href: string }> = [];
    for (const source of sources.slice(0, 100)) {
      const target = citationTarget(
        { source, availability: "available", path: await pathOf(source) },
        { appHref, adminUsersHref: `${appHref}/admin/users` },
      );
      if (target.kind === "link") links.push({ source, href: `${origin}${target.href}` });
    }
    return links;
  },
});

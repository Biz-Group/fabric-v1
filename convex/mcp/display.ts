import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { buildEntityCards } from "../askDisplay";
import { computeChart, type ChartData } from "../askCharts";
import { kindOfId } from "../askTools/display";
import { askChartIdValidator } from "../lib/askSchema";
import { chartLinkHref, entityHref, flowStepHref } from "../lib/citationLinks";
import { orgViewerValidator, requireOrgViewer } from "../lib/orgAuth";
import { buildFlowNeighbourhood } from "../processFlows";
import { workspaceOrigin } from "./access";

/**
 * MCP Apps show tools (Phase 5, B9–B11). Each returns a short text version,
 * for the model and for hosts that can't render cards, plus the card's
 * structured data with absolute workbench links. The host renders that data
 * with the `ui://fabric/cards` resource (convex/mcp/cardsHtml.generated.ts).
 *
 * Everything is read as the viewer, the same way AskFabric's display parts
 * are: an id the viewer can't open is left out, never revealed.
 */

export type McpDisplayResult = {
  found: boolean;
  text: string;
  structured: Record<string, unknown> | null;
  resultCount: number;
};

const SHOWN = "The user sees this as a card under your message; refer to it rather than repeating it in full.";

async function linkBase(ctx: QueryCtx, orgId: string): Promise<{ origin: string; appHref: string } | null> {
  const tenant = await ctx.db
    .query("tenants")
    .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", orgId))
    .first();
  const origin = tenant ? workspaceOrigin(tenant.slug) : null;
  return tenant && origin ? { origin, appHref: `/${tenant.slug}` } : null;
}

const absolute = (base: { origin: string } | null, href: string | null) => (base && href ? `${base.origin}${href}` : null);

const NOTHING: McpDisplayResult = { found: false, text: "Nothing to show: none of those ids are in this workspace, or they can't be shown.", structured: null, resultCount: 0 };

export const showCards = internalQuery({
  args: { viewer: orgViewerValidator, ids: v.array(v.string()) },
  handler: async (ctx, { viewer, ids }): Promise<McpDisplayResult> => {
    await requireOrgViewer(ctx, viewer);
    const refs = ids.flatMap((id) => {
      const kind = kindOfId(ctx, id);
      return kind ? [{ kind, id }] : [];
    });
    const cards = await buildEntityCards(ctx, viewer.orgId, refs);
    if (cards.length === 0) return NOTHING;
    const base = await linkBase(ctx, viewer.orgId);
    const withLinks = cards.map((card) => ({ ...card, href: absolute(base, entityHref(card.path, card.kind, base?.appHref ?? "")) }));
    const lines = withLinks.map((card) => {
      const trail = card.trail.length ? ` (${card.trail.join(" › ")})` : "";
      const counts = [
        card.processes !== null ? `${card.processes} processes` : null,
        card.departments !== null ? `${card.departments} departments` : null,
        card.contributions !== null ? `${card.contributions} contributions` : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `- ${card.kind[0].toUpperCase()}${card.kind.slice(1)}: ${card.name}${trail}${card.headline ? ` — ${card.headline}` : ""}${counts ? ` [${counts}]` : ""}${card.href ? ` Link: ${card.href}` : ""}`;
    });
    return {
      found: true,
      text: [`Showing ${withLinks.length} card${withLinks.length === 1 ? "" : "s"}. ${SHOWN}`, ...lines].join("\n"),
      structured: { kind: "cards", cards: withLinks },
      resultCount: withLinks.length,
    };
  },
});

export const showFlowStep = internalQuery({
  args: { viewer: orgViewerValidator, processId: v.string(), stepId: v.string() },
  handler: async (ctx, { viewer, processId, stepId }): Promise<McpDisplayResult> => {
    await requireOrgViewer(ctx, viewer);
    const flow = await buildFlowNeighbourhood(ctx, viewer.orgId, processId, stepId);
    if (!flow) return { ...NOTHING, text: "Nothing to show: that process or step isn't in this workspace's current flow." };
    const base = await linkBase(ctx, viewer.orgId);
    const path = { fn: flow.path.fn, dept: flow.path.dept as string, proc: flow.path.proc as string };
    const link = (nodeId: string) => absolute(base, flowStepHref(path, nodeId, base?.appHref ?? ""));
    const step = { ...flow.step, href: link(flow.step.id) };
    const before = flow.before.map((n) => ({ ...n, href: link(n.id) }));
    const after = flow.after.map((n) => ({ ...n, href: link(n.id) }));
    const names = (list: Array<{ label: string }>, more: number) => (list.length ? list.map((n) => n.label).join(", ") + (more ? ` and ${more} more` : "") : "none");
    return {
      found: true,
      text: [
        `Showing the step "${flow.step.label}" in ${flow.processName}. ${SHOWN}`,
        `Before: ${names(before, flow.moreBefore)}. After: ${names(after, flow.moreAfter)}.${flow.stale ? " The flow is out of date with newer contributions." : ""}`,
        step.href ? `Link: ${step.href}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      structured: {
        kind: "flow",
        processName: flow.processName,
        step,
        before,
        after,
        moreBefore: flow.moreBefore,
        moreAfter: flow.moreAfter,
        stale: flow.stale,
        generatedAt: flow.generatedAt,
      },
      resultCount: 1 + before.length + after.length,
    };
  },
});

export const showChart = internalQuery({
  args: {
    viewer: orgViewerValidator,
    chart: askChartIdValidator,
    kind: v.union(v.literal("org"), v.literal("function"), v.literal("department"), v.literal("process")),
    id: v.string(),
  },
  handler: async (ctx, { viewer, chart, kind, id }): Promise<McpDisplayResult> => {
    await requireOrgViewer(ctx, viewer);
    const scope = kind === "org" || !id.trim() ? null : { kind, id: id.trim() };
    const data: ChartData | null = await computeChart(ctx, viewer.orgId, chart, scope);
    if (!data || data.rows.length === 0) return { ...NOTHING, text: "Nothing to show: there's no data for that chart in that scope yet." };
    const base = await linkBase(ctx, viewer.orgId);
    const rows = data.rows.map((row) => ({ ...row, href: row.link ? absolute(base, chartLinkHref(row.link, base?.appHref ?? "")) : null }));
    const lines = rows.map((row) => `- ${row.label}: ${data.series.map((s, i) => `${s.label} ${row.values[i] ?? 0}`).join(", ")}`);
    return {
      found: true,
      text: [`Showing the chart "${data.title}" for ${data.scopeName}. ${SHOWN}`, ...lines, data.more ? `(${data.more} more not shown)` : ""]
        .filter(Boolean)
        .join("\n"),
      structured: { kind: "chart", ...data, rows },
      resultCount: rows.length,
    };
  },
});

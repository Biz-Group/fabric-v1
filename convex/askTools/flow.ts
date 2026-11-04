import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { readProcessFlow } from "../processFlows";
import {
  deriveHandoffs,
  deriveKeyFindings,
  isNodeDescribed,
  type FlowNode,
} from "../lib/insightsDerivations";
import { askToolQuery } from "./executor";
import { getOrgEntity } from "./scope";
import {
  DEFAULT_BUDGET_TOKENS,
  MAX_BUDGET_TOKENS,
  NOT_FOUND,
  ResultBuilder,
  clipText,
  isoDate,
  searchResult,
  sources,
} from "./results";

export const getProcessFlowInput = { processId: v.string() };

function nodeText(node: FlowNode): string {
  if (!isNodeDescribed(node)) {
    return `Step (${node.category}): ${node.label}. Details not generated yet (${node.detailStatus}). id: ${node.id}.`;
  }
  const flags = [
    node.isBottleneck ? "bottleneck" : null,
    node.isTribalKnowledge ? "tribal knowledge" : null,
    node.automationPotential !== "none" ? `automation potential ${node.automationPotential}` : null,
  ].filter(Boolean);
  return [
    `Step (${node.category}): ${node.label}.`,
    node.actors.length ? `Actors: ${node.actors.join(", ")}.` : "",
    node.tools.length ? `Tools: ${node.tools.join(", ")}.` : "",
    node.painPoints.length ? `Pain points: ${node.painPoints.join("; ")}.` : "",
    flags.length ? `Flags: ${flags.join(", ")}.` : "",
    `Confidence: ${node.confidence}. id: ${node.id}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * T4. A process's flow as the workbench reads it (`processFlows.getProcessFlow`):
 * key findings from the Insights tab's own derivation (FR-1.12), insights,
 * compact steps and the edges between them, with status and staleness.
 */
export const getProcessFlow = askToolQuery({
  input: getProcessFlowInput,
  handler: async (ctx, viewer, input) => {
    const process = await getOrgEntity(ctx, viewer.orgId, "process", input.processId);
    if (!process) return NOT_FOUND;
    const flow = await readProcessFlow(ctx, viewer.orgId, process._id as Id<"processes">);
    const builder = new ResultBuilder(MAX_BUDGET_TOKENS, 600);
    const pid = process._id;

    if (!flow || flow.nodes.length === 0) {
      builder.add(
        searchResult(
          sources.entity("process", pid),
          `${process.name} — process flow`,
          flow?.status === "generating"
            ? "The process flow is being generated."
            : "No process flow has been generated for this process yet.",
        ),
      );
      return builder.finish({ status: flow?.status ?? "missing" });
    }

    const done = await ctx.db
      .query("conversations")
      .withIndex("by_clerkOrgId_and_processId_and_status", (q) =>
        q.eq("clerkOrgId", viewer.orgId).eq("processId", process._id).eq("status", "done"),
      )
      .take(500);
    const stale =
      flow.stale || (flow.status === "ready" && done.length > flow.conversationCount);
    const labelById = new Map(flow.nodes.map((node) => [node.id, node.label]));

    // The flow's own facts, citable: answers quote its size, sources and age.
    const tools = [...new Set(flow.nodes.flatMap((node) => node.tools ?? []))];
    builder.add(
      searchResult(
        sources.entity("process", pid),
        `${process.name} — process flow summary`,
        [
          `Process flow for ${process.name}: ${flow.nodes.length} steps and ${flow.insights.handoffCount} handoffs, built from ${flow.conversationCount} contribution${flow.conversationCount === 1 ? "" : "s"}, generated ${isoDate(flow.generatedAt)}.`,
          stale ? "It is stale: newer contributions aren't reflected yet." : "It is up to date with the process's contributions.",
          tools.length ? `Systems named on steps: ${tools.join(", ")}.` : "No systems are named on its steps.",
        ].join(" "),
      ),
    );

    // How steps connect, citable too: answers describe the branching (D52).
    const edges = flow.edges
      .map((edge) => `${labelById.get(edge.source) ?? edge.source} → ${labelById.get(edge.target) ?? edge.target}${edge.label ? ` (${edge.label})` : ""}`)
      .join("; ");
    if (edges) {
      builder.add(searchResult(sources.entity("process", pid), `${process.name} — how the steps connect`, clipText(`Step connections: ${edges}.`, 900)));
    }

    // Key findings lead: they are what the Insights tab leads with.
    const keyFindings = deriveKeyFindings(flow, deriveHandoffs(flow.nodes, flow.edges));
    if (keyFindings.state === "findings") {
      for (const finding of keyFindings.findings) {
        builder.add(
          searchResult(
            finding.nodeId ? sources.flowNode(pid, finding.nodeId) : sources.entity("process", pid),
            `${process.name}: ${finding.title}`,
            `${finding.title}. ${finding.detail}`,
          ),
        );
      }
    }

    const opportunities =
      flow.insights.automationOpportunitiesSource === "derived"
        ? []
        : (flow.insights.automationOpportunityDetails ?? []);
    for (const opportunity of opportunities) {
      const nodeId = opportunity.nodeIds[0];
      builder.add(
        searchResult(
          nodeId ? sources.flowNode(pid, nodeId) : sources.entity("process", pid),
          `${process.name}: automation opportunity — ${opportunity.title}`,
          clipText(
            `${opportunity.title} (${opportunity.kind}, confidence ${opportunity.confidence}). ${opportunity.rationale}${opportunity.expectedBenefit ? ` Expected benefit: ${opportunity.expectedBenefit}` : ""} Steps: ${opportunity.nodeIds.map((id) => labelById.get(id) ?? id).join(", ")}.`,
            250,
          ),
        ),
      );
    }

    for (const node of flow.nodes) {
      if (!builder.add(searchResult(sources.flowNode(pid, node.id), `${process.name}: ${node.label}`, nodeText(node)))) {
        break;
      }
    }

    return builder.finish({
      process: process.name,
      // T4 lists steps compactly; T10 reads one in full.
      stepDetail: "getFlowNode",
      status: flow.status,
      detailsStatus: flow.detailsStatus,
      stale,
      generatedAt: isoDate(flow.generatedAt),
      contributionsInFlow: flow.conversationCount,
      steps: flow.nodes.length,
      criticalPath: flow.insights.criticalPath.map((id) => labelById.get(id) ?? id),
      topBottlenecks: flow.insights.topBottlenecks,
      handoffCount: flow.insights.handoffCount,
      keyFindings: keyFindings.state,
    });
  },
});

export const getFlowNodeInput = { processId: v.string(), nodeId: v.string() };

/**
 * T10. One step of a process flow in full, as the workbench's step panel shows
 * it: description, actors, tools, duration, pain points, risks, flags, the
 * contributions it came from and the steps either side (FR-1.20).
 */
export const getFlowNode = askToolQuery({
  input: getFlowNodeInput,
  handler: async (ctx, viewer, input) => {
    const process = await getOrgEntity(ctx, viewer.orgId, "process", input.processId);
    if (!process) return NOT_FOUND;
    const flow = await readProcessFlow(ctx, viewer.orgId, process._id as Id<"processes">);
    const node = flow?.nodes.find((candidate) => candidate.id === input.nodeId.trim()) as FlowNode | undefined;
    if (!flow || !node) return NOT_FOUND;
    const labelById = new Map(flow.nodes.map((candidate) => [candidate.id, candidate.label]));
    const before = flow.edges.filter((edge) => edge.target === node.id).map((edge) => labelById.get(edge.source) ?? edge.source);
    const after = flow.edges
      .filter((edge) => edge.source === node.id)
      .map((edge) => `${labelById.get(edge.target) ?? edge.target}${edge.label ? ` (${edge.label})` : ""}`);
    const builder = new ResultBuilder(DEFAULT_BUDGET_TOKENS, 300);
    const source = sources.flowNode(process._id, node.id);
    const title = `${process.name}: ${node.label}`;

    if (!isNodeDescribed(node)) {
      builder.add(
        searchResult(source, title, `Step (${node.category}): ${node.label}. Its details haven't been generated yet (${node.detailStatus}).`),
      );
    } else {
      const flags = [
        node.isBottleneck ? "bottleneck" : null,
        node.isTribalKnowledge ? "tribal knowledge" : null,
        node.automationPotential !== "none" ? `automation potential ${node.automationPotential}` : null,
      ].filter(Boolean);
      builder.add(
        searchResult(
          source,
          title,
          clipText(
            [
              `Step (${node.category}): ${node.label}. ${node.description}`,
              node.actors.length ? `Actors: ${node.actors.join(", ")}.` : "",
              node.tools.length ? `Tools: ${node.tools.join(", ")}.` : "",
              node.estimatedDuration ? `Estimated duration: ${node.estimatedDuration}.` : "",
              node.painPoints.length ? `Pain points: ${node.painPoints.join("; ")}.` : "",
              node.riskIndicators.length ? `Risks: ${node.riskIndicators.join("; ")}.` : "",
              flags.length ? `Flags: ${flags.join(", ")}.` : "",
              `Confidence: ${node.confidence}.`,
              node.sources.length ? `From: ${node.sources.join("; ")}.` : "",
            ]
              .filter(Boolean)
              .join(" "),
            1500,
          ),
        ),
      );
    }
    builder.add(
      searchResult(
        source,
        `${title} — neighbouring steps`,
        `Comes after: ${before.length ? before.join(", ") : "nothing (a starting step)"}. Leads to: ${after.length ? after.join(", ") : "nothing (an ending step)"}.`,
      ),
    );
    return builder.finish({ process: process.name, step: node.label, detailStatus: node.detailStatus });
  },
});

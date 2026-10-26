import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { ProcessRecommendationsTab } from "./process-recommendations-tab";

const state = vi.hoisted(() => ({
  recommendations: null as unknown,
}));

const { flowFixture } = vi.hoisted(() => ({
  flowFixture: {
    status: "ready",
    stale: false,
    generatedAt: 1_786_000_000_000,
    conversationCount: 2,
    detailsStatus: "ready",
    nodes: [
      {
        id: "update-list",
        label: "Update supplier list",
        category: "action",
        description: "The manager edits the sheet.",
        actors: ["Concierge manager"],
        tools: ["Excel"],
        painPoints: ["Only one person can edit it."],
        automationPotential: "low",
        confidence: "medium",
        isBottleneck: true,
        isTribalKnowledge: true,
        riskIndicators: [],
        sources: ["Alice, Conv. 1"],
        detailStatus: "ready",
      },
    ],
    edges: [],
    insights: {
      criticalPath: ["update-list"],
      handoffCount: 0,
      toolCount: 1,
      automationOpportunities: [],
      automationOpportunitiesSource: "ai",
      topBottlenecks: ["Update supplier list"],
    },
  },
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    if (name === "processFlows:getProcessFlow") return flowFixture;
    if (name === "recommendations:getProcessRecommendations") return state.recommendations;
    return undefined;
  },
  useMutation: () => async () => ({ message: null }),
}));

vi.mock("@/features/workbench/use-summary-overview", () => ({
  useSummaryOverview: () => ({ content: { format: "legacy" }, coverage: null }),
}));

const NON_TECHNICAL = {
  _id: "rec-1",
  source: "v2",
  lifecycle: "active",
  title: "Give coordinators edit rights",
  nodeIds: ["update-list"],
  content: {
    problem: "Only the manager can update the supplier list.",
    cause: "The sheet is locked to one person.",
    causeBasis: "reported",
    intervention: "role_or_policy",
    supportingInterventions: ["standardise"],
    proposedChange: "Share edit rights and add a vetting checklist.",
    pilot: { what: "Two coordinators for a month", measure: "Requests waiting on the manager" },
    openQuestions: ["Who else edits it today?"],
    risks: [],
    frequency: "weekly",
  },
  scores: {
    value: { level: "medium", reasons: ["Runs weekly"] },
    effort: { level: "low", reasons: ["Changes a role or rule"] },
    evidence: { interviews: 1, contributors: 1 },
    peopleAffected: ["Concierge manager"],
  },
  legacy: null,
  buildsOnId: null,
  decisionStatus: "new",
  dismissReason: null,
  createdAt: 0,
  updatedAt: 0,
};

const TECHNICAL = {
  ...NON_TECHNICAL,
  _id: "rec-2",
  title: "Supplier database with automated vetting",
  content: {
    ...NON_TECHNICAL.content,
    intervention: "integration",
    whyNotSimpler: "Vetting needs data from three systems.",
  },
};

const LEGACY = {
  ...NON_TECHNICAL,
  _id: "legacy-1",
  source: "legacy",
  title: "Supplier Database Migration",
  content: null,
  scores: null,
  legacy: {
    title: "Supplier Database Migration",
    kind: "integration",
    nodeIds: ["update-list"],
    rationale: "Move the sheet into a database.",
    prerequisites: [],
    confidence: "high",
  },
};

function view(overrides: Record<string, unknown>) {
  return {
    run: { status: "ready", trigger: "flow", errorMessage: null, createdAt: 0 },
    lastReadyAt: 1_786_000_000_000,
    newInterviewsSince: 0,
    canDecide: true,
    recommendations: [],
    earlier: [],
    legacy: [],
    ...overrides,
  };
}

function render() {
  return renderToStaticMarkup(
    createElement(ProcessRecommendationsTab, {
      processId: "process-1" as Id<"processes">,
      processName: "Supplier onboarding",
      onOpenProcessFlow: () => undefined,
    }),
  );
}

describe("Recommendations tab", () => {
  beforeEach(() => {
    state.recommendations = view({});
  });

  it("shows a valid empty result as an answer, not a failure", () => {
    const html = render();
    expect(html).toContain("No changes recommended from current evidence");
    expect(html).not.toContain("didn&#x27;t finish");
  });

  it("offers a retry that does not regenerate the flow when the first run failed", () => {
    state.recommendations = view({
      run: {
        status: "failed",
        trigger: "flow",
        errorMessage: "The recommendation analysis did not finish.",
        createdAt: 0,
      },
      lastReadyAt: null,
    });
    const html = render();
    expect(html).toContain("Recommendations didn&#x27;t finish");
    expect(html).toContain("Retry");
  });

  it("shows earlier automation suggestions until recommendations are published", () => {
    state.recommendations = view({ run: null, lastReadyAt: null, legacy: [LEGACY] });
    const html = render();
    expect(html).toContain("Earlier automation suggestions");
    expect(html).toContain("Supplier Database Migration");
    expect(html).toContain("Generate recommendations");
  });

  it("lists technical and non-technical changes and plans the selected one", () => {
    state.recommendations = view({
      recommendations: [NON_TECHNICAL, TECHNICAL],
      legacy: [LEGACY],
    });
    const html = render();

    expect(html).toContain("Give coordinators edit rights");
    expect(html).toContain("Supplier database with automated vetting");
    expect(html).toContain("Non-technical");
    // The first one is selected, so its change plan is offered.
    expect(html).toContain("Copy change plan");
    expect(html).toContain("Reported by a contributor");
    expect(html).toContain("Requests waiting on the manager");
    expect(html).toContain("Shortlist");
    // Earlier suggestions are a comparison the user opts into.
    expect(html).toContain("Compare with 1 earlier automation suggestion");
    expect(html).not.toContain("Supplier Database Migration");
  });

  it("nests a follow-on under the change it builds on", () => {
    state.recommendations = view({
      // Ranked first on its own score, but it is a next step, not a peer.
      recommendations: [{ ...TECHNICAL, buildsOnId: "rec-1" }, NON_TECHNICAL],
    });
    const html = render();

    expect(html).toContain("1 recommendation and 1 next step, highest value first");
    // Parent first, then the follow-on, marked as what comes after it.
    expect(html.indexOf("Give coordinators edit rights")).toBeLessThan(
      html.indexOf("Supplier database with automated vetting"),
    );
    expect(html).toContain('aria-label="Next steps after Give coordinators edit rights"');
    expect(html).toContain("Then: </span>Supplier database with automated vetting");
    // The selected parent offers its next step in the detail panel.
    expect(html).toContain("Next step");
    expect(html).toContain("a technical change can build on it");
  });

  it("gives viewers the recommendations without decision controls", () => {
    state.recommendations = view({
      recommendations: [NON_TECHNICAL],
      canDecide: false,
    });
    const html = render();
    expect(html).toContain("Give coordinators edit rights");
    expect(html).not.toContain("Shortlist");
    expect(html).not.toContain("Dismiss…");
  });

  it("keeps the Copilot Studio brief for technical changes", () => {
    state.recommendations = view({ recommendations: [TECHNICAL] });
    const html = render();
    expect(html).toContain("Copy for Copilot Studio");
    expect(html).toContain("Why not something simpler");
  });

  it("says when new interviews have landed since the recommendations", () => {
    state.recommendations = view({
      recommendations: [NON_TECHNICAL],
      newInterviewsSince: 2,
    });
    expect(render()).toContain("2 new interviews since these recommendations");
  });
});

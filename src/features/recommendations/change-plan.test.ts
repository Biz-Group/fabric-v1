import { describe, expect, test } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { composeChangePlan, type ChangePlanInput } from "./change-plan";

function recommendation(
  overrides: Partial<ChangePlanInput["recommendation"]["content"]> = {},
): ChangePlanInput["recommendation"] {
  return {
    _id: "rec_1" as Id<"processRecommendations">,
    source: "v2",
    lifecycle: "active",
    title: "Give coordinators edit rights",
    nodeIds: ["update-list", "invented"],
    content: {
      problem: "Only one manager can update the supplier list.",
      cause: "The spreadsheet is locked to one person.",
      causeBasis: "reported",
      intervention: "role_or_policy",
      supportingInterventions: ["standardise"],
      proposedChange: "Share edit rights with coordinators.",
      pilot: {
        what: "Two coordinators for a month",
        measure: "Requests waiting on the manager",
      },
      openQuestions: ["Who else edits it today?"],
      risks: ["Unvetted suppliers added"],
      frequency: "weekly",
      ...overrides,
    },
    scores: {
      value: { level: "medium", reasons: [] },
      effort: { level: "low", reasons: [] },
      evidence: { interviews: 2, contributors: 2 },
      peopleAffected: ["Coordinator", "Concierge manager"],
    },
    legacy: null,
    buildsOnId: null,
    decisionStatus: "new",
    dismissReason: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

const input = (rec = recommendation()): ChangePlanInput => ({
  recommendation: rec,
  stepLabels: new Map([["update-list", "Update supplier list"]]),
  processName: "Supplier onboarding",
  today: Date.UTC(2026, 9, 26),
});

describe("change plan", () => {
  test("covers people, pilot, measure, review date and rollback", () => {
    const { body } = composeChangePlan(input());

    expect(body).toContain("# Give coordinators edit rights");
    expect(body).toContain("**Supplier onboarding** process: role or policy.");
    expect(body).toContain("Based on 2 interviews.");
    // Unknown step ids are left out rather than printed raw.
    expect(body).toContain("**Steps:** Update supplier list.");
    expect(body).toContain("*Reported by a contributor.*");
    expect(body).toContain("**Alongside:** standardise.");
    expect(body).toContain("- Coordinator\n- Concierge manager");
    expect(body).toContain("**Measure:** Requests waiting on the manager");
    expect(body).toContain("Suggested review: **23 November 2026**");
    expect(body).toContain("Restore the previous permissions or rule.");
    expect(body).toContain("## Risks to watch\n\n- Unvetted suppliers added");
    expect(body).toContain("## Before you start\n\n- Who else edits it today?");
  });

  test("states what the evidence is missing instead of dropping the section", () => {
    const rec = recommendation({
      cause: "",
      causeBasis: "unknown",
      pilot: { what: "", measure: "" },
      risks: [],
      openQuestions: [],
    });
    rec.scores!.peopleAffected = [];
    const { body } = composeChangePlan(input(rec));

    expect(body).toContain("## Why it happens\n\nNot known yet.");
    expect(body).toContain("did not name the roles");
    expect(body).toContain("agree one observable measure");
    expect(body).not.toContain("## Risks to watch");
  });
});

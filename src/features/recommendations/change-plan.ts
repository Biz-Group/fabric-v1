/**
 * The change plan for a non-technical recommendation: who is affected, the
 * pilot, the measure, when to review it, and how to undo it.
 *
 * Templating, not generation, for the same reasons as the V0 brief
 * (`opportunity-brief.ts`): every sentence it needs was already written by the
 * recommendation stage and stored structured, so this is instant, free and
 * testable. Pure: the caller supplies `today`, so the review date is
 * reproducible in a test.
 */

import {
  CAUSE_BASIS_LABEL,
  INTERVENTION_LABEL,
  type ClientRecommendation,
  type Intervention,
  type RecommendationContent,
} from "./recommendation-meta";

export type ChangePlanInput = {
  recommendation: ClientRecommendation & {
    content: RecommendationContent;
  };
  /** Step labels by node id, for naming the steps the change touches. */
  stepLabels: ReadonlyMap<string, string>;
  processName: string;
  /** Epoch ms. The review date is suggested four weeks from it. */
  today: number;
};

const REVIEW_AFTER_DAYS = 28;

/** How to put things back if the pilot measure gets worse. */
const ROLLBACK: Record<Intervention, string> = {
  eliminate:
    "Reinstate the step. Before removing it, write down what it checked, so you can tell whether anything now slips through.",
  simplify:
    "Return to the previous steps or forms. Keep the old versions until the review.",
  standardise:
    "Withdraw the new checklist or template and go back to the previous practice, noting where it did not fit real cases.",
  role_or_policy:
    "Restore the previous permissions or rule. Record who had access or authority before the change so it can be put back exactly.",
  training:
    "Training needs no rollback. If the measure does not move, the cause is probably not a skills gap — revisit why it happens.",
  workflow: "Switch the workflow off and return to the manual steps.",
  integration: "Disable the integration and return to the manual transfer.",
  ai_assist: "Stop using the assistant and return to the manual steps.",
  agent: "Turn the agent off and route requests back to people.",
};

function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function composeChangePlan(input: ChangePlanInput): {
  title: string;
  body: string;
} {
  const { recommendation, stepLabels } = input;
  const content = recommendation.content;
  const steps = recommendation.nodeIds
    .map((id) => stepLabels.get(id))
    .filter((label): label is string => Boolean(label));
  const people = recommendation.scores?.peopleAffected ?? [];
  const interviews = recommendation.scores?.evidence.interviews ?? 0;
  const reviewOn = formatDate(input.today + REVIEW_AFTER_DAYS * 86_400_000);

  const sections: string[][] = [
    [
      `# ${recommendation.title}`,
      "",
      `A change to the **${input.processName}** process: ${INTERVENTION_LABEL[
        content.intervention
      ].toLowerCase()}.` +
        (interviews > 0
          ? ` Based on ${interviews} ${interviews === 1 ? "interview" : "interviews"}.`
          : ""),
    ],
    [
      "## The problem",
      "",
      content.problem,
      ...(steps.length > 0 ? ["", `**Steps:** ${steps.join(", ")}.`] : []),
    ],
    [
      "## Why it happens",
      "",
      content.cause || "Not known yet.",
      "",
      `*${CAUSE_BASIS_LABEL[content.causeBasis]}.*`,
    ],
    [
      "## The change",
      "",
      content.proposedChange,
      ...(content.supportingInterventions.length > 0
        ? [
            "",
            `**Alongside:** ${content.supportingInterventions
              .map((rung) => INTERVENTION_LABEL[rung].toLowerCase())
              .join(", ")}.`,
          ]
        : []),
    ],
    [
      "## Who is affected",
      "",
      people.length > 0
        ? bullets(people)
        : "The interviews did not name the roles on these steps. Confirm who does this work before starting.",
    ],
    [
      "## Pilot",
      "",
      content.pilot.what || "Agree a small, time-boxed trial with the people affected.",
      "",
      `**Measure:** ${
        content.pilot.measure ||
        "agree one observable measure before starting."
      }`,
      "",
      "Record the measure before the pilot starts, so there is a baseline to compare against.",
    ],
    [
      "## Review",
      "",
      `Suggested review: **${reviewOn}** (four weeks from today — move it to the end of the pilot).`,
    ],
    ["## If it does not work", "", ROLLBACK[content.intervention]],
  ];

  if (content.risks.length > 0) {
    sections.push(["## Risks to watch", "", bullets(content.risks)]);
  }
  if (content.openQuestions.length > 0) {
    sections.push(["## Before you start", "", bullets(content.openQuestions)]);
  }

  return {
    title: recommendation.title,
    body: sections.map((section) => section.join("\n")).join("\n\n"),
  };
}

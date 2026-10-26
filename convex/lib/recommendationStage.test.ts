import { describe, expect, test } from "vitest";
import { isWithinTimeBudget } from "./aiProvider";
import {
  anonymiseSources,
  buildRecommendationsAIRequest,
  buildRecommendationsUserContent,
  MAX_FOLLOW_ONS,
  MAX_RECOMMENDATIONS,
  normalizeRecommendations,
  readRecommendationsPayload,
  RECOMMENDATIONS_MAX_RETRIES,
  RECOMMENDATIONS_TIMEOUT_MS,
  scrubContributorNames,
  toAutomationOpportunity,
} from "./recommendationStage";

const KNOWN = ["intake", "triage", "resolve"];

const wellFormed = {
  title: "Give coordinators edit rights",
  problem: "Only one manager can update the supplier list.",
  cause: "The spreadsheet is locked to one person.",
  causeBasis: "reported",
  intervention: "role_or_policy",
  supportingInterventions: ["standardise"],
  proposedChange: "Share edit rights with coordinators and add a vetting checklist.",
  whyNotSimpler: "Should be dropped: this is not a technical change.",
  nodeIds: ["triage"],
  pilot: { what: "Two coordinators for a month", measure: "Requests waiting on the manager" },
  openQuestions: ["Who else edits it today?"],
  risks: ["Unvetted suppliers added"],
  frequency: "weekly",
};

describe("recommendation request", () => {
  test("fits its time budget and its retries fit one action", () => {
    const request = buildRecommendationsAIRequest("process");
    expect(isWithinTimeBudget(request.maxTokens, request.timeoutMs)).toBe(true);
    expect((1 + RECOMMENDATIONS_MAX_RETRIES) * RECOMMENDATIONS_TIMEOUT_MS).toBeLessThan(
      600_000,
    );
    expect(request.tool.name).toBe("return_process_recommendations");
    expect(request.operation).toBe("process-recommendations");
  });

  test("offers the whole ladder, non-technical rungs first", () => {
    const request = buildRecommendationsAIRequest("process");
    expect(request.system.indexOf('"eliminate"')).toBeLessThan(
      request.system.indexOf('"agent"'),
    );
    expect(request.system).toContain("never by name");
    // A simple fix does not rule out a technical one that builds on it.
    expect(request.system).toContain("The ladder is a sequence, not a choice of one.");
  });
});

describe("recommendation normalization", () => {
  test("keeps a well-formed recommendation", () => {
    const [rec] = normalizeRecommendations({ recommendations: [wellFormed] }, KNOWN);
    expect(rec).toMatchObject({
      title: "Give coordinators edit rights",
      intervention: "role_or_policy",
      supportingInterventions: ["standardise"],
      causeBasis: "reported",
      nodeIds: ["triage"],
      frequency: "weekly",
    });
  });

  test("keeps whyNotSimpler only on technical changes", () => {
    const [nonTechnical] = normalizeRecommendations(
      { recommendations: [wellFormed] },
      KNOWN,
    );
    expect(nonTechnical.whyNotSimpler).toBeUndefined();

    const [technical] = normalizeRecommendations(
      {
        recommendations: [
          { ...wellFormed, intervention: "workflow", whyNotSimpler: "Rules exist already." },
        ],
      },
      KNOWN,
    );
    expect(technical.whyNotSimpler).toBe("Rules exist already.");
  });

  test("drops node ids not in the graph, and a recommendation left with none", () => {
    const [rec] = normalizeRecommendations(
      { recommendations: [{ ...wellFormed, nodeIds: ["triage", "invented"] }] },
      KNOWN,
    );
    expect(rec.nodeIds).toEqual(["triage"]);
    expect(
      normalizeRecommendations(
        { recommendations: [{ ...wellFormed, nodeIds: ["invented"] }] },
        KNOWN,
      ),
    ).toEqual([]);
  });

  test("drops a recommendation with no recognisable kind of change", () => {
    expect(
      normalizeRecommendations(
        { recommendations: [{ ...wellFormed, intervention: "wizardry" }] },
        KNOWN,
      ),
    ).toEqual([]);
  });

  test("a cause nobody gave is unknown, whatever basis the model claimed", () => {
    const [rec] = normalizeRecommendations(
      { recommendations: [{ ...wellFormed, cause: "" }] },
      KNOWN,
    );
    expect(rec.causeBasis).toBe("unknown");
  });

  test("an unrecognised frequency is unknown, not a guess", () => {
    const [rec] = normalizeRecommendations(
      { recommendations: [{ ...wellFormed, frequency: "fortnightly" }] },
      KNOWN,
    );
    expect(rec.frequency).toBe("unknown");
  });

  test("supporting changes exclude the primary one and unknown kinds", () => {
    const [rec] = normalizeRecommendations(
      {
        recommendations: [
          {
            ...wellFormed,
            supportingInterventions: ["role_or_policy", "standardise", "magic"],
          },
        ],
      },
      KNOWN,
    );
    expect(rec.supportingInterventions).toEqual(["standardise"]);
  });

  test(`caps the list at ${MAX_RECOMMENDATIONS}, and treats an empty list as an answer`, () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      ...wellFormed,
      title: `Change ${i}`,
    }));
    expect(
      normalizeRecommendations({ recommendations: many }, KNOWN),
    ).toHaveLength(MAX_RECOMMENDATIONS);
    expect(normalizeRecommendations({ recommendations: [] }, KNOWN)).toEqual([]);
  });
});

describe("technical follow-ons", () => {
  const followOn = {
    kind: "workflow",
    title: "Send the end-user redirect automatically",
    problem: "Every end-user ticket is redirected by hand.",
    proposedChange: "A Zendesk trigger replies to end-user tickets with the agreed wording.",
    whyNotSimpler: "The written rule still leaves the reply typed by hand each time.",
    nodeIds: [],
    pilot: { what: "One month", measure: "End-user tickets handled by hand" },
    openQuestions: ["Can Zendesk tell end users from admins?"],
    risks: [],
  };

  test("a follow-on becomes its own technical recommendation, linked to its parent", () => {
    const recs = normalizeRecommendations(
      { recommendations: [{ ...wellFormed, followOn }] },
      KNOWN,
    );
    expect(recs).toHaveLength(2);
    expect(recs[1]).toMatchObject({
      title: "Send the end-user redirect automatically",
      intervention: "workflow",
      buildsOnIndex: 0,
      // Shares the parent's diagnosis, steps and frequency.
      cause: wellFormed.cause,
      causeBasis: "reported",
      nodeIds: ["triage"],
      frequency: "weekly",
      supportingInterventions: ["role_or_policy"],
      whyNotSimpler: "The written rule still leaves the reply typed by hand each time.",
    });
    expect(recs[0].buildsOnIndex).toBeUndefined();
  });

  test("'none', and any follow-on of a technical recommendation, adds nothing", () => {
    expect(
      normalizeRecommendations(
        { recommendations: [{ ...wellFormed, followOn: { kind: "none" } }] },
        KNOWN,
      ),
    ).toHaveLength(1);
    expect(
      normalizeRecommendations(
        { recommendations: [{ ...wellFormed, intervention: "workflow", followOn }] },
        KNOWN,
      ),
    ).toHaveLength(1);
  });

  test(`primaries keep the first five places and follow-ons are capped at ${MAX_FOLLOW_ONS}`, () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      ...wellFormed,
      title: `Change ${i}`,
      // Distinct changes, so the duplicate merge leaves them alone.
      followOn: {
        ...followOn,
        title: `Follow-on ${i}`,
        kind: ["workflow", "integration", "agent", "ai_assist", "workflow"][i],
        nodeIds: [KNOWN[i % 3]],
      },
    }));
    const recs = normalizeRecommendations({ recommendations: many }, KNOWN);
    expect(recs).toHaveLength(MAX_RECOMMENDATIONS + MAX_FOLLOW_ONS);
    expect(recs.slice(0, 5).every((rec) => rec.buildsOnIndex === undefined)).toBe(true);
    expect(recs.slice(5).map((rec) => rec.buildsOnIndex)).toEqual([0, 1, 2]);
  });

  test("the same next step proposed under two recommendations is kept once, under the first", () => {
    const recs = normalizeRecommendations(
      {
        recommendations: [
          { ...wellFormed, title: "Cover rota", followOn },
          {
            ...wellFormed,
            title: "Priority rules",
            // Same kind of change on the same steps, worded differently.
            followOn: { ...followOn, title: "Alert on unanswered replies" },
          },
        ],
      },
      KNOWN,
    );
    expect(recs.map((rec) => rec.title)).toEqual([
      "Cover rota",
      "Priority rules",
      "Send the end-user redirect automatically",
    ]);
    expect(recs[2].buildsOnIndex).toBe(0);
  });

  test("a technical change that needs a simpler one first is told to be its follow-on", () => {
    expect(buildRecommendationsAIRequest("process").system).toContain(
      "make the simpler change the recommendation and the technical change its followOn",
    );
  });

  test("the prompt requires the follow-on question for every recommendation", () => {
    const request = buildRecommendationsAIRequest("process");
    const schema = request.tool.inputSchema as unknown as {
      properties: { recommendations: { items: { required: string[] } } };
    };
    expect(schema.properties.recommendations.items.required).toContain("followOn");
  });
});

describe("payload drift", () => {
  test("a recommendations list sent as a JSON string is read back, not re-asked", () => {
    const payload = readRecommendationsPayload({
      recommendations: JSON.stringify([wellFormed]),
    });
    expect(payload?.recommendations).toHaveLength(1);
    expect(readRecommendationsPayload({ recommendations: "not json" })).toBeNull();
    expect(readRecommendationsPayload(null)).toBeNull();
  });

  test("a stringified follow-on and pilot are read back too", () => {
    const recs = normalizeRecommendations(
      {
        recommendations: [
          {
            ...wellFormed,
            pilot: JSON.stringify(wellFormed.pilot),
            followOn: JSON.stringify({
              kind: "workflow",
              title: "Automate it",
              problem: "Still by hand",
              proposedChange: "A trigger does it",
            }),
          },
        ],
      },
      KNOWN,
    );
    expect(recs[0].pilot.measure).toBe("Requests waiting on the manager");
    expect(recs[1]?.title).toBe("Automate it");
  });
});

describe("contributor names", () => {
  test("sources keep the interview reference and lose the name", () => {
    expect(anonymiseSources(["Alice Smith, Conv. 1", "Bob, Conv. 3", "Carol"])).toEqual([
      "Conv. 1",
      "Conv. 3",
      "a contributor",
    ]);
  });

  test("the prompt carries no contributor names from sources", () => {
    const content = buildRecommendationsUserContent({
      nodes: [
        {
          id: "triage",
          label: "Triage",
          category: "action",
          detail: {
            description: "Tickets are read.",
            actors: ["Team lead"],
            tools: [],
            painPoints: [],
            automationPotential: "high",
            confidence: "high",
            isBottleneck: false,
            isTribalKnowledge: false,
            riskIndicators: [],
            sources: ["Alice Smith, Conv. 1"],
          },
        },
      ],
      edges: [],
      contexts: [{ ref: "Conv. 1", frequency: "daily", volume: "40 a day" }],
      current: [],
      dismissed: [],
    });
    expect(content).toContain("Described in: Conv. 1");
    // Whether work is rule-based, said without the word "automation".
    expect(content).toContain("Nature: rule-based and repetitive");
    expect(content).not.toContain("utomation");
    expect(content).toContain("how often: daily; how many: 40 a day");
    expect(content).not.toContain("Alice");
  });

  test("names the model repeated anyway are replaced", () => {
    const [rec] = normalizeRecommendations(
      {
        recommendations: [
          {
            ...wellFormed,
            problem: "Alice Smith checks every row; Alice says it takes a day.",
            pilot: { what: "Ask Bob to try it", measure: "Hours Alice spends" },
          },
        ],
      },
      KNOWN,
    );
    const { recommendations, replacements } = scrubContributorNames(
      [rec],
      ["Alice Smith", "Bob"],
    );
    expect(recommendations[0].problem).toBe(
      "a contributor checks every row; a contributor says it takes a day.",
    );
    // "Bob" is under three letters as a part, but matches as a full name.
    expect(recommendations[0].pilot.what).toBe("Ask a contributor to try it");
    expect(replacements).toBe(4);
  });

  test("a name that is also an ordinary word is matched by case only", () => {
    const [rec] = normalizeRecommendations(
      {
        recommendations: [
          { ...wellFormed, problem: "The team will check it. Will Jones decides." },
        ],
      },
      KNOWN,
    );
    const { recommendations } = scrubContributorNames([rec], ["Will Jones"]);
    expect(recommendations[0].problem).toBe(
      "The team will check it. a contributor decides.",
    );
  });
});

describe("automation-opportunity shape", () => {
  const base = {
    title: "Route tickets",
    nodeIds: ["triage"],
    content: {
      intervention: "workflow" as const,
      proposedChange: "Route them automatically.",
      openQuestions: ["Which queues?"],
    },
    scores: { evidence: { contributors: 2 } },
  };

  test("maps technical changes onto the kinds the old surfaces know", () => {
    expect(toAutomationOpportunity(base)).toEqual({
      title: "Route tickets",
      kind: "workflow",
      nodeIds: ["triage"],
      rationale: "Route them automatically.",
      prerequisites: ["Which queues?"],
      confidence: "high",
    });
    expect(
      toAutomationOpportunity({
        ...base,
        content: { ...base.content, intervention: "ai_assist" },
        scores: { evidence: { contributors: 1 } },
      }),
    ).toMatchObject({ kind: "agent", confidence: "medium" });
  });

  test("has no shape for a non-technical change", () => {
    expect(
      toAutomationOpportunity({
        ...base,
        content: { ...base.content, intervention: "simplify" },
      }),
    ).toBeNull();
  });
});

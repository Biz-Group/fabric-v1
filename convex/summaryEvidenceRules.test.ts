import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import { scoreSourceValidity } from "./lib/summaryEvaluation";
import {
  normalizeProcessOverviewArtifactV2,
  reapplyProcessEvidenceRules,
  SUMMARY_V2_PROMPT_VERSIONS,
  type SummaryNormalizationContext,
  type SummarySourceKeyMap,
} from "./summaryV2";

/**
 * Tasks 1.2 and 1.3 (docs/consultative-approach-task-list.md): "corroborated"
 * means two distinct people, and Consensus holds only corroborated findings.
 */

const conversation = (id: string, label: string) => ({
  kind: "conversation" as const,
  conversationId: id as Id<"conversations">,
  label,
});

// C1 and C2 are the same person interviewed twice; C3 is someone else; C4 is a
// group recording with two labelled speakers.
const sourceByKey: SummarySourceKeyMap = {
  C1: conversation("c1", "Alice"),
  C2: conversation("c2", "Alice"),
  C3: conversation("c3", "Ben"),
  C4: conversation("c4", "Workshop"),
};

const keys = {
  c1: ["user:alice"],
  c2: ["user:alice"],
  c3: ["user:ben"],
  c4: ["user:carla", "name:dev"],
};

function context(withKeys = true): SummaryNormalizationContext {
  return {
    sourceByKey,
    coverage: {
      includedSources: 4,
      totalEligibleSources: 4,
      uniqueContributors: 4,
      complete: true,
    },
    provenance: {
      sourceSnapshotHash: "sha256:test",
      generatedAt: 1_786_000_000_000,
      promptVersion: SUMMARY_V2_PROMPT_VERSIONS.processOverview,
      provider: "fabric-foundry",
      model: "test-model",
    },
    ...(withKeys ? { contributorKeysByConversationId: keys } : {}),
  };
}

const finding = (title: string, sourceKeys: string[]) => ({
  title,
  body: `${title} is described in the evidence.`,
  sourceKeys,
  evidenceLevel: "corroborated" as const,
});

function payload(overrides: Record<string, unknown>) {
  return {
    headline: "Requests are checked before approval",
    executiveBrief: "Contributors describe intake and approval.",
    scope: [],
    consensus: [],
    variations: [],
    gaps: [],
    notable: [],
    ...overrides,
  };
}

describe("corroborated needs two people", () => {
  test("two interviews with one person are a single source", () => {
    const artifact = normalizeProcessOverviewArtifactV2(
      payload({ scope: [finding("Same person twice", ["C1", "C2"])] }),
      context(),
    )!;
    expect(artifact.scope[0]).toMatchObject({
      evidenceLevel: "single_source",
      supportCount: 2,
      contributorCount: 1,
    });
  });

  test("two different people corroborate", () => {
    const artifact = normalizeProcessOverviewArtifactV2(
      payload({ scope: [finding("Two people", ["C1", "C3"])] }),
      context(),
    )!;
    expect(artifact.scope[0]).toMatchObject({
      evidenceLevel: "corroborated",
      contributorCount: 2,
    });
  });

  test("a group recording with two labelled speakers corroborates on its own", () => {
    const artifact = normalizeProcessOverviewArtifactV2(
      payload({ scope: [finding("Workshop", ["C4"])] }),
      context(),
    )!;
    expect(artifact.scope[0]).toMatchObject({
      evidenceLevel: "corroborated",
      supportCount: 1,
      contributorCount: 2,
    });
  });

  test("without identities, distinct labels stand in for people", () => {
    const artifact = normalizeProcessOverviewArtifactV2(
      payload({ scope: [finding("Same label twice", ["C1", "C2"])] }),
      context(false),
    )!;
    expect(artifact.scope[0].evidenceLevel).toBe("single_source");
  });
});

describe("consensus holds only agreement", () => {
  test("a one-person consensus finding moves to Notable with a new id", () => {
    const artifact = normalizeProcessOverviewArtifactV2(
      payload({
        consensus: [
          finding("Agreed by two", ["C1", "C3"]),
          finding("Said by one", ["C1", "C2"]),
        ],
        notable: [finding("Already notable", ["C3"])],
      }),
      context(),
    )!;
    expect(artifact.consensus.map((f) => f.title)).toEqual(["Agreed by two"]);
    expect(artifact.notable.map((f) => f.title)).toEqual([
      "Already notable",
      "Said by one",
    ]);
    expect(artifact.notable[1].id.startsWith("notable-")).toBe(true);
  });

  test("the release gate fails a stored artifact that still breaks the rules", () => {
    const artifact = normalizeProcessOverviewArtifactV2(
      payload({ scope: [finding("Two people", ["C1", "C3"])] }),
      context(),
    )!;
    const broken = {
      ...artifact,
      consensus: [
        {
          ...artifact.scope[0],
          id: "consensus-x",
          evidenceLevel: "corroborated" as const,
          contributorCount: 1,
        },
      ],
    };
    const codes = scoreSourceValidity(broken).violations.map((v) => v.code);
    expect(codes).toContain("evidence_level_mismatch");
    expect(codes).toContain("consensus_not_corroborated");
  });
});

describe("reapplying the rules to a stored overview", () => {
  test("downgrades, moves and recounts without touching provenance", () => {
    const stored = normalizeProcessOverviewArtifactV2(
      payload({
        consensus: [finding("Same person twice", ["C1", "C2"])],
      }),
      context(false),
    )!;
    // An overview written under the old rule, where two sources corroborated.
    const legacy = {
      ...stored,
      notable: [],
      consensus: [
        {
          id: "consensus-old",
          title: "Same person twice",
          body: "Same person twice is described in the evidence.",
          evidenceLevel: "corroborated" as const,
          supportCount: 2,
          sources: [sourceByKey.C1, sourceByKey.C2],
        },
      ],
    };
    const next = reapplyProcessEvidenceRules(legacy, keys, 1);
    expect(next.consensus).toEqual([]);
    expect(next.notable[0]).toMatchObject({
      title: "Same person twice",
      evidenceLevel: "single_source",
      contributorCount: 1,
    });
    expect(next.provenance).toEqual(legacy.provenance);
    expect(next.coverage.uniqueContributors).toBe(1);
    expect(scoreSourceValidity(next).passed).toBe(true);
  });
});

import { describe, expect, test } from "vitest";
import type { SummaryArtifactV2 } from "../summaryV2";
import { gapContributors } from "./signals";

/**
 * Consultative follow-up: a gap ranked by AskFabric counts the people behind
 * it, not the labels on its sources or its number of contributions.
 */

type Gap = SummaryArtifactV2["gaps"][number];

const source = (conversationId: string, label: string) =>
  ({ kind: "conversation", conversationId, label }) as Gap["sources"][number];

function gap(sources: Gap["sources"], extra: Partial<Gap> = {}): Gap {
  return {
    id: "gap-1",
    title: "Nobody owns escalations",
    body: "",
    evidenceLevel: "single_source",
    supportCount: sources.length || 2,
    sources,
    ...extra,
  } as Gap;
}

describe("gapContributors", () => {
  test("one person interviewed twice, under two labels, is one person", () => {
    const keys = new Map([
      ["c1", ["user:alice"]],
      ["c2", ["user:alice"]],
    ]);
    expect(gapContributors("p1", gap([source("c1", "Alice"), source("c2", "Alice Smith")]), keys)).toEqual([
      "user:alice",
    ]);
  });

  test("the same people give the same keys in any overview, so they merge", () => {
    const keys = new Map([
      ["c1", ["user:alice"]],
      ["c2", ["user:bob"]],
    ]);
    const finding = gap([source("c1", "Alice"), source("c2", "Bob")]);
    expect(gapContributors("process", finding, keys)).toEqual(gapContributors("department", finding, keys));
  });

  test("an unread source falls back to the finding's contributor count", () => {
    const keys = new Map([["c1", ["user:alice"]]]);
    const finding = gap([source("c1", "Alice"), source("c9", "Alice")], { contributorCount: 1 });
    expect(gapContributors("p1", finding, keys)).toHaveLength(1);
  });

  test("an older finding with no count keeps counting by label", () => {
    const finding = gap([source("c1", "Alice"), source("c2", "Alice")]);
    expect(gapContributors("p1", finding, undefined)).toEqual(["alice", "alice"]);
  });

  test("a finding with no contribution sources counts its contributors, not its support", () => {
    const finding = gap([], { supportCount: 3, contributorCount: 1 });
    expect(gapContributors("d1", finding, new Map())).toHaveLength(1);
  });
});

import { describe, expect, test } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ClientRecommendation } from "./recommendation-meta";
import { flattenNodes, groupRecommendations } from "./recommendation-tree";

function rec(
  id: string,
  overrides: Partial<ClientRecommendation> = {},
): ClientRecommendation {
  return {
    _id: id as Id<"processRecommendations">,
    source: "v2",
    lifecycle: "active",
    title: id,
    nodeIds: [],
    content: null,
    scores: null,
    legacy: null,
    buildsOnId: null,
    decisionStatus: "new",
    dismissReason: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const ids = (nodes: ReturnType<typeof groupRecommendations>["open"]) =>
  nodes.map((node) => [node.rec._id, node.followOns.map((f) => f._id)]);

describe("recommendation tree", () => {
  test("follow-ons nest under their parent, and the ranking of parents holds", () => {
    const groups = groupRecommendations(
      [
        // The follow-on is ranked first on its own score, but nests.
        rec("alerts", { buildsOnId: "rota" as Id<"processRecommendations"> }),
        rec("runbook"),
        rec("rota"),
      ],
      [],
    );
    expect(ids(groups.open)).toEqual([
      ["runbook", []],
      ["rota", ["alerts"]],
    ]);
    expect(flattenNodes(groups.open).map((r) => r._id)).toEqual([
      "runbook",
      "rota",
      "alerts",
    ]);
  });

  test("a follow-on goes where its parent goes, whatever its own decision", () => {
    const groups = groupRecommendations(
      [
        rec("rota", { decisionStatus: "dismissed" }),
        rec("alerts", {
          buildsOnId: "rota" as Id<"processRecommendations">,
          decisionStatus: "shortlisted",
        }),
      ],
      [],
    );
    expect(groups.open).toEqual([]);
    expect(ids(groups.dismissed)).toEqual([["rota", ["alerts"]]]);
  });

  test("a follow-on whose parent is no longer recommended stays with it", () => {
    const groups = groupRecommendations(
      [rec("alerts", { buildsOnId: "rota" as Id<"processRecommendations"> })],
      [rec("rota", { lifecycle: "absent_from_latest", decisionStatus: "shortlisted" })],
    );
    expect(groups.open).toEqual([]);
    expect(ids(groups.earlier)).toEqual([["rota", ["alerts"]]]);
  });

  test("a follow-on with no parent to sit under is shown at the top level", () => {
    const groups = groupRecommendations(
      [
        rec("orphan", { buildsOnId: "gone" as Id<"processRecommendations"> }),
        rec("a"),
        rec("b", { buildsOnId: "a" as Id<"processRecommendations"> }),
        // Nested under a follow-on: one level only, so it surfaces.
        rec("c", { buildsOnId: "b" as Id<"processRecommendations"> }),
      ],
      [],
    );
    expect(ids(groups.open)).toEqual([
      ["orphan", []],
      ["a", ["b"]],
      ["c", []],
    ]);
  });
});

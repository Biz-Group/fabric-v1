import { describe, expect, test } from "vitest";
import {
  contributorKeys,
  contributorKeysFor,
  countDistinctContributors,
  resolveSourceRefs,
  uncitedContributionPositions,
  type ContributorIdentityRow,
} from "./contributorIdentity";

describe("uncitedContributionPositions", () => {
  test("reports a contribution no step cites", () => {
    expect(
      uncitedContributionPositions([["Ana, Conv. 1"], ["Conv. 1"]], 2),
    ).toEqual([2]);
  });

  test("reports nothing when every contribution is cited somewhere", () => {
    expect(
      uncitedContributionPositions([["Conv. 1"], ["Ben, Conversation 2"]], 2),
    ).toEqual([]);
  });

  test("reports nothing when no step cites anything: missing sources, not a drop", () => {
    expect(uncitedContributionPositions([[], ["the team"]], 3)).toEqual([]);
  });

  test("reports nothing for a flow built from one contribution", () => {
    expect(uncitedContributionPositions([["Conv. 1"]], 1)).toEqual([]);
  });

  test("ignores references past the flow's count", () => {
    expect(
      uncitedContributionPositions([["Conv. 1"], ["Conv. 7"]], 3),
    ).toEqual([2, 3]);
  });
});

function row(overrides: Partial<ContributorIdentityRow>): ContributorIdentityRow {
  return { contributorName: "Alice Smith", ...overrides };
}

describe("contributorKeys", () => {
  test("an interview stands for its own account", () => {
    expect(contributorKeys(row({ userId: "u1" }))).toEqual(["user:u1"]);
  });

  test("the same person interviewed twice is one contributor", () => {
    expect(
      countDistinctContributors([row({ userId: "u1" }), row({ userId: "u1" })]),
    ).toBe(1);
  });

  test("on behalf of a picked member counts the member, not the submitter", () => {
    expect(
      contributorKeys(
        row({ userId: "consultant", subjectUserId: "u2", submittedByName: "Bob" }),
      ),
    ).toEqual(["user:u2"]);
  });

  test("on behalf of a typed name counts the name, so one consultant's recordings stay separate people", () => {
    const first = row({
      contributorName: "Dana Lee",
      userId: "consultant",
      submittedByName: "Bob",
    });
    const second = row({
      contributorName: "Eli Ford",
      userId: "consultant",
      submittedByName: "Bob",
    });
    expect(countDistinctContributors([first, second])).toBe(2);
  });

  test("each named speaker in a group recording counts, by member when linked", () => {
    const keys = contributorKeys(
      row({
        userId: "u1",
        speakerLabels: [
          { displayName: "Alice Smith", userId: "u1" },
          { displayName: "Carlos  Ruiz" },
        ],
      }),
    );
    expect(keys).toEqual(["user:u1", "name:carlos ruiz"]);
  });

  test("default speaker labels are not people", () => {
    expect(
      contributorKeys(
        row({
          userId: "u1",
          speakerLabels: [{ displayName: "Speaker 1" }, { displayName: "speaker 2" }],
        }),
      ),
    ).toEqual(["user:u1"]);
  });
});

describe("one person under two keys", () => {
  test("an unlinked speaker label with an interviewee's name is that interviewee", () => {
    const interview = row({ contributorName: "Alice Smith", userId: "u1" });
    const workshop = row({
      contributorName: "Ben",
      userId: "u2",
      speakerLabels: [{ displayName: "alice smith" }, { displayName: "Ben", userId: "u2" }],
    });
    expect(countDistinctContributors([interview, workshop])).toBe(2);
    expect(contributorKeysFor([interview, workshop])[1]).toEqual(["user:u1", "user:u2"]);
  });

  test("an on-behalf recording typed with a member's interview name is that member", () => {
    const interview = row({ contributorName: "Dana Lee", userId: "u3" });
    const onBehalf = row({ contributorName: "Dana Lee", userId: "consultant", submittedByName: "Bob" });
    expect(countDistinctContributors([interview, onBehalf])).toBe(1);
  });

  test("names with no account stay separate people", () => {
    const a = row({ contributorName: "Eli Ford", userId: "c", submittedByName: "Bob" });
    const b = row({ contributorName: "Fay Gold", userId: "c", submittedByName: "Bob" });
    expect(countDistinctContributors([a, b])).toBe(2);
  });
});

describe("resolveSourceRefs", () => {
  const conversations = [
    row({ userId: "u1" }),
    row({ userId: "u1" }),
    row({ contributorName: "Ben", userId: "u2" }),
  ].map(contributorKeys);

  test("resolves references, not the names written beside them", () => {
    const resolved = resolveSourceRefs(
      ["Alice, Conv. 1", "A. Smith, Conv. 2", "Alice Smith, Conv. 2"],
      conversations,
    );
    expect([...resolved.conversations]).toEqual([1, 2]);
    expect(resolved.contributors.size).toBe(1);
  });

  test("two people across references", () => {
    const resolved = resolveSourceRefs(["Alice, Conv. 1", "Ben, Conv. 3"], conversations);
    expect(resolved.contributors.size).toBe(2);
  });

  test("a missing or out-of-range reference is no evidence", () => {
    const resolved = resolveSourceRefs(["Alice", "Zed, Conv. 9"], conversations);
    expect(resolved.conversations.size).toBe(0);
    expect(resolved.contributors.size).toBe(0);
  });

  test("'Conversation N' written out is the same reference", () => {
    const resolved = resolveSourceRefs(["Alice, Conversation 3", "Ben, Conv. 3"], conversations);
    expect([...resolved.conversations]).toEqual([3]);
    expect(resolved.contributors.size).toBe(1);
  });

  test("one source string can carry several references", () => {
    const resolved = resolveSourceRefs(["Alice, Conv. 1; Ben, Conv. 3"], conversations);
    expect(resolved.conversations.size).toBe(2);
  });
});

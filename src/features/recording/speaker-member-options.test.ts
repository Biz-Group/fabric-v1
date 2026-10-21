import { describe, expect, it } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  buildMemberOptions,
  isSameMember,
  NO_LINKED_MEMBER,
  type MemberOption,
} from "./speaker-member-options";

function member(id: string, name: string, email = `${id}@example.com`): MemberOption {
  return { userId: id as Id<"users">, name, email };
}

describe("buildMemberOptions", () => {
  it("leads with No linked member, then the results", () => {
    const options = buildMemberOptions(
      [member("a", "Amal"), member("b", "Bilal")],
      NO_LINKED_MEMBER,
    );
    expect(options.map((o) => o.name)).toEqual([
      "No linked member",
      "Amal",
      "Bilal",
    ]);
  });

  it("keeps a selection the search didn't return", () => {
    const selected = member("z", "Zainab");
    const options = buildMemberOptions([member("a", "Amal")], selected);
    expect(options.map((o) => o.userId)).toEqual([null, "z", "a"]);
  });

  it("doesn't repeat a selection the search did return", () => {
    const selected = member("a", "Amal");
    const options = buildMemberOptions([member("a", "Amal")], selected);
    expect(options).toHaveLength(2);
  });

  it("keeps two members with the same name apart", () => {
    const options = buildMemberOptions(
      [member("a", "Sam Lee", "sam@one.com"), member("b", "Sam Lee", "sam@two.com")],
      NO_LINKED_MEMBER,
    );
    expect(options.slice(1).map((o) => o.email)).toEqual([
      "sam@one.com",
      "sam@two.com",
    ]);
  });
});

describe("isSameMember", () => {
  it("compares by user id, not object identity", () => {
    expect(isSameMember(member("a", "Amal"), member("a", "Amal (old name)"))).toBe(true);
    expect(isSameMember(NO_LINKED_MEMBER, { ...NO_LINKED_MEMBER })).toBe(true);
    expect(isSameMember(member("a", "Amal"), NO_LINKED_MEMBER)).toBe(false);
  });
});

import type { Id } from "../../../convex/_generated/dataModel";

export type MemberOption = {
  userId: Id<"users"> | null;
  name: string;
  email: string;
};

/** The option for a speaker who isn't a workspace member. */
export const NO_LINKED_MEMBER: MemberOption = {
  userId: null,
  name: "No linked member",
  email: "",
};

/**
 * The picker's options: "No linked member" first, then the search results.
 * The current selection is kept even when the search doesn't return it, so
 * typing never makes a linked member disappear from the list.
 */
export function buildMemberOptions(
  results: readonly MemberOption[],
  selected: MemberOption,
): MemberOption[] {
  const options: MemberOption[] = [NO_LINKED_MEMBER];
  const seen = new Set<string>();
  for (const member of results) {
    if (!member.userId || seen.has(member.userId)) continue;
    seen.add(member.userId);
    options.push(member);
  }
  if (selected.userId && !seen.has(selected.userId)) {
    options.splice(1, 0, selected);
  }
  return options;
}

export function isSameMember(a: MemberOption, b: MemberOption): boolean {
  return a.userId === b.userId;
}

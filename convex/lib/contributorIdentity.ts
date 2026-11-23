import { normalizedSemanticText } from "./textNormalization";

/**
 * Who a contribution stands for, and who a piece of generated evidence rests on.
 *
 * Every count of "contributors" goes through here: coverage, an overview
 * finding's evidence level, a step's confidence and a recommendation's evidence
 * line. Before this, each surface counted differently — the overview by name
 * label, coverage by account id, scoring by names parsed out of model-written
 * text — so one person interviewed twice could read as two contributors on one
 * surface and one on another. See docs/consultative-approach-task-list.md 1.1.
 */

/** The fields of a `conversations` row this needs. */
export type ContributorIdentityRow = {
  contributorName: string;
  userId?: string | null;
  subjectUserId?: string | null;
  submittedByName?: string | null;
  speakerLabels?: ReadonlyArray<{
    displayName: string;
    userId?: string | null;
  }> | null;
};

/** The label a speaker gets until someone names them ("Speaker 1"). */
const DEFAULT_SPEAKER_LABEL = /^speaker\s*\d+$/i;

function nameKey(name: string): string | null {
  const normalized = normalizedSemanticText(name);
  return normalized ? `name:${normalized}` : null;
}

function userKey(userId: string): string {
  return `user:${userId}`;
}

/**
 * The person whose knowledge the contribution captures.
 *
 * `userId` is always the submitting account, so it only identifies the subject
 * when the contribution was not made on someone else's behalf. An on-behalf
 * contribution with no member picked is known only by the typed name; falling
 * back to the submitter there would merge everyone one consultant recorded.
 */
function subjectKey(row: ContributorIdentityRow): string {
  if (row.subjectUserId) return userKey(row.subjectUserId);
  const onBehalf = Boolean(row.submittedByName);
  if (!onBehalf && row.userId) return userKey(row.userId);
  return nameKey(row.contributorName) ?? (row.userId ? userKey(row.userId) : "name:");
}

/**
 * The people one contribution stands for (decision P1-D5, 23 Nov 2026).
 *
 * A recording with labelled speakers counts each named speaker, keyed by the
 * linked member when there is one. Default labels nobody renamed are not
 * people we can name, so they do not count. With no qualifying speaker, the
 * contribution stands for its subject.
 */
export function contributorKeys(row: ContributorIdentityRow): string[] {
  const keys = new Set<string>();
  for (const label of row.speakerLabels ?? []) {
    if (label.userId) {
      keys.add(userKey(label.userId));
      continue;
    }
    const name = label.displayName.trim();
    if (!name || DEFAULT_SPEAKER_LABEL.test(name)) continue;
    const key = nameKey(name);
    if (key) keys.add(key);
  }
  if (keys.size === 0) keys.add(subjectKey(row));
  return [...keys];
}

/**
 * Names the contributions themselves tie to an account: an interview's subject
 * name, or a speaker label linked to a member. Used to fold a bare name key
 * into that account, so a person interviewed under their account and also
 * named on an unlinked speaker label, or typed in an on-behalf recording, is
 * one person, not two who corroborate each other.
 */
function accountAliases(
  rows: Iterable<ContributorIdentityRow>,
): Map<string, string> {
  const aliases = new Map<string, string>();
  const add = (name: string, account: string) => {
    const key = nameKey(name);
    if (key && !aliases.has(key)) aliases.set(key, account);
  };
  for (const row of rows) {
    const subject = subjectKey(row);
    if (subject.startsWith("user:")) add(row.contributorName, subject);
    for (const label of row.speakerLabels ?? []) {
      if (label.userId) add(label.displayName, userKey(label.userId));
    }
  }
  return aliases;
}

/**
 * `contributorKeys` for each row, with bare name keys folded into the account
 * the same set of contributions ties that name to. Use this whenever people
 * are counted across several contributions.
 */
export function contributorKeysFor(
  rows: ReadonlyArray<ContributorIdentityRow>,
): string[][] {
  const aliases = accountAliases(rows);
  return rows.map((row) => [
    ...new Set(contributorKeys(row).map((key) => aliases.get(key) ?? key)),
  ]);
}

/** Distinct people across a set of contributions. */
export function countDistinctContributors(
  rows: ReadonlyArray<ContributorIdentityRow>,
): number {
  return new Set(contributorKeysFor(rows).flat()).size;
}

const CONVERSATION_REF = /Conv\.\s*(\d+)/g;

export type ResolvedSources = {
  /** 1-based `Conv. N` positions that resolved to a contribution. */
  conversations: Set<number>;
  /** The people those contributions stand for. */
  contributors: Set<string>;
};

/**
 * Resolves model-written step sources ("Name, Conv. N") against the
 * contributions the flow was built from, in the flow's evidence order (done
 * contributions, oldest first — `getFlowGenerationData`). Each entry of
 * `keysInOrder` is one contribution's `contributorKeys`. Only the reference
 * counts; the name the model wrote beside it is ignored, so a name spelt two
 * ways, or a speaker named inside an interview, cannot become an extra person.
 * A source with no resolvable reference is no evidence at all.
 */
export function resolveSourceRefs(
  sources: Iterable<string>,
  keysInOrder: ReadonlyArray<readonly string[]>,
): ResolvedSources {
  const conversations = new Set<number>();
  const contributors = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(CONVERSATION_REF)) {
      const position = Number(match[1]);
      const keys = keysInOrder[position - 1];
      if (!keys || conversations.has(position)) continue;
      conversations.add(position);
      for (const key of keys) contributors.add(key);
    }
  }
  return { conversations, contributors };
}

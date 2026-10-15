import { userError } from "./userError";

export const MAX_JOB_TITLE_LENGTH = 120;

/** Lower-cased haystack for the `search_member` index. */
export function memberSearchText(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

/**
 * The job title and search text a membership row carries. An admin's
 * org-scoped correction (`jobTitleOverride`) wins over the member's own
 * profile title, so every profile sync must go through here or it would
 * silently undo the admin's edit.
 */
export function membershipTitleFields(
  display: { name: string; email: string; jobTitle?: string },
  jobTitleOverride: string | undefined,
): { jobTitle: string | undefined; searchText: string } {
  const jobTitle = jobTitleOverride ?? display.jobTitle;
  return {
    jobTitle,
    searchText: memberSearchText([display.name, display.email, jobTitle]),
  };
}

/** Trimmed admin-entered job title; empty means "use the member's own". */
export function normalizeJobTitleOverride(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_JOB_TITLE_LENGTH) {
    throw userError(
      "JOB_TITLE_TOO_LONG",
      `Job title must be ${MAX_JOB_TITLE_LENGTH} characters or fewer.`,
    );
  }
  return trimmed;
}

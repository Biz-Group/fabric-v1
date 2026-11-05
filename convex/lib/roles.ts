/**
 * Role rules shared by the server and the UI. Pure, so client code can import
 * it without pulling in server modules.
 */

export type MemberRole = "admin" | "contributor" | "viewer";

/**
 * Who can add contributions: start an AI interview, record a voice note or
 * upload files. Mirrors `requireOrgContributor`, which enforces it.
 */
export function canContribute(role: MemberRole | null | undefined): boolean {
  return role === "admin" || role === "contributor";
}

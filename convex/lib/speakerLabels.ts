/**
 * Who may name the speakers on a voice recording (Saish, 2026-11-16): whoever
 * submitted it, the person it was recorded on behalf of, or an admin. Labels
 * say who said what and can tie a speaker to any member, so it's limited to
 * the people who know the recording. Pure, so the workbench shows the
 * labelling panel to exactly the people the server accepts it from.
 */
export function canLabelSpeakers(
  caller: { role: string; userId: string },
  conversation: { userId?: string | null; subjectUserId?: string | null },
): boolean {
  return (
    caller.role === "admin" ||
    conversation.userId === caller.userId ||
    conversation.subjectUserId === caller.userId
  );
}

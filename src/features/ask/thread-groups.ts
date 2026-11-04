/**
 * The thread list's sections: pinned threads, then the rest by the day of
 * their latest activity in the viewer's own time zone. Derived from each
 * thread's `lastMessageAt`, so every existing thread is grouped too.
 */

type Dated = { lastMessageAt: number };

export type ThreadSection<T> = { key: string; label: string; threads: T[] };

function startOfDay(at: number, daysBack = 0): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  // Calendar days, so a daylight-saving change never shifts a boundary.
  day.setDate(day.getDate() - daysBack);
  return day.getTime();
}

/** Non-empty sections in order; `pinned` is its own section and isn't dated. */
export function threadSections<T extends Dated>(pinned: T[], threads: T[], now: number): ThreadSection<T>[] {
  const today = startOfDay(now);
  const yesterday = startOfDay(now, 1);
  const weekStart = startOfDay(now, 6);
  const sections: ThreadSection<T>[] = [
    { key: "pinned", label: "Pinned", threads: pinned },
    { key: "today", label: "Today", threads: [] },
    { key: "yesterday", label: "Yesterday", threads: [] },
    { key: "week", label: "Previous 7 days", threads: [] },
    { key: "older", label: "Older", threads: [] },
  ];
  for (const thread of threads) {
    const at = thread.lastMessageAt;
    // Clock skew can put a thread a moment in the future; it reads as today.
    const index = at >= today ? 1 : at >= yesterday ? 2 : at >= weekStart ? 3 : 4;
    sections[index].threads.push(thread);
  }
  return sections.filter((section) => section.threads.length > 0);
}

/** A thread's latest activity, short enough to sit at the end of its row. */
export function threadTime(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

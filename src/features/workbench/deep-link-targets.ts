import type { useSearchParams } from "next/navigation";

/**
 * One-shot targets inside an opened view (FR-5.3, FR-5.4): a finding to
 * scroll to, and a transcript line to open on. AskFabric citations link with
 * `finding=`, `line=` and `t=`.
 *
 * The workbench rewrites the URL soon after it loads, and that write drops
 * these parameters (`buildSelectionQuery`), while the overview and transcript
 * mount later, once their data arrives. So the workbench captures them on
 * mount, as it does `conv`, and each view takes its target once.
 */
type Targets = { finding: string | null; line: number | null; seconds: number | null };

let pending: Targets = { finding: null, line: null, seconds: null };

export function captureDeepLinkTargets(searchParams: URLSearchParams | ReturnType<typeof useSearchParams>) {
  const line = Number(searchParams.get("line"));
  const t = searchParams.get("t");
  const seconds = t === null ? NaN : Number(t);
  pending = {
    finding: searchParams.get("finding"),
    line: Number.isInteger(line) && line > 0 ? line : null,
    seconds: Number.isFinite(seconds) && seconds >= 0 ? seconds : null,
  };
}

/**
 * The pending finding, left in place: the workbench can mount an overview in
 * its desktop and phone layouts at once, and only the visible copy should
 * consume it (`clearFindingTarget`).
 */
export function peekFindingTarget(): string | null {
  return pending.finding;
}

export function clearFindingTarget() {
  pending = { ...pending, finding: null };
}

export function takeTranscriptTarget(): { line: number | null; seconds: number | null } {
  const target = { line: pending.line, seconds: pending.seconds };
  pending = { ...pending, line: null, seconds: null };
  return target;
}

/**
 * The transcript index a citation link points at: the 1-based `line` when it
 * is still in range, otherwise the line playing at `seconds`, otherwise null.
 */
export function linkedTranscriptIndex(
  transcript: Array<{ time_in_call_secs: number }>,
  target: { line: number | null; seconds: number | null },
): number | null {
  if (target.line !== null && target.line <= transcript.length) return target.line - 1;
  if (target.seconds === null || transcript.length === 0) return null;
  let index = 0;
  for (let i = 0; i < transcript.length; i++) {
    if (transcript[i].time_in_call_secs <= target.seconds) index = i;
    else break;
  }
  return index;
}

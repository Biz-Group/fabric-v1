import type { AskMessagePart } from "../../../convex/lib/askSchema";

/**
 * The visible work of an answer (FR-2.15, D47) as pure data: the steps of the
 * thought trace, its header, and the status line. The components only render.
 */

export type MessageStatus = "streaming" | "complete" | "stopped" | "error" | null;

export type TraceStep =
  | { kind: "reasoning"; key: string; text: string; status: "active" | "done"; durationMs: number | null }
  | {
      kind: "tool";
      key: string;
      label: string;
      status: "active" | "done" | "failed";
      resultCount: number | null;
      durationMs: number | null;
    };

export function traceSteps(parts: AskMessagePart[], status: MessageStatus): TraceStep[] {
  const steps: TraceStep[] = [];
  const working = status === "streaming";
  parts.forEach((part, index) => {
    const key = `${part.type}-${index}`;
    if (part.type === "reasoning") {
      const open = part.endedAt === undefined && working && index === parts.length - 1;
      steps.push({
        kind: "reasoning",
        key,
        text: part.text,
        status: open ? "active" : "done",
        durationMs: part.endedAt !== undefined ? part.endedAt - part.startedAt : null,
      });
    } else if (part.type === "tool") {
      steps.push({
        kind: "tool",
        key,
        label: part.label,
        status: part.status === "running" ? (working ? "active" : "failed") : part.status,
        resultCount: part.resultCount ?? null,
        durationMs: part.endedAt !== undefined ? part.endedAt - part.startedAt : null,
      });
    }
  });
  return steps;
}

export function answerText(parts: AskMessagePart[]): string {
  return parts
    .filter((part): part is Extract<AskMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
}

/** Seconds spent on the trace's steps: first start to last end. At least 1. */
function traceSeconds(parts: AskMessagePart[], endFallback: number | null): number {
  const timed = parts.filter(
    (part): part is Extract<AskMessagePart, { type: "reasoning" | "tool" }> => part.type !== "text",
  );
  if (timed.length === 0) return 0;
  const start = Math.min(...timed.map((part) => part.startedAt));
  const ends = timed.map((part) => part.endedAt ?? part.startedAt);
  const end = Math.max(...ends, endFallback ?? 0);
  return Math.max(1, Math.round((end - start) / 1000));
}

export function traceHeader(
  parts: AskMessagePart[],
  status: MessageStatus,
  completedAt: number | null,
): string {
  const steps = traceSteps(parts, status).length;
  if (status === "streaming") return "Working…";
  const seconds = traceSeconds(parts, completedAt);
  if (status === "stopped") return `Stopped after ${seconds}s`;
  return `Thought for ${seconds}s · ${steps} step${steps === 1 ? "" : "s"}`;
}

/** The trace is open while the agent works, and folds once the answer starts. */
export function traceDefaultOpen(parts: AskMessagePart[], status: MessageStatus): boolean {
  return status === "streaming" && answerText(parts) === "";
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").replace(/[*_#`]/g, "").trim();
  const match = flat.match(/^(.{1,160}?[.!?])(\s|$)/);
  const sentence = match ? match[1] : flat.slice(0, 160);
  return sentence.length < flat.length && !match ? `${sentence}…` : sentence;
}

/**
 * The one-line status under the question while the answer is being worked on:
 * "Thinking…" until something happens, then the active tool's label or the
 * latest reasoning's first sentence. Null once answer text exists or the turn
 * is over.
 */
export function statusLine(parts: AskMessagePart[], status: MessageStatus): string | null {
  if (status !== "streaming" || answerText(parts) !== "") return null;
  const last = [...parts].reverse().find((part) => part.type !== "text");
  if (!last) return "Thinking…";
  if (last.type === "tool") return last.status === "running" ? `${last.label}…` : "Thinking…";
  if (last.type === "reasoning") return firstSentence(last.text) || "Thinking…";
  return "Thinking…";
}

/** FR-2.9 copy, per stored error reason. */
export const ERROR_MESSAGES: Record<string, string> = {
  modelError: "Something went wrong. Try again.",
  busy: "AskFabric is busy. Try again in a minute.",
  refusal: "I can't help with that request.",
  truncated: "This answer was cut short, so it's incomplete.",
  accessLost: "You no longer have access to this workspace.",
  deadline: "This answer took too long. Try again, or ask something narrower.",
  unfinished: "This answer didn't finish.",
};

export function errorMessage(reason: string | null): string {
  return (reason && ERROR_MESSAGES[reason]) || ERROR_MESSAGES.modelError;
}

/** Citation markers in stored answer text, as markdown links the renderer turns into chips. */
export function markersToLinks(text: string): string {
  return text.replace(/\[\[cite:(\d+)\]\]/g, (_match, n: string) => `[${n}](cite:${n})`);
}

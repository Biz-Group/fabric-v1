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
 * Before the first step there is nothing to show but time: the model is
 * planning which tools to call. Usually a few seconds; rarely half a minute,
 * when the model service is slow. Each line says what is true at that point.
 */
export function waitingLine(elapsedMs: number): string {
  if (elapsedMs < 8_000) return "Thinking…";
  if (elapsedMs < 20_000) return "Working out where to look…";
  return "Still working. Some answers take up to a minute…";
}

/**
 * The one-line status under the question while the answer is being worked on:
 * the waiting line until something happens, then the active tool's label, the
 * latest reasoning's first sentence, or "Reading what it found…" between a
 * finished tool and the next step. Null once answer text exists or the turn
 * is over.
 */
export function statusLine(parts: AskMessagePart[], status: MessageStatus, elapsedMs = 0): string | null {
  if (status !== "streaming" || answerText(parts) !== "") return null;
  const last = [...parts].reverse().find((part) => part.type !== "text");
  if (!last) return waitingLine(elapsedMs);
  if (last.type === "tool") return last.status === "running" ? `${last.label}…` : "Reading what it found…";
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

/**
 * The answer as copied: markdown with plain [n] markers, then the sources
 * those markers point to, so the numbers still mean something when pasted.
 */
export function copyableAnswer(text: string, citations: { ordinal: number; title: string }[]): string {
  const body = text.replace(/\[\[cite:(\d+)\]\]/g, "[$1]");
  const cited = new Set([...body.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])));
  const sources = citations
    .filter((citation) => cited.has(citation.ordinal))
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((citation) => `[${citation.ordinal}] ${citation.title}`);
  return sources.length ? `${body}\n\nSources\n${sources.join("\n")}` : body;
}

/** Citation markers in stored answer text, as markdown links the renderer turns into chips. */
export function markersToLinks(text: string): string {
  return text.replace(/\[\[cite:(\d+)\]\]/g, (_match, n: string) => `[${n}](cite:${n})`);
}

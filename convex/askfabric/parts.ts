import type { AskMessagePart, AskToolName } from "../lib/askSchema";
import { parseFabricSource, type ParsedSource } from "../askTools/results";
import type { AskContentBlock } from "./modelClient";

/**
 * A turn's visible activity as ordered message parts (FR-2.3, FR-2.15).
 *
 * Text is held until its step ends: only then is it known whether the step
 * ends in tool calls (the text was a progress note, shown in the trace as a
 * reasoning part) or in the answer. S2 found that Foundry delivers the final
 * answer in one burst anyway, so holding costs nothing visible, and the trace
 * never folds early on a note that was not the answer.
 */
export class TurnParts {
  readonly parts: AskMessagePart[] = [];
  private openReasoning: Extract<AskMessagePart, { type: "reasoning" }> | null = null;
  firstVisibleAt: number | null = null;

  private visible(now: number) {
    if (this.firstVisibleAt === null) this.firstVisibleAt = now;
  }

  startReasoning(now: number) {
    this.endReasoning(now);
    this.openReasoning = { type: "reasoning", text: "", startedAt: now };
  }

  appendReasoning(text: string, now: number) {
    if (!this.openReasoning) this.startReasoning(now);
    const part = this.openReasoning!;
    // Empty thinking blocks produce no part (FR-2.3): it joins the list on its
    // first text.
    if (part.text === "") {
      this.parts.push(part);
      this.visible(now);
    }
    part.text += text;
  }

  endReasoning(now: number) {
    if (this.openReasoning && this.openReasoning.text !== "") this.openReasoning.endedAt = now;
    this.openReasoning = null;
  }

  /** Text from a step that ended in tool calls. */
  addProgressNote(text: string, startedAt: number, now: number) {
    const trimmed = stripCitationMarkers(text).trim();
    if (!trimmed) return;
    this.parts.push({ type: "reasoning", text: trimmed, startedAt, endedAt: now });
    this.visible(now);
  }

  startTool(name: AskToolName, label: string, now: number): number {
    this.endReasoning(now);
    this.parts.push({ type: "tool", name, status: "running", label, startedAt: now });
    this.visible(now);
    return this.parts.length - 1;
  }

  endTool(index: number, status: "done" | "failed", resultCount: number | undefined, now: number) {
    const part = this.parts[index];
    if (part?.type !== "tool") return;
    this.parts[index] = { ...part, status, endedAt: now, ...(resultCount !== undefined ? { resultCount } : {}) };
  }

  setAnswer(text: string, now: number) {
    this.endReasoning(now);
    const existing = this.parts.findIndex((part) => part.type === "text");
    if (existing !== -1) this.parts.splice(existing, 1);
    if (text) {
      this.parts.push({ type: "text", text });
      this.visible(now);
    }
  }

  /** Marks running tools failed, e.g. when a turn stops mid-step. */
  closeOpen(now: number) {
    this.endReasoning(now);
    for (const [index, part] of this.parts.entries()) {
      if (part.type === "tool" && part.status === "running") this.endTool(index, "failed", undefined, now);
    }
  }

  snapshot(): AskMessagePart[] {
    return this.parts.map((part) => ({ ...part }));
  }
}

// ---- Citations -------------------------------------------------------------------

/**
 * Inline marker for citation chip `n` in stored answer text. The UI renders
 * it as a chip; history replay keeps it so later turns can see what was cited.
 */
export function citationMarker(ordinal: number): string {
  return `[[cite:${ordinal}]]`;
}

const MARKER = /\[\[cite:\d+\]\]/g;

export function stripCitationMarkers(text: string): string {
  return text.replace(MARKER, "");
}

export type AnswerCitation = {
  ordinal: number;
  source: string;
  parsed: ParsedSource;
  title: string;
  citedText: string;
};

/**
 * The answer text with a marker after each cited span, and one citation per
 * distinct source: repeated sources reuse their number (FR-5.1). A citation
 * whose source isn't a Fabric source is dropped rather than shown unresolvable.
 */
export function answerFromBlocks(content: AskContentBlock[]): {
  text: string;
  citations: AnswerCitation[];
} {
  const citations: AnswerCitation[] = [];
  const ordinalBySource = new Map<string, number>();
  let text = "";
  for (const block of content) {
    if (block.type !== "text") continue;
    const { text: blockText, citations: blockCitations } = block as Extract<AskContentBlock, { type: "text" }>;
    text += blockText;
    const markers: number[] = [];
    for (const citation of blockCitations ?? []) {
      if (!citation.source) continue;
      const parsed = parseFabricSource(citation.source);
      if (!parsed) continue;
      let ordinal = ordinalBySource.get(citation.source);
      if (ordinal === undefined) {
        ordinal = citations.length + 1;
        ordinalBySource.set(citation.source, ordinal);
        citations.push({
          ordinal,
          source: citation.source,
          parsed,
          title: citation.title ?? citation.source,
          citedText: citation.cited_text ?? "",
        });
      }
      if (!markers.includes(ordinal)) markers.push(ordinal);
    }
    text += markers.map(citationMarker).join("");
  }
  return { text: text.trim(), citations };
}

/** Plain text of a step's text blocks, for progress notes. */
export function stepText(content: AskContentBlock[]): string {
  return content
    .filter((block): block is Extract<AskContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}

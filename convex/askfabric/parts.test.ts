import { describe, expect, test } from "vitest";
import { answerFromBlocks } from "./parts";

const cite = (source: string, title: string, cited_text: string) => ({ type: "search_result_location" as const, source, title, cited_text });

describe("answerFromBlocks (FR-5.1)", () => {
  test("results sharing a source keep their own numbers and text; a repeated result reuses its number", () => {
    const step = "fabric:flow-node/p1/configure-database";
    const { text, citations } = answerFromBlocks([
      { type: "text", text: "Convex stores the data", citations: [cite(step, "System: Convex", "Convex. No pain points recorded.")] },
      { type: "text", text: " and Supabase is the alternative", citations: [cite(step, "System: Supabase", "Supabase. No pain points recorded.")] },
      { type: "text", text: "; Convex again.", citations: [cite(step, "System: Convex", "Convex. No pain points recorded.")] },
    ]);
    expect(text).toBe("Convex stores the data[[cite:1]] and Supabase is the alternative[[cite:2]]; Convex again.[[cite:1]]");
    expect(citations.map((c) => [c.ordinal, c.title, c.citedText])).toEqual([
      [1, "System: Convex", "Convex. No pain points recorded."],
      [2, "System: Supabase", "Supabase. No pain points recorded."],
    ]);
  });
});

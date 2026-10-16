import { describe, expect, it } from "vitest";
import { noConversationsMessage } from "./pending-conversations";

describe("noConversationsMessage", () => {
  it("names contributions still processing", () => {
    expect(noConversationsMessage({ processing: 1, needsLabels: 0 })).toMatch(
      /^1 contribution is still processing/,
    );
    expect(noConversationsMessage({ processing: 3, needsLabels: 2 })).toMatch(
      /^3 contributions are still processing/,
    );
  });

  it("names contributions waiting for speaker labels", () => {
    expect(noConversationsMessage({ processing: 0, needsLabels: 2 })).toBe(
      "2 contributions need speaker labels before they can be used.",
    );
  });

  it("asks for a first contribution when none are pending", () => {
    expect(noConversationsMessage({ processing: 0, needsLabels: 0 })).toBe(
      "Add at least one contribution first.",
    );
  });
});

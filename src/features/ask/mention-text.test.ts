import { describe, expect, test } from "vitest";
import { MENTION_MARK as M, activeMentions, deleteMentionBefore, insertMention, mentionSegments, plainText } from "./mention-text";

describe("inline mentions (FR-4.3)", () => {
  test("replaces the typed @ with the mention, inline at the caret", () => {
    const text = "What are the issues identified within @?";
    expect(insertMention(text, text.length - 1, "Product Building")).toEqual({
      text: `What are the issues identified within ${M}Product Building ?`,
      caret: `What are the issues identified within ${M}Product Building `.length,
    });
  });

  test("adds a space before the token when needed, and none twice after it", () => {
    expect(insertMention("Compare", 7, "Payroll").text).toBe(`Compare ${M}Payroll `);
    expect(insertMention("Compare  and", 8, "Payroll").text).toBe(`Compare ${M}Payroll and`);
    expect(insertMention("", 0, "Payroll")).toEqual({ text: `${M}Payroll `, caret: 9 });
  });

  test("a mention stays only while its token is in the text", () => {
    const mentions = [{ name: "Payroll" }, { name: "Treasury" }];
    expect(activeMentions(mentions, `How does ${M}Payroll hand off?`)).toEqual([{ name: "Payroll" }]);
    expect(activeMentions(mentions, `How does ${M}Payrol hand off?`)).toEqual([]);
  });

  test("splits text into plain runs and tokens, longest name first", () => {
    expect(mentionSegments(`Ask ${M}Sales Ops and ${M}Sales.`, ["Sales", "Sales Ops"])).toEqual([
      { text: "Ask ", mention: false },
      { text: `${M}Sales Ops`, mention: true },
      { text: " and ", mention: false },
      { text: `${M}Sales`, mention: true },
      { text: ".", mention: false },
    ]);
    expect(mentionSegments("email me @ noon", ["Sales"])).toEqual([{ text: "email me @ noon", mention: false }]);
  });

  test("the sent question keeps the names and drops the marks", () => {
    expect(plainText(`Issues within ${M}Product Building ?`)).toBe("Issues within Product Building ?");
  });

  test("backspace after a token removes it whole", () => {
    const text = `Within ${M}Product Building ?`;
    expect(deleteMentionBefore(text, `Within ${M}Product Building `.length, ["Product Building"])).toEqual({
      text: "Within ?",
      caret: "Within ".length,
    });
    expect(deleteMentionBefore(text, `Within ${M}Product Building`.length, ["Product Building"])).toEqual({
      text: "Within  ?",
      caret: "Within ".length,
    });
    expect(deleteMentionBefore("Within ?", 7, ["Product Building"])).toBeNull();
  });
});

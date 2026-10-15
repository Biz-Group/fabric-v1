import { describe, expect, it } from "vitest";
import { parseInviteEmails } from "./parse-invite-emails";

describe("parseInviteEmails", () => {
  it("reads a single address", () => {
    expect(parseInviteEmails("  ana@example.com ")).toEqual({
      valid: ["ana@example.com"],
      invalid: [],
    });
  });

  it("splits on commas, semicolons, spaces and new lines", () => {
    expect(
      parseInviteEmails("a@x.com, b@x.com;c@x.com\nd@x.com e@x.com").valid,
    ).toEqual(["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"]);
  });

  it("drops names and brackets pasted from a mail client", () => {
    expect(
      parseInviteEmails('"Ana Lee" <ana@x.com>; Bo Chen <bo@x.com>, mailto:cy@x.com')
        .valid,
    ).toEqual(["ana@x.com", "bo@x.com", "cy@x.com"]);
  });

  it("removes duplicates regardless of case", () => {
    expect(parseInviteEmails("Ana@X.com ana@x.com").valid).toEqual([
      "Ana@X.com",
    ]);
  });

  it("reports address-like text that isn't an address", () => {
    expect(parseInviteEmails("ana@x, bo@x.com")).toEqual({
      valid: ["bo@x.com"],
      invalid: ["ana@x"],
    });
  });

  it("ignores a trailing full stop", () => {
    expect(parseInviteEmails("Invite ana@x.com.").valid).toEqual([
      "ana@x.com",
    ]);
  });
});

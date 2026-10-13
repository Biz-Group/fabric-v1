import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { authError, authErrorCode } from "./authErrors";

describe("authErrorCode", () => {
  test("reads the code from error data the Convex client parsed", () => {
    expect(authErrorCode(authError("REMOVED", "Not a member"))).toBe("REMOVED");
  });

  test("reads the code from error data left as a JSON string", () => {
    const error = Object.assign(new Error("x"), {
      data: JSON.stringify({ code: "NOT_MEMBER", message: "x" }),
    });
    expect(authErrorCode(error)).toBe("NOT_MEMBER");
  });

  test.each([
    ["a plain Error", new Error("Not authenticated")],
    ["an unrelated ConvexError", new ConvexError({ code: "DESCRIPTION_BLOCKED" })],
    ["string data that isn't JSON", Object.assign(new Error("x"), { data: "nope" })],
    ["a non-error", "Not authenticated"],
    ["null", null],
  ])("ignores %s", (_label, error) => {
    expect(authErrorCode(error)).toBeNull();
  });
});

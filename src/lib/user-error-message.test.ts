import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import { userErrorMessage } from "./user-error-message";

describe("userErrorMessage", () => {
  it("reads userMessage from ConvexError data", () => {
    const error = new ConvexError({
      code: "AUDIO_UPLOAD_REJECTED",
      userMessage: "Recordings must be 4 hours or shorter.",
    });
    expect(userErrorMessage(error)).toBe(
      "Recordings must be 4 hours or shorter.",
    );
  });

  it("reads message from auth error data", () => {
    const error = new ConvexError({
      code: "INSUFFICIENT_ROLE",
      message: "Insufficient permissions",
    });
    expect(userErrorMessage(error)).toBe("Insufficient permissions");
  });

  it("parses data left as a JSON string", () => {
    const error = { data: JSON.stringify({ userMessage: "Try again later." }) };
    expect(userErrorMessage(error)).toBe("Try again later.");
  });

  it("returns null for plain errors and unusable data", () => {
    expect(userErrorMessage(new Error("Server Error"))).toBeNull();
    expect(userErrorMessage({ data: "not json" })).toBeNull();
    expect(userErrorMessage({ data: { userMessage: "  " } })).toBeNull();
    expect(userErrorMessage(null)).toBeNull();
  });
});

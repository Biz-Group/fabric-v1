import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import { describeError, userErrorMessage } from "./user-error-message";

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

describe("describeError", () => {
  it("prefers the message the function sent", () => {
    const error = new ConvexError({
      code: "LAST_ADMIN",
      userMessage: "You can't demote the last admin.",
    });
    expect(describeError(error, "Failed.")).toBe(
      "You can't demote the last admin.",
    );
  });

  it("strips Convex's request framing in development", () => {
    const error = new Error(
      "[CONVEX M(users:setMembershipRole)] [Request ID: abc] Server Error\n" +
        "Uncaught Error: Membership not found\n    at handler (../convex/users.ts:1:1)",
    );
    expect(describeError(error, "Failed.")).toBe("Membership not found");
  });

  it("falls back when production redacts the message", () => {
    const error = new Error(
      "[CONVEX M(users:setMembershipRole)] [Request ID: abc] Server Error\n  Called by client",
    );
    expect(describeError(error, "Failed to change role.")).toBe(
      "Failed to change role.",
    );
    expect(describeError(undefined, "Failed.")).toBe("Failed.");
  });

  it("keeps client-side messages", () => {
    expect(describeError(new Error("Failed to fetch"), "Failed.")).toBe(
      "Failed to fetch",
    );
  });
});

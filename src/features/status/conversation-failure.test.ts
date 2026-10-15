import { describe, expect, it } from "vitest";
import { conversationFailureReasonValidator } from "../../../convex/lib/conversationFailure";
import {
  conversationFailureMeta,
  describeConversationFailure,
} from "./conversation-failure";

// Read from the validator, so a reason added there fails here until it has
// wording.
const reasons = conversationFailureReasonValidator.members.map(
  (member) => member.value,
);

describe("conversation failure reasons", () => {
  it("gives every stored reason a message and a retry verdict", () => {
    expect(Object.keys(conversationFailureMeta).sort()).toEqual(
      [...reasons].sort(),
    );
    for (const reason of reasons) {
      const meta = describeConversationFailure(reason);
      expect(meta.message.trim()).not.toBe("");
      expect(typeof meta.retryable).toBe("boolean");
    }
  });

  it("only offers a retry where running it again can help", () => {
    expect(describeConversationFailure("transcription").retryable).toBe(true);
    expect(describeConversationFailure("analysis").retryable).toBe(true);
    expect(describeConversationFailure("too_long").retryable).toBe(false);
    expect(describeConversationFailure("audio_missing").retryable).toBe(false);
  });

  it("keeps rows that failed before reasons were stored retryable", () => {
    expect(describeConversationFailure(undefined)).toEqual({
      message: "Processing didn't finish.",
      retryable: true,
    });
  });
});

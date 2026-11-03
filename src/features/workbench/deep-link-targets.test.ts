import { describe, expect, test } from "vitest";
import {
  captureDeepLinkTargets,
  clearFindingTarget,
  linkedTranscriptIndex,
  peekFindingTarget,
  takeTranscriptTarget,
} from "./deep-link-targets";

describe("citation deep-link targets (FR-5.3, FR-5.4)", () => {
  test("captures the targets once and hands each out once", () => {
    captureDeepLinkTargets(new URLSearchParams("proc=p&finding=gap-1&t=125&line=14"));
    expect(peekFindingTarget()).toBe("gap-1");
    expect(peekFindingTarget()).toBe("gap-1");
    clearFindingTarget();
    expect(peekFindingTarget()).toBeNull();
    expect(takeTranscriptTarget()).toEqual({ line: 14, seconds: 125 });
    expect(takeTranscriptTarget()).toEqual({ line: null, seconds: null });
  });

  test("ignores malformed values", () => {
    captureDeepLinkTargets(new URLSearchParams("line=-2&t=soon"));
    expect(takeTranscriptTarget()).toEqual({ line: null, seconds: null });
    captureDeepLinkTargets(new URLSearchParams("t=0"));
    expect(takeTranscriptTarget()).toEqual({ line: null, seconds: 0 });
  });

  test("picks the cited line, falling back to the time when lines have shifted", () => {
    const transcript = [0, 10, 20, 30].map((time_in_call_secs) => ({ time_in_call_secs }));
    expect(linkedTranscriptIndex(transcript, { line: 2, seconds: 25 })).toBe(1);
    expect(linkedTranscriptIndex(transcript, { line: 9, seconds: 25 })).toBe(2);
    expect(linkedTranscriptIndex(transcript, { line: null, seconds: null })).toBeNull();
  });
});

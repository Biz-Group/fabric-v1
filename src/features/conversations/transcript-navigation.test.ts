import { describe, expect, it } from "vitest";
import {
  transcriptKeyTarget,
  transcriptTabStop,
} from "./transcript-navigation";

describe("transcriptKeyTarget", () => {
  it("moves one line with Up and Down", () => {
    expect(transcriptKeyTarget("ArrowDown", 3, 10)).toBe(4);
    expect(transcriptKeyTarget("ArrowUp", 3, 10)).toBe(2);
  });

  it("stops at the ends instead of wrapping", () => {
    expect(transcriptKeyTarget("ArrowDown", 9, 10)).toBe(9);
    expect(transcriptKeyTarget("ArrowUp", 0, 10)).toBe(0);
  });

  it("jumps to the first and last line with Home and End", () => {
    expect(transcriptKeyTarget("Home", 5, 10)).toBe(0);
    expect(transcriptKeyTarget("End", 5, 10)).toBe(9);
  });

  it("leaves Left, Right, Space and Enter to the button and the audio shortcuts", () => {
    for (const key of ["ArrowLeft", "ArrowRight", " ", "Enter", "j"]) {
      expect(transcriptKeyTarget(key, 5, 10)).toBeNull();
    }
  });

  it("does nothing on an empty transcript", () => {
    expect(transcriptKeyTarget("ArrowDown", 0, 0)).toBeNull();
  });
});

describe("transcriptTabStop", () => {
  it("keeps the focused line while focus is inside", () => {
    expect(
      transcriptTabStop({ focused: 2, playing: 7, lastFocused: 2, count: 10 }),
    ).toBe(2);
  });

  it("lands on the playing line when tabbing in", () => {
    expect(
      transcriptTabStop({ focused: null, playing: 7, lastFocused: 2, count: 10 }),
    ).toBe(7);
  });

  it("falls back to the line last used, then the first", () => {
    expect(
      transcriptTabStop({ focused: null, playing: -1, lastFocused: 4, count: 10 }),
    ).toBe(4);
    expect(
      transcriptTabStop({ focused: null, playing: -1, lastFocused: 0, count: 10 }),
    ).toBe(0);
  });

  it("clamps when the transcript got shorter", () => {
    expect(
      transcriptTabStop({ focused: null, playing: -1, lastFocused: 12, count: 10 }),
    ).toBe(9);
  });

  it("has no tab stop on an empty transcript", () => {
    expect(
      transcriptTabStop({ focused: null, playing: -1, lastFocused: 0, count: 0 }),
    ).toBe(-1);
  });
});

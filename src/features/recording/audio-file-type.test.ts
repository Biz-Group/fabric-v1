import { describe, expect, it } from "vitest";
import {
  AUDIO_UPLOAD_ACCEPT,
  resolveUploadMimeType,
} from "./audio-file-type";

describe("resolveUploadMimeType", () => {
  it("keeps a supported declared audio type", () => {
    expect(resolveUploadMimeType({ name: "memo.mp3", type: "audio/mpeg" })).toBe(
      "audio/mpeg",
    );
    expect(
      resolveUploadMimeType({ name: "a.webm", type: "audio/webm;codecs=opus" }),
    ).toBe("audio/webm");
  });

  it("maps meeting video containers to their audio type", () => {
    expect(
      resolveUploadMimeType({ name: "Teams meeting.mp4", type: "video/mp4" }),
    ).toBe("audio/mp4");
    expect(resolveUploadMimeType({ name: "call.webm", type: "video/webm" })).toBe(
      "audio/webm",
    );
  });

  it("falls back to the extension when the type is missing or generic", () => {
    expect(resolveUploadMimeType({ name: "zoom_0.m4a", type: "" })).toBe(
      "audio/mp4",
    );
    expect(
      resolveUploadMimeType({
        name: "RECORDING.WAV",
        type: "application/octet-stream",
      }),
    ).toBe("audio/wav");
  });

  it("refuses files the server would reject", () => {
    expect(
      resolveUploadMimeType({ name: "notes.pdf", type: "application/pdf" }),
    ).toBeNull();
    expect(
      resolveUploadMimeType({ name: "clip.mov", type: "video/quicktime" }),
    ).toBeNull();
    expect(resolveUploadMimeType({ name: "no-extension", type: "" })).toBeNull();
  });

  it("offers video containers and extensions in the picker", () => {
    expect(AUDIO_UPLOAD_ACCEPT).toContain("audio/*");
    expect(AUDIO_UPLOAD_ACCEPT).toContain("video/mp4");
    expect(AUDIO_UPLOAD_ACCEPT).toContain(".m4a");
  });
});

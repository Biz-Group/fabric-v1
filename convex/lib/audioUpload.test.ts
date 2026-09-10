import { describe, expect, test } from "vitest";
import {
  MAX_AUDIO_DURATION_SECONDS,
  MAX_AUDIO_UPLOAD_BYTES,
  audioFileExtension,
  detectAudioContainer,
  fixedWindowStart,
  inspectAudioUpload,
  validateAudioUploadMetadata,
} from "./audioUpload";

function wavHeader(): Uint8Array {
  return new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46, // RIFF
    0x24,
    0x00,
    0x00,
    0x00,
    0x57,
    0x41,
    0x56,
    0x45, // WAVE
  ]);
}

describe("audio upload validation", () => {
  test("accepts an allowed MIME alias only when the bytes match", async () => {
    const result = await inspectAudioUpload(
      new Blob([wavHeader().buffer as ArrayBuffer], { type: "audio/x-wav" }),
      "audio/wav",
      60,
    );

    expect(result).toEqual({
      ok: true,
      mimeType: "audio/wav",
      sizeBytes: 12,
    });
  });

  test("rejects arbitrary bytes carrying an audio label", async () => {
    const result = await inspectAudioUpload(
      new Blob(["not audio"], { type: "audio/mpeg" }),
      "audio/mpeg",
    );

    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });

  test("rejects a declared type that disagrees with storage metadata", () => {
    expect(
      validateAudioUploadMetadata({
        sizeBytes: 1_000,
        storedMimeType: "audio/webm;codecs=opus",
        claimedMimeType: "audio/mpeg",
      }),
    ).toEqual({ ok: false, reason: "type_mismatch" });
  });

  test("rejects oversized files and excessive declared durations", () => {
    expect(
      validateAudioUploadMetadata({
        sizeBytes: MAX_AUDIO_UPLOAD_BYTES + 1,
        storedMimeType: "audio/mpeg",
        claimedMimeType: "audio/mpeg",
      }),
    ).toEqual({ ok: false, reason: "too_large" });
    expect(
      validateAudioUploadMetadata({
        sizeBytes: 1_000,
        storedMimeType: "audio/mpeg",
        claimedMimeType: "audio/mpeg",
        durationSeconds: MAX_AUDIO_DURATION_SECONDS + 1,
      }),
    ).toEqual({ ok: false, reason: "invalid_duration" });
  });

  test("recognizes the browser recording containers", () => {
    expect(detectAudioContainer(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBe(
      "webm",
    );
    expect(
      detectAudioContainer(
        new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]),
      ),
    ).toBe("mp4");
    expect(detectAudioContainer(new Uint8Array([0x49, 0x44, 0x33]))).toBe(
      "mp3",
    );
  });

  test("uses stable fixed-window boundaries", () => {
    expect(fixedWindowStart(3_799_999, 3_600_000)).toBe(3_600_000);
    expect(fixedWindowStart(3_600_000, 3_600_000)).toBe(3_600_000);
  });

  test("uses an extension matching each canonical upload type", () => {
    expect(audioFileExtension("audio/mpeg")).toBe("mp3");
    expect(audioFileExtension("audio/mp4")).toBe("m4a");
    expect(audioFileExtension("audio/webm")).toBe("webm");
  });
});

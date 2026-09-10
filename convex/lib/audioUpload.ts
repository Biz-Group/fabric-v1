export const MAX_AUDIO_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_AUDIO_DURATION_SECONDS = 4 * 60 * 60;

export const VOICE_UPLOAD_GRANT_TTL_MS = 60 * 60 * 1000;
export const USER_UPLOAD_WINDOW_MS = 60 * 60 * 1000;
export const ORG_UPLOAD_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_USER_UPLOADS_PER_WINDOW = 10;
export const MAX_USER_UPLOAD_BYTES_PER_WINDOW = 500 * 1024 * 1024;
export const MAX_ORG_UPLOADS_PER_WINDOW = 100;
export const MAX_ORG_UPLOAD_BYTES_PER_WINDOW = 5 * 1024 * 1024 * 1024;

type AudioContainer =
  | "aac"
  | "aiff"
  | "amr"
  | "flac"
  | "mp3"
  | "mp4"
  | "ogg"
  | "wav"
  | "webm";

export type AudioUploadRejection =
  | "empty"
  | "too_large"
  | "invalid_duration"
  | "unsupported_type"
  | "type_mismatch"
  | "invalid_signature";

export type AudioUploadInspection =
  | {
      ok: true;
      mimeType: string;
      sizeBytes: number;
    }
  | {
      ok: false;
      reason: AudioUploadRejection;
    };

const MIME_CONTAINERS: Readonly<Record<string, AudioContainer>> = {
  "audio/aac": "aac",
  "audio/aiff": "aiff",
  "audio/amr": "amr",
  "audio/amr-wb": "amr",
  "audio/flac": "flac",
  "audio/m4a": "mp4",
  "audio/matroska": "webm",
  "audio/mp3": "mp3",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/vnd.wave": "wav",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/webm": "webm",
  "audio/x-aiff": "aiff",
  "audio/x-flac": "flac",
  "audio/x-m4a": "mp4",
  "audio/x-matroska": "webm",
  "audio/x-wav": "wav",
};

const CANONICAL_MIME: Readonly<Record<AudioContainer, string>> = {
  aac: "audio/aac",
  aiff: "audio/aiff",
  amr: "audio/amr",
  flac: "audio/flac",
  mp3: "audio/mpeg",
  mp4: "audio/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm",
};

export function normalizeAudioMimeType(value: string): string {
  return value.split(";", 1)[0]!.trim().toLowerCase();
}

export function audioFileExtension(mimeType: string): string {
  switch (normalizeAudioMimeType(mimeType)) {
    case "audio/aac":
      return "aac";
    case "audio/aiff":
      return "aiff";
    case "audio/amr":
      return "amr";
    case "audio/flac":
      return "flac";
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
      return "m4a";
    case "audio/ogg":
      return "ogg";
    case "audio/wav":
      return "wav";
    case "audio/webm":
      return "webm";
    default:
      return "audio";
  }
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  if (offset + value.length > bytes.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

/**
 * Identifies the outer audio container from its magic bytes. This is not a
 * codec decoder; it is a cheap admission check that prevents an arbitrary
 * binary object from becoming paid transcription input merely because the
 * caller labelled it `audio/*`.
 */
export function detectAudioContainer(bytes: Uint8Array): AudioContainer | null {
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "webm";
  if (asciiAt(bytes, 0, "OggS")) return "ogg";
  if (asciiAt(bytes, 0, "fLaC")) return "flac";
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WAVE")) return "wav";
  if (
    asciiAt(bytes, 0, "FORM") &&
    (asciiAt(bytes, 8, "AIFF") || asciiAt(bytes, 8, "AIFC"))
  ) {
    return "aiff";
  }
  if (asciiAt(bytes, 0, "#!AMR\n") || asciiAt(bytes, 0, "#!AMR-WB\n")) {
    return "amr";
  }
  if (asciiAt(bytes, 4, "ftyp")) return "mp4";
  if (asciiAt(bytes, 0, "ID3")) return "mp3";

  if (bytes.length >= 2 && bytes[0] === 0xff) {
    const second = bytes[1]!;
    const mpegVersion = (second >> 3) & 0x03;
    const mpegLayer = (second >> 1) & 0x03;
    if ((second & 0xe0) === 0xe0 && mpegVersion !== 1 && mpegLayer !== 0) {
      return "mp3";
    }
    if ((second & 0xf6) === 0xf0) return "aac";
  }

  return null;
}

export function validateAudioUploadMetadata(args: {
  sizeBytes: number;
  storedMimeType: string;
  claimedMimeType: string;
  durationSeconds?: number;
}): AudioUploadInspection {
  if (!Number.isSafeInteger(args.sizeBytes) || args.sizeBytes <= 0) {
    return { ok: false, reason: "empty" };
  }
  if (args.sizeBytes > MAX_AUDIO_UPLOAD_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  if (
    args.durationSeconds !== undefined &&
    (!Number.isFinite(args.durationSeconds) ||
      args.durationSeconds <= 0 ||
      args.durationSeconds > MAX_AUDIO_DURATION_SECONDS)
  ) {
    return { ok: false, reason: "invalid_duration" };
  }

  const storedMimeType = normalizeAudioMimeType(args.storedMimeType);
  const claimedMimeType = normalizeAudioMimeType(args.claimedMimeType);
  const storedContainer = MIME_CONTAINERS[storedMimeType];
  const claimedContainer = MIME_CONTAINERS[claimedMimeType];
  if (!storedContainer || !claimedContainer) {
    return { ok: false, reason: "unsupported_type" };
  }
  if (storedContainer !== claimedContainer) {
    return { ok: false, reason: "type_mismatch" };
  }

  return {
    ok: true,
    mimeType: CANONICAL_MIME[storedContainer],
    sizeBytes: args.sizeBytes,
  };
}

export async function inspectAudioUpload(
  blob: Blob,
  claimedMimeType: string,
  durationSeconds?: number,
): Promise<AudioUploadInspection> {
  const metadata = validateAudioUploadMetadata({
    sizeBytes: blob.size,
    storedMimeType: blob.type,
    claimedMimeType,
    durationSeconds,
  });
  if (!metadata.ok) return metadata;

  const header = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
  const detectedContainer = detectAudioContainer(header);
  const expectedContainer = MIME_CONTAINERS[metadata.mimeType];
  if (!detectedContainer || detectedContainer !== expectedContainer) {
    return { ok: false, reason: "invalid_signature" };
  }

  return metadata;
}

export function audioUploadRejectionMessage(
  reason: AudioUploadRejection,
): string {
  switch (reason) {
    case "empty":
      return "The uploaded audio file is empty.";
    case "too_large":
      return "Audio files must be 100 MB or smaller.";
    case "invalid_duration":
      return "Recordings must be 4 hours or shorter.";
    case "unsupported_type":
      return "This audio file type is not supported.";
    case "type_mismatch":
      return "The uploaded file type does not match its declared audio type.";
    case "invalid_signature":
      return "The uploaded file does not contain a supported audio format.";
  }
}

export function fixedWindowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

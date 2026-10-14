import {
  isSupportedAudioMimeType,
  normalizeAudioMimeType,
} from "../../../convex/lib/audioUpload";

// Meeting tools export video containers (Teams and Zoom save .mp4), and some
// browsers report no MIME type at all. The server checks the container's
// magic bytes, not the codec, so an .mp4 meeting recording passes as
// audio/mp4. Declaring it that way is what lets it through.

const VIDEO_CONTAINER_AUDIO_TYPES: Readonly<Record<string, string>> = {
  "video/mp4": "audio/mp4",
  "video/webm": "audio/webm",
};

const EXTENSION_AUDIO_TYPES: Readonly<Record<string, string>> = {
  aac: "audio/aac",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  amr: "audio/amr",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  mp4: "audio/mp4",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm",
};

/** For the file input's `accept`, so the picker offers meeting videos too. */
export const AUDIO_UPLOAD_ACCEPT = [
  "audio/*",
  ...Object.keys(VIDEO_CONTAINER_AUDIO_TYPES),
  ...Object.keys(EXTENSION_AUDIO_TYPES).map((extension) => `.${extension}`),
].join(",");

export const AUDIO_UPLOAD_FORMATS_LABEL =
  "MP3, M4A, MP4, WAV, WebM, OGG, FLAC, AAC, AIFF or AMR";

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * The audio MIME type to upload a chosen file as, or null when the server
 * would refuse it. Trusts a supported declared type first, then maps video
 * containers, then falls back to the extension.
 */
export function resolveUploadMimeType(file: {
  name: string;
  type: string;
}): string | null {
  const declared = normalizeAudioMimeType(file.type);
  if (declared && isSupportedAudioMimeType(declared)) return declared;
  const fromVideo = VIDEO_CONTAINER_AUDIO_TYPES[declared];
  if (fromVideo) return fromVideo;
  return EXTENSION_AUDIO_TYPES[fileExtension(file.name)] ?? null;
}

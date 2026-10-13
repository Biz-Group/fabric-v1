/**
 * Byte-range helpers for the `/audio/` HTTP route.
 *
 * The route must never hold a whole recording in memory: Convex HTTP actions
 * get 64 MiB of RAM, and a 30-minute ElevenLabs interview is ~30 MB of MP3 —
 * buffered once and then copied for the range, longer interviews ran out of
 * memory. These helpers let the route stream instead.
 */

export type ByteRange = { start: number; end: number };

/**
 * Parses a single `Range: bytes=…` header against a known total size.
 * Returns `null` when there's no usable range (serve the whole file),
 * `"unsatisfiable"` when the range lies outside the file (answer 416), or the
 * inclusive byte range to serve. Multi-range requests are served whole, which
 * HTTP allows.
 */
export function parseByteRange(
  header: string | null,
  totalSize: number,
): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startText, endText] = match;
  if (startText === "" && endText === "") return null;
  if (totalSize <= 0) return "unsatisfiable";

  if (startText === "") {
    // Suffix range: the last N bytes.
    const suffixLength = Number(endText);
    if (suffixLength === 0) return "unsatisfiable";
    return { start: Math.max(0, totalSize - suffixLength), end: totalSize - 1 };
  }

  const start = Number(startText);
  if (start >= totalSize) return "unsatisfiable";
  const requestedEnd = endText === "" ? totalSize - 1 : Number(endText);
  if (requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, totalSize - 1) };
}

/**
 * Streams only bytes `start..end` (inclusive) of `body`, discarding what comes
 * before and cancelling the source once the range is complete. Memory use is
 * one upstream chunk, regardless of the file's size.
 */
export function sliceByteStream(
  body: ReadableStream<Uint8Array>,
  { start, end }: ByteRange,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        const chunkStart = offset;
        offset += value.byteLength;
        if (offset <= start) continue;

        const from = Math.max(0, start - chunkStart);
        const to = Math.min(value.byteLength, end + 1 - chunkStart);
        if (to > from) controller.enqueue(value.subarray(from, to));
        if (offset > end) {
          await reader.cancel();
          controller.close();
        }
        return;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

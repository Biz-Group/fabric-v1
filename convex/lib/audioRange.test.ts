import { describe, expect, test } from "vitest";
import { parseByteRange, sliceByteStream } from "./audioRange";

describe("parseByteRange", () => {
  test.each([
    [null, null],
    ["bytes=0-", { start: 0, end: 99 }],
    ["bytes=10-19", { start: 10, end: 19 }],
    ["bytes=90-500", { start: 90, end: 99 }],
    ["bytes=-10", { start: 90, end: 99 }],
    ["bytes=-500", { start: 0, end: 99 }],
    ["bytes=100-", "unsatisfiable"],
    ["bytes=-0", "unsatisfiable"],
    ["bytes=20-10", null],
    ["bytes=0-1,5-6", null],
    ["items=0-1", null],
  ])("%j against 100 bytes → %j", (header, expected) => {
    expect(parseByteRange(header, 100)).toEqual(expected);
  });
});

function streamOf(chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  const bytes: number[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return bytes;
    bytes.push(...value);
  }
}

describe("sliceByteStream", () => {
  const chunks = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [8, 9],
  ];

  test.each([
    [{ start: 0, end: 9 }, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]],
    [{ start: 2, end: 5 }, [2, 3, 4, 5]],
    [{ start: 4, end: 7 }, [4, 5, 6, 7]],
    [{ start: 9, end: 9 }, [9]],
    [{ start: 3, end: 8 }, [3, 4, 5, 6, 7, 8]],
  ])("range %j spans chunk boundaries correctly", async (range, expected) => {
    expect(await collect(sliceByteStream(streamOf(chunks), range))).toEqual(
      expected,
    );
  });

  test("stops reading the source once the range is complete", async () => {
    let pulls = 0;
    let cancelled = false;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1024));
      },
      cancel() {
        cancelled = true;
      },
    });

    const bytes = await collect(sliceByteStream(source, { start: 0, end: 2047 }));

    expect(bytes).toHaveLength(2048);
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(5);
  });
});

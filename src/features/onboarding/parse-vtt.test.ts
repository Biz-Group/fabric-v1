import { describe, expect, it } from "vitest";
import { parseVtt } from "./parse-vtt";

describe("parseVtt", () => {
  it("reads cues with timings and text", () => {
    const cues = parseVtt(
      [
        "WEBVTT",
        "",
        "1",
        "00:00:01.280 --> 00:00:03.749",
        "Hi, and welcome to Fabric!",
        "",
        "2",
        "00:01:03.749 --> 00:01:04.960 align:start",
        "In the next",
        "two minutes,",
        "",
      ].join("\n"),
    );
    expect(cues).toEqual([
      { start: 1.28, end: 3.749, text: "Hi, and welcome to Fabric!" },
      { start: 63.749, end: 64.96, text: "In the next two minutes," },
    ]);
  });

  it("accepts short timestamps, CRLF line endings and no identifiers", () => {
    expect(parseVtt("WEBVTT\r\n\r\n00:05.000 --> 00:07.500\r\nShort form\r\n")).toEqual([
      { start: 5, end: 7.5, text: "Short form" },
    ]);
  });

  it("strips tags and entities, and skips notes and empty cues", () => {
    const cues = parseVtt(
      [
        "WEBVTT",
        "",
        "NOTE written by hand",
        "",
        "00:00:00.000 --> 00:00:01.000",
        "<v Narrator>Maps &amp; <i>insights</i></v>",
        "",
        "00:00:01.000 --> 00:00:02.000",
        "",
      ].join("\n"),
    );
    expect(cues).toEqual([{ start: 0, end: 1, text: "Maps & insights" }]);
  });

  it("returns nothing for a file without cues", () => {
    expect(parseVtt("")).toEqual([]);
    expect(parseVtt("not a caption file")).toEqual([]);
  });
});

import { describe, expect, test } from "vitest";
import { DEFAULT_DAILY_USER_LIMIT, gulfDayStart, parseDailyLimit } from "./askLimits";

describe("gulfDayStart (D51)", () => {
  test("days turn over at midnight Gulf time, 20:00 UTC", () => {
    const start = Date.parse("2026-11-02T20:00:00Z");
    expect(gulfDayStart(Date.parse("2026-11-03T19:59:59Z"))).toBe(start);
    expect(gulfDayStart(start)).toBe(start);
    expect(gulfDayStart(Date.parse("2026-11-03T20:00:00Z"))).toBe(Date.parse("2026-11-03T20:00:00Z"));
  });
});

describe("parseDailyLimit (D51)", () => {
  test("unset or invalid means the default; off means no limit", () => {
    expect(parseDailyLimit(undefined, DEFAULT_DAILY_USER_LIMIT)).toBe(10);
    expect(parseDailyLimit(" 25 ", 10)).toBe(25);
    expect(parseDailyLimit("OFF", 10)).toBeNull();
    for (const bad of ["", "0", "-3", "2.5", "ten"]) expect(parseDailyLimit(bad, 10)).toBe(10);
  });
});

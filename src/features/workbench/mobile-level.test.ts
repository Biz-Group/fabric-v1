import { describe, expect, it } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { clampMobileLevel, deepestMobileLevel } from "./mobile-level";

const fn = "fn1" as Id<"functions">;
const dept = "dept1" as Id<"departments">;
const proc = "proc1" as Id<"processes">;

describe("deepestMobileLevel", () => {
  it("follows the deepest selected id", () => {
    expect(deepestMobileLevel({ fn: null, dept: null, proc: null })).toBe(1);
    expect(deepestMobileLevel({ fn, dept: null, proc: null })).toBe(2);
    expect(deepestMobileLevel({ fn, dept, proc: null })).toBe(3);
    expect(deepestMobileLevel({ fn, dept, proc })).toBe(4);
  });

  it("treats a shared process link without ancestors as the detail screen", () => {
    expect(deepestMobileLevel({ fn: null, dept: null, proc })).toBe(4);
  });
});

describe("clampMobileLevel", () => {
  it("steps up when the open process is deleted", () => {
    expect(clampMobileLevel(4, { fn, dept, proc: null })).toBe(3);
  });

  it("steps up past every cleared level", () => {
    expect(clampMobileLevel(4, { fn, dept: null, proc: null })).toBe(2);
    expect(clampMobileLevel(4, { fn: null, dept: null, proc: null })).toBe(1);
    expect(clampMobileLevel(3, { fn: null, dept: null, proc: null })).toBe(1);
  });

  it("keeps a shallower level while a row is only previewed", () => {
    expect(clampMobileLevel(3, { fn, dept, proc })).toBe(3);
    expect(clampMobileLevel(1, { fn, dept: null, proc: null })).toBe(1);
  });
});

import { describe, expect, test } from "vitest";
import { isOrgInRollout, parseOrgRollout } from "./orgRollout";

describe("rollout switch parsing", () => {
  test("unset, empty, and false all mean off", () => {
    for (const raw of [undefined, "", "   ", "false", "FALSE"]) {
      expect(parseOrgRollout(raw)).toEqual({ mode: "off" });
    }
  });

  test("true means every tenant on the deployment", () => {
    expect(parseOrgRollout("true")).toEqual({ mode: "all" });
    expect(parseOrgRollout("  TRUE  ")).toEqual({ mode: "all" });
  });

  test("a comma-separated list is an organisation allowlist", () => {
    const rollout = parseOrgRollout(" org_a , org_b ,, org_c ");
    expect(rollout.mode).toBe("allowlist");
    if (rollout.mode !== "allowlist") throw new Error("unreachable");
    expect([...rollout.orgIds].sort()).toEqual(["org_a", "org_b", "org_c"]);
  });

  test("a list that parses to nothing fails closed", () => {
    expect(parseOrgRollout(" , , ")).toEqual({ mode: "off" });
  });
});

describe("per-organisation rollout", () => {
  test("only allowlisted organisations are enabled", () => {
    const rollout = parseOrgRollout("org_internal_pilot,org_second_pilot");
    expect(isOrgInRollout(rollout, "org_internal_pilot")).toBe(true);
    expect(isOrgInRollout(rollout, "org_second_pilot")).toBe(true);
    expect(isOrgInRollout(rollout, "org_external_not_yet")).toBe(false);
  });

  test("a typo in the allowlist enables nobody by accident", () => {
    const rollout = parseOrgRollout("org_internl_pilot");
    expect(isOrgInRollout(rollout, "org_internal_pilot")).toBe(false);
  });

  test("off and all apply to every organisation", () => {
    expect(isOrgInRollout(parseOrgRollout("false"), "org_any")).toBe(false);
    expect(isOrgInRollout(parseOrgRollout("true"), "org_any")).toBe(true);
  });
});

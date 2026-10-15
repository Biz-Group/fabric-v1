import { describe, expect, it } from "vitest";
import { livePlacementGate, resolvePlacementGate } from "./placement-gate";

type Placement = NonNullable<Parameters<typeof livePlacementGate>[0]>;

function placementOf(overrides: Partial<Placement> = {}): Placement {
  return {
    placement: null,
    orgHasDepartments: true,
    placementSkipped: false,
    ...overrides,
  };
}

describe("livePlacementGate", () => {
  it("is unknown until the placement query has an answer", () => {
    expect(livePlacementGate(undefined)).toBeNull();
    expect(livePlacementGate(null)).toBeNull();
  });

  it("asks an unplaced member once the org has departments", () => {
    expect(livePlacementGate(placementOf())).toBe(true);
  });

  it("doesn't ask without departments, once placed, or after a skip", () => {
    expect(livePlacementGate(placementOf({ orgHasDepartments: false }))).toBe(
      false,
    );
    expect(
      livePlacementGate(
        placementOf({
          placement: {
            departmentId: "d1",
            departmentName: "Payroll",
            functionId: "f1",
            functionName: "Finance",
          } as Placement["placement"],
        }),
      ),
    ).toBe(false);
    expect(livePlacementGate(placementOf({ placementSkipped: true }))).toBe(
      false,
    );
  });
});

describe("resolvePlacementGate", () => {
  it("takes the first known value", () => {
    expect(resolvePlacementGate(null, true)).toBe(true);
    expect(resolvePlacementGate(null, false)).toBe(false);
    expect(resolvePlacementGate(null, null)).toBeNull();
  });

  it("never re-opens within a session", () => {
    // The first department appears while the member is in the workbench.
    expect(resolvePlacementGate(false, true)).toBe(false);
  });

  it("closes when the member is placed or skips", () => {
    expect(resolvePlacementGate(true, false)).toBe(false);
  });

  it("stays put while the answer is unknown", () => {
    expect(resolvePlacementGate(true, null)).toBe(true);
    expect(resolvePlacementGate(false, null)).toBe(false);
  });

  it("stays open while the member still owes a department", () => {
    expect(resolvePlacementGate(true, true)).toBe(true);
  });
});

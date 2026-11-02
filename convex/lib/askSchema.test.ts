import type { GenericValidator } from "convex/values";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import {
  askToolTelemetryValidator,
  askTurnQualityValidator,
  askTurnUsageValidator,
} from "./askSchema";

/** Paths of every field a validator lets hold arbitrary text. */
function freeTextPaths(validator: GenericValidator, path = "$"): string[] {
  switch (validator.kind) {
    case "string":
    case "any":
    case "bytes":
      return [path];
    case "object":
      return Object.entries(validator.fields).flatMap(([key, field]) =>
        freeTextPaths(field, `${path}.${key}`),
      );
    case "array":
      return freeTextPaths(validator.element, `${path}[]`);
    case "record":
      return [`${path}{}`];
    case "union":
      return validator.members.flatMap((member, index) =>
        freeTextPaths(member, `${path}|${index}`),
      );
    default:
      return [];
  }
}

describe("AskFabric telemetry is content-free (FR-8.2, FR-8.5)", () => {
  test.each([
    ["tool telemetry", askToolTelemetryValidator],
    ["turn quality", askTurnQualityValidator],
    ["turn usage", askTurnUsageValidator],
  ] as const)("%s has no free-text field", (_label, validator) => {
    expect(freeTextPaths(validator)).toEqual([]);
  });

  test("the stored message fields use those validators", () => {
    const fields = schema.tables.askMessages.validator.fields;
    expect(fields.toolTelemetry.kind).toBe("array");
    expect(freeTextPaths(fields.toolTelemetry)).toEqual([]);
    expect(freeTextPaths(fields.quality)).toEqual([]);
    expect(freeTextPaths(fields.usage)).toEqual([]);
  });
});

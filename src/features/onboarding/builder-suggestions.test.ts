import { describe, expect, it } from "vitest";
import {
  FUNCTION_SUGGESTIONS,
  normalizeName,
  suggestDepartments,
  suggestFunctions,
  suggestProcesses,
} from "./builder-suggestions";

describe("builder suggestions", () => {
  it("normalises names for lookup", () => {
    expect(normalizeName("Legal & Compliance")).toBe("legal compliance");
    expect(normalizeName("legal and compliance")).toBe("legal compliance");
    expect(normalizeName("  Legal/Compliance ")).toBe("legal compliance");
  });

  it("hides functions that already exist, ignoring case", () => {
    const suggestions = suggestFunctions(["finance", "HUMAN RESOURCES"]);
    expect(suggestions).not.toContain("Finance");
    expect(suggestions).not.toContain("Human Resources");
    expect(suggestions).toHaveLength(FUNCTION_SUGGESTIONS.length - 2);
  });

  it("suggests departments for a known function, minus siblings", () => {
    expect(suggestDepartments("Finance", ["payroll"])).toEqual([
      "Accounts Payable",
      "Accounts Receivable",
      "Financial Planning",
      "Treasury",
    ]);
    expect(suggestDepartments("Legal and Compliance", [])).toContain("Contracts");
  });

  it("suggests processes for a known department", () => {
    expect(suggestProcesses("Accounts Payable", ["Expense Claims"])).toEqual([
      "Invoice approval",
      "Vendor payments",
    ]);
  });

  it("offers nothing for a parent it doesn't recognise", () => {
    expect(suggestDepartments("Space Exploration", [])).toEqual([]);
    expect(suggestProcesses("Rocket Fuelling", [])).toEqual([]);
  });
});

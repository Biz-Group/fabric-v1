import { describe, expect, it } from "vitest";
import { searchCandidates, truncationMessage } from "./command-palette-search";

type Proc = { id: string; name: string; fn: string; dept: string };

const toCandidate = (p: Proc) => ({ name: p.name, path: [p.fn, p.dept] });

const processes: Proc[] = [
  { id: "p1", name: "Invoice approvals", fn: "Finance", dept: "Payables" },
  { id: "p2", name: "Invoice approvals", fn: "Operations", dept: "Procurement" },
  { id: "p3", name: "Month-end close", fn: "Finance", dept: "Accounting" },
  { id: "p4", name: "Finance onboarding", fn: "People", dept: "HR" },
  { id: "p5", name: "Vendor invoice intake", fn: "Finance", dept: "Payables" },
];

const ids = (r: { matches: Proc[] }) => r.matches.map((p) => p.id);

describe("searchCandidates", () => {
  it("matches tokens across the name and the ancestor path", () => {
    const result = searchCandidates(processes, "finance invoice", toCandidate, 8);
    expect(ids(result)).toEqual(["p1", "p5"]);
  });

  it("ranks direct name matches above path-only matches", () => {
    const result = searchCandidates(processes, "finance", toCandidate, 8);
    // p4's name starts with the query; the others only match via the path.
    expect(ids(result)[0]).toBe("p4");
    expect(ids(result)).toEqual(["p4", "p1", "p3", "p5"]);
  });

  it("keeps identically named items in a stable path order", () => {
    const result = searchCandidates(processes, "invoice approvals", toCandidate, 8);
    expect(ids(result)).toEqual(["p1", "p2"]);
  });

  it("is case- and whitespace-insensitive", () => {
    const result = searchCandidates(processes, "  MONTH-END   ", toCandidate, 8);
    expect(ids(result)).toEqual(["p3"]);
  });

  it("caps the matches but reports the full total", () => {
    const result = searchCandidates(processes, "finance", toCandidate, 2);
    expect(result.matches).toHaveLength(2);
    expect(result.total).toBe(4);
  });

  it("returns everything, uncapped, for an empty query", () => {
    const result = searchCandidates(processes, " ", toCandidate, 2);
    expect(result.matches).toHaveLength(5);
    expect(result.total).toBe(5);
  });
});

describe("truncationMessage", () => {
  it("is null when nothing was cut", () => {
    expect(truncationMessage(3, 3)).toBeNull();
  });

  it("names the shown and total counts when capped", () => {
    expect(truncationMessage(8, 12)).toBe(
      "Showing 8 of 12 — refine your search",
    );
  });
});

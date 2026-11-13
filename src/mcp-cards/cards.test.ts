// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * The MCP Apps cards view (Phase 5) renders each show tool's result from the
 * host's postMessage, treating contributor text as text. The bundle's
 * freshness is checked in bundle.test.ts (esbuild needs the node environment).
 */

describe("cards view", () => {
  const sent: Array<{ method?: string; id?: number }> = [];

  beforeAll(async () => {
    document.body.innerHTML = '<div id="root"></div>';
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    // In jsdom the view is its own parent: record what it sends instead of looping.
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      sent.push(message as { method?: string; id?: number });
    });
    await import("./app");
  });
  afterAll(() => vi.unstubAllGlobals());

  function deliver(structuredContent: unknown) {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [], structuredContent } },
      }),
    );
  }
  const root = () => document.getElementById("root") as HTMLElement;

  test("starts the MCP Apps handshake", () => {
    expect(sent[0]).toMatchObject({ method: "ui/initialize", id: 1 });
  });

  test("renders entity cards, with contributor text as text", () => {
    deliver({
      kind: "cards",
      cards: [
        {
          kind: "process",
          name: '<img src=x onerror="alert(1)">Invoice approval',
          trail: ["Finance", "Payables"],
          headline: "Approvals wait on the CFO.",
          overviewState: "current",
          contributions: 4,
          departments: null,
          processes: null,
          href: "https://acme.bizfabric.ai/acme?fn=f&dept=d&proc=p",
        },
      ],
    });
    expect(root().querySelector("img")).toBeNull();
    expect(root().textContent).toContain('<img src=x onerror="alert(1)">Invoice approval');
    expect(root().textContent).toContain("Finance › Payables");
    expect(root().textContent).toContain("4 contributions · Overview current");
    expect(root().querySelector("a")?.getAttribute("href")).toBe("https://acme.bizfabric.ai/acme?fn=f&dept=d&proc=p");
  });

  test("renders a flow step with its neighbours", () => {
    deliver({
      kind: "flow",
      processName: "Invoice approval",
      step: { id: "n2", label: "CFO approves", category: "decision", href: null },
      before: [{ id: "n1", label: "Clerk keys invoice", category: "action", edgeLabel: null, href: null }],
      after: [],
      moreBefore: 0,
      moreAfter: 2,
      stale: true,
    });
    expect(root().textContent).toContain("CFO approves");
    expect(root().textContent).toContain("Clerk keys invoice");
    expect(root().textContent).toContain("+2 more");
    expect(root().textContent).toContain("out of date");
    expect(root().querySelector(".step-current.step-decision")).not.toBeNull();
  });

  test("renders a stacked bar chart and refuses non-http links", () => {
    deliver({
      kind: "chart",
      title: "Signals by process",
      type: "bar",
      scopeName: "The organization",
      series: [
        { key: "friction", label: "Friction" },
        { key: "bottleneck", label: "Bottleneck" },
      ],
      rows: [
        { label: "Invoice approval", values: [3, 1], href: "javascript:alert(1)" },
        { label: "Onboarding", values: [1, 0], href: "https://acme.bizfabric.ai/acme" },
      ],
      more: 0,
    });
    expect(root().querySelectorAll(".bar-row")).toHaveLength(2);
    expect(root().querySelectorAll(".legend-item")).toHaveLength(2);
    expect(root().querySelectorAll("a")).toHaveLength(1);
    expect(root().querySelector("a")?.getAttribute("href")).toBe("https://acme.bizfabric.ai/acme");
  });

  test("shows nothing for an unknown payload", () => {
    deliver({ kind: "something-else" });
    expect(root().textContent).toContain("Nothing to show.");
  });
});

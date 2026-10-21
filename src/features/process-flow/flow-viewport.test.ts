import { describe, expect, it } from "vitest";
import {
  resolveEntryViewportTransform,
  resolveFlowEntryNodeId,
  resolveResizeReframe,
} from "./flow-viewport";

describe("process-flow initial viewport", () => {
  it("places a horizontal entry card in the centre-left reading position", () => {
    const transform = resolveEntryViewportTransform({
      node: {
        position: { x: 1000, y: 600 },
        width: 280,
        height: 120,
      },
      viewport: { width: 1600, height: 800 },
      direction: "horizontal",
    });

    expect(transform.zoom).toBe(0.92);
    expect(1000 * transform.zoom + transform.x).toBeCloseTo(223.2);
    expect(600 * transform.zoom + transform.y).toBeCloseTo(344.8);
  });

  it("uses a top-centre origin for vertical and narrow flows", () => {
    const vertical = resolveEntryViewportTransform({
      node: { position: { x: 400, y: 500 }, width: 280, height: 120 },
      viewport: { width: 1200, height: 800 },
      direction: "vertical",
      zoom: 1,
    });
    const narrow = resolveEntryViewportTransform({
      node: { position: { x: 400, y: 500 }, width: 280, height: 120 },
      viewport: { width: 500, height: 700 },
      direction: "horizontal",
      zoom: 1,
    });

    expect(540 + vertical.x).toBe(600);
    expect(560 + vertical.y).toBe(160);
    expect(540 + narrow.x).toBe(250);
    expect(560 + narrow.y).toBe(350);
  });

  it("prefers the explicit start node", () => {
    const nodes = [
      { id: "orphan", type: "action" },
      { id: "begin", type: "start" },
      { id: "work", type: "action" },
    ];
    const edges = [{ source: "begin", target: "work" }];

    expect(resolveFlowEntryNodeId(nodes, edges)).toBe("begin");
  });

  it("falls back to a node with no incoming edge", () => {
    const nodes = [{ id: "intake" }, { id: "review" }, { id: "finish" }];
    const edges = [
      { source: "intake", target: "review" },
      { source: "review", target: "finish" },
    ];

    expect(resolveFlowEntryNodeId(nodes, edges)).toBe("intake");
  });
});

describe("process-flow resize reframing", () => {
  const entry = { mode: "entry" as const, width: 1000, height: 600 };
  const fitAll = {
    mode: "fit" as const,
    width: 1000,
    height: 600,
    padding: 0.16,
    maxZoom: 1,
  };

  it("leaves the view alone once the person has taken over", () => {
    expect(resolveResizeReframe(null, { width: 400, height: 600 })).toBeNull();
  });

  it("ignores small or empty size changes", () => {
    expect(resolveResizeReframe(entry, { width: 960, height: 600 })).toBeNull();
    expect(resolveResizeReframe(entry, { width: 1000, height: 640 })).toBeNull();
    expect(resolveResizeReframe(entry, { width: 0, height: 0 })).toBeNull();
  });

  it("uses the larger of 48px and 10% as the threshold", () => {
    const small = { mode: "entry" as const, width: 300, height: 300 };
    expect(resolveResizeReframe(small, { width: 340, height: 300 })).toBeNull();
    expect(resolveResizeReframe(small, { width: 348, height: 300 })).toEqual({
      mode: "entry",
      width: 348,
      height: 300,
    });
    expect(resolveResizeReframe(entry, { width: 1099, height: 600 })).toBeNull();
    expect(resolveResizeReframe(entry, { width: 1100, height: 600 })).not.toBeNull();
  });

  it("repeats the same kind of frame at the new size", () => {
    expect(resolveResizeReframe(entry, { width: 1400, height: 600 })).toEqual({
      mode: "entry",
      width: 1400,
      height: 600,
    });
    expect(
      resolveResizeReframe(
        { ...fitAll, nodeIds: ["a", "b"] },
        { width: 1000, height: 400 },
      ),
    ).toEqual({ ...fitAll, nodeIds: ["a", "b"], height: 400 });
  });
});

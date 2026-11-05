import { describe, expect, test } from "vitest";
import { authError } from "../lib/authErrors";
import { ASK_TOOLS } from "../askTools/catalog";
import { RESULT_DETAILS_SOURCE, searchResult, sources, type AskToolResult } from "../askTools/results";
import type { AskMessagePart } from "../lib/askSchema";
import {
  ANSWER_STILL_DUE,
  MAX_DISPLAYS,
  MAX_MODEL_CALLS,
  QUESTION_STILL_DUE,
  TOOLS_OFF_MARGIN_MS,
  TURN_DEADLINE_MS,
  runTurnLoop,
  withCacheBreakpoints,
  type TurnDeps,
} from "./loop";
import { createScriptedAskClient, type ScriptedStep } from "./modelClient";

const SYSTEM = [{ type: "text" as const, text: "system" }];
const QUESTION = [{ role: "user", content: [{ type: "text", text: "context" }, { type: "text", text: "What slows us down?" }] }];

const coverageCall = (id = "toolu_1") => ({
  type: "tool_use",
  id,
  name: "getCoverage",
  input: { kind: "org", id: "" },
});

const FOUND: AskToolResult = {
  found: true,
  content: [searchResult(RESULT_DETAILS_SOURCE, "About this result", "notice"), searchResult(sources.org(), "Coverage", "9 of 14 processes")],
  resultCount: 1,
  resultTokens: 40,
  truncated: false,
  cursor: null,
};

/** A hierarchy result naming two processes, so they can be shown. */
const PROCESSES: AskToolResult = {
  ...FOUND,
  content: [
    searchResult(RESULT_DETAILS_SOURCE, "About this result", "notice"),
    searchResult(sources.entity("process", "p1"), "Payroll (process)", "Process Finance › Payroll. id: p1."),
    searchResult(sources.flowNode("p2", "n4"), "Approve invoice", "Step of Invoicing."),
  ],
  resultCount: 2,
};

const showCall = (refs: string[], id = "toolu_show") => ({
  type: "tool_use",
  id,
  name: "show",
  input: { kind: "entities", refs: refs.map((ref) => ({ kind: "process", id: ref })) },
});

function harness(
  steps: ScriptedStep[],
  overrides: Partial<TurnDeps> & { cancelAfterChecks?: number; groundedIds?: string[] } = {},
) {
  const scripted = createScriptedAskClient(steps);
  const writes: AskMessagePart[][] = [];
  const toolCalls: string[] = [];
  const displayCalls: Array<{ name: string; allowed: string[] }> = [];
  const metered: number[] = [];
  let checks = 0;
  let clock = 1_000;
  const deps: TurnDeps = {
    model: scripted.client,
    tools: ASK_TOOLS,
    runTool: async (tool) => {
      toolCalls.push(tool.name);
      return FOUND;
    },
    // Stands in for the executor: keeps only grounded references.
    runDisplayTool: async (tool, input, allowed) => {
      displayCalls.push({ name: tool.name, allowed });
      const refs = ((input.refs ?? []) as Array<{ kind: "process"; id: string }>).filter((ref) => allowed.includes(ref.id));
      return refs.length
        ? { part: { type: "display", display: (input as { kind: "entities" }).kind, refs: refs as never }, note: `Shown: ${refs.length}` }
        : { part: null, note: "Nothing shown." };
    },
    meter: async (stepIndex, run) => {
      metered.push(stepIndex);
      return await run();
    },
    write: async (parts) => {
      writes.push(parts);
      return "ok";
    },
    isCancelled: async () => {
      checks += 1;
      return overrides.cancelAfterChecks !== undefined && checks > overrides.cancelAfterChecks;
    },
    now: () => (clock += 10),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5))),
    pollIntervalMs: 5,
    ...overrides,
  };
  return {
    deps,
    scripted,
    writes,
    toolCalls,
    displayCalls,
    metered,
    run: () => runTurnLoop(deps, { system: SYSTEM, messages: QUESTION, groundedIds: overrides.groundedIds }),
  };
}

const lookup = (id = "toolu_1") => ({ type: "tool_use", id, name: "searchHierarchy", input: { query: "pay", kinds: [], cursor: "" } });

describe("display tools in the loop (D56)", () => {
  test("a step that answers and only shows ends the turn, with the component after the text", async () => {
    const h = harness(
      [{ content: [lookup()] }, { content: [{ type: "text", text: "Two processes stand out." }, showCall(["p1", "p2"])] }],
      { runTool: async () => PROCESSES },
    );
    const outcome = await h.run();
    expect(outcome.status).toBe("complete");
    expect(h.scripted.callCount()).toBe(2);
    expect(outcome.parts.map((p) => p.type)).toEqual(["tool", "text", "display"]);
    expect(outcome.parts.at(-1)).toMatchObject({ display: "entities", refs: [{ id: "p1" }, { id: "p2" }] });
    // A flow-node source grounds its process too.
    expect(h.displayCalls[0].allowed).toEqual(expect.arrayContaining(["p1", "p2"]));
    expect(outcome.quality).toMatchObject({ stopReason: "end_turn", toolCalls: 2 });
    expect(outcome.telemetry.map((t) => [t.name, t.found])).toEqual([
      ["searchHierarchy", true],
      ["showEntities", true],
    ]);
  });

  test("a show call with no answer text yet lets the model write the answer", async () => {
    const h = harness(
      [{ content: [lookup()] }, { content: [showCall(["p1"])] }, { content: [{ type: "text", text: "Payroll is the one." }] }],
      { runTool: async () => PROCESSES },
    );
    const outcome = await h.run();
    expect(h.scripted.callCount()).toBe(3);
    expect(outcome.parts.map((p) => p.type)).toEqual(["tool", "text", "display"]);
    // The model was told what was shown, as a plain-text tool result.
    // The model was told what was shown, and that the answer is still due.
    const third = h.scripted.requests[2].messages.at(-1) as { content: Array<{ type: string; content: unknown }> };
    expect(third.content[0]).toMatchObject({ type: "tool_result", content: [{ type: "text", text: `Shown: 1 ${ANSWER_STILL_DUE}` }] });
  });

  test("a step that fetches and shows checks the display against what the fetch returned", async () => {
    const h = harness(
      [{ content: [lookup(), showCall(["p1"])] }, { content: [{ type: "text", text: "Payroll." }] }],
      { runTool: async () => PROCESSES },
    );
    const outcome = await h.run();
    expect(h.scripted.callCount()).toBe(2);
    expect(outcome.parts.map((p) => p.type)).toEqual(["tool", "text", "display"]);
  });

  test("drops what no tool returned, and shows what the thread already grounded", async () => {
    const invented = await harness([{ content: [{ type: "text", text: "Here." }, showCall(["p9"])] }]).run();
    expect(invented.parts.map((p) => p.type)).toEqual(["text"]);
    expect(invented.telemetry).toEqual([expect.objectContaining({ name: "showEntities", found: false })]);

    const followUp = await harness([{ content: [{ type: "text", text: "Here." }, showCall(["p9"])] }], { groundedIds: ["p9"] }).run();
    expect(followUp.parts.map((p) => p.type)).toEqual(["text", "display"]);
  });

  test("a picker placed before any text asks for the question, not an answer", async () => {
    const choose = { type: "tool_use", id: "toolu_pick", name: "show", input: { kind: "choices", refs: [{ kind: "process", id: "p1" }, { kind: "process", id: "p2" }] } };
    const h = harness([{ content: [lookup(), choose] }, { content: [{ type: "text", text: "Which Payroll do you mean?" }] }], {
      runTool: async () => PROCESSES,
    });
    const outcome = await h.run();
    expect(outcome.parts.map((p) => p.type)).toEqual(["tool", "text", "display"]);
    expect(outcome.parts.at(-1)).toMatchObject({ display: "choices" });
    const second = h.scripted.requests[1].messages.at(-1) as { content: Array<{ tool_use_id: string; content: Array<{ text: string }> }> };
    expect(second.content.find((r) => r.tool_use_id === "toolu_pick")!.content[0].text).toContain(QUESTION_STILL_DUE);
  });

  test("caps components per answer, and a failed one leaves the answer standing", async () => {
    const calls = ["a", "b", "c", "d"].map((id) => showCall(["p1"], `toolu_${id}`));
    const capped = await harness([{ content: [{ type: "text", text: "Here." }, ...calls] }], { groundedIds: ["p1"] }).run();
    expect(capped.parts.filter((p) => p.type === "display")).toHaveLength(MAX_DISPLAYS);

    const failing = await harness([{ content: [{ type: "text", text: "Here." }, showCall(["p1"])] }], {
      groundedIds: ["p1"],
      runDisplayTool: async () => {
        throw new Error("read limit");
      },
    }).run();
    expect(failing.status).toBe("complete");
    expect(failing.parts.map((p) => p.type)).toEqual(["text"]);
  });

  test("a stopped turn shows no components", async () => {
    const h = harness([{ content: [lookup(), showCall(["p1"])] }, { content: [{ type: "text", text: "never" }] }], {
      runTool: async () => PROCESSES,
      cancelAfterChecks: 1,
    });
    const outcome = await h.run();
    expect(outcome.status).toBe("stopped");
    expect(outcome.parts.some((p) => p.type === "display")).toBe(false);
  });
});

describe("the AskFabric tool loop", () => {
  test("runs a multi-step tool loop into a cited answer, with ordered parts", async () => {
    const thinking = { type: "thinking", thinking: "I should check coverage.", signature: "sig-1" };
    const h = harness([
      {
        events: [{ type: "thinking_start" }, { type: "thinking_delta", text: "I should check coverage." }, { type: "block_stop" }],
        content: [thinking, { type: "text", text: "I'll check coverage first." }, coverageCall()],
      },
      {
        content: [
          { type: "text", text: "Coverage is 64%", citations: [{ type: "search_result_location", source: "fabric:entity/org", title: "Coverage", cited_text: "9 of 14 processes" }] },
          { type: "text", text: " and Finance waits on approvals.", citations: [{ type: "search_result_location", source: "fabric:entity/org", title: "Coverage", cited_text: "9 of 14" }] },
        ],
      },
    ]);
    const outcome = await h.run();

    expect(outcome.status).toBe("complete");
    expect(outcome.parts.map((p) => p.type)).toEqual(["reasoning", "reasoning", "tool", "text"]);
    expect(outcome.parts[1]).toMatchObject({ type: "reasoning", text: "I'll check coverage first." });
    expect(outcome.parts[2]).toMatchObject({ type: "tool", name: "getCoverage", status: "done", resultCount: 1, label: "Checking coverage across the organization" });
    // Repeated sources reuse their chip number (FR-5.1).
    expect(outcome.parts[3]).toEqual({ type: "text", text: "Coverage is 64%[[cite:1]] and Finance waits on approvals.[[cite:1]]" });
    expect(outcome.citations).toHaveLength(1);
    expect(outcome.citations[0]).toMatchObject({ ordinal: 1, source: "fabric:entity/org", parsed: { sourceKind: "org" } });
    expect(outcome.quality).toMatchObject({ modelCalls: 2, toolCalls: 1, citations: 1, zeroCitations: false, stopReason: "end_turn" });
    expect(outcome.telemetry).toEqual([{ name: "getCoverage", latencyMs: expect.any(Number), found: true, resultTokens: 40, truncated: false }]);
    expect(h.metered).toEqual([0, 1]);

    // Step 2 passed step 1's thinking block back unchanged, then the tool result.
    const second = h.scripted.requests[1].messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    expect(second[1]).toEqual({ role: "assistant", content: [thinking, { type: "text", text: "I'll check coverage first." }, coverageCall()] });
    expect(second[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
    expect(h.scripted.requests.map((r) => r.toolChoice)).toEqual(["auto", "auto"]);
    // Progress was written at the tool boundary.
    expect(h.writes.some((parts) => parts.some((p) => p.type === "tool" && p.status === "running"))).toBe(true);
  });

  test("moves cache breakpoints to the last two user messages without editing history", () => {
    const messages = [
      { role: "user", content: "first" },
      { role: "assistant", content: "answer" },
      { role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
      { role: "assistant", content: [{ type: "text", text: "c" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: [] }] },
    ];
    const marked = withCacheBreakpoints(messages) as Array<{ content: Array<Record<string, unknown>> | string }>;
    expect(marked[0].content).toBe("first");
    expect((marked[2].content as Array<Record<string, unknown>>)[1].cache_control).toEqual({ type: "ephemeral" });
    expect((marked[4].content as Array<Record<string, unknown>>)[0].cache_control).toEqual({ type: "ephemeral" });
    expect(JSON.stringify(messages)).not.toContain("cache_control");
  });

  test("caps a turn at 8 model calls, the last with tools off", async () => {
    const steps: ScriptedStep[] = Array.from({ length: MAX_MODEL_CALLS - 1 }, (_, i) => ({ content: [coverageCall(`toolu_${i}`)] }));
    steps.push({ content: [{ type: "text", text: "Here is what I found so far." }] });
    const h = harness(steps);
    const outcome = await h.run();

    expect(h.scripted.callCount()).toBe(MAX_MODEL_CALLS);
    expect(h.scripted.requests.slice(0, -1).every((r) => r.toolChoice === "auto")).toBe(true);
    expect(h.scripted.requests.at(-1)!.toolChoice).toBe("none");
    expect(outcome.status).toBe("complete");
    expect(outcome.quality.stopReason).toBe("stepCap");
  });

  test("turns tools off near the deadline, and stops past it", async () => {
    // The clock stands still except where a slow tool moves it.
    const slowTool = (jumpTo: number) => {
      let clock = 0;
      return {
        now: () => clock,
        runTool: async () => {
          clock = jumpTo;
          return FOUND;
        },
      };
    };
    const nearDeadline = harness(
      [{ content: [coverageCall()] }, { content: [{ type: "text", text: "Done." }] }],
      slowTool(TURN_DEADLINE_MS - TOOLS_OFF_MARGIN_MS + 1_000),
    );
    expect((await nearDeadline.run()).status).toBe("complete");
    expect(nearDeadline.scripted.requests.map((r) => r.toolChoice)).toEqual(["auto", "none"]);

    const pastDeadline = harness(
      [{ content: [coverageCall()] }, { content: [{ type: "text", text: "x" }] }],
      slowTool(TURN_DEADLINE_MS + 1),
    );
    expect(await pastDeadline.run()).toMatchObject({ status: "error", errorReason: "deadline" });
    expect(pastDeadline.scripted.callCount()).toBe(1);
  });

  test("stops mid-stream, keeping what streamed so far", async () => {
    const h = harness(
      [{ events: [{ type: "thinking_start" }, { type: "thinking_delta", text: "Looking at overviews" }], content: [], hangUntilAborted: true }],
      { cancelAfterChecks: 1 },
    );
    const outcome = await h.run();
    expect(outcome.status).toBe("stopped");
    expect(outcome.quality.stopReason).toBe("stopped");
    expect(outcome.parts[0]).toMatchObject({ type: "reasoning", text: "Looking at overviews" });
  });

  test("stops at a tool boundary without another model call", async () => {
    const h = harness([{ content: [coverageCall()] }, { content: [{ type: "text", text: "never" }] }], { cancelAfterChecks: 1 });
    const outcome = await h.run();
    expect(outcome.status).toBe("stopped");
    expect(h.scripted.callCount()).toBe(1);
    expect(h.toolCalls).toEqual(["getCoverage"]);
  });

  test("exits without finishing when the thread is being deleted", async () => {
    const h = harness([{ content: [coverageCall()] }, { content: [{ type: "text", text: "never" }] }], {
      write: async () => "deleting",
    });
    expect((await h.run()).status).toBe("deleted");
    expect(h.scripted.callCount()).toBe(1);
  });

  describe("failure states (FR-2.9)", () => {
    test("retries a 429 once, then reports busy", async () => {
      const h = harness([{ error: { status: 429, retryAfterMs: 1 } }, { error: { status: 429, retryAfterMs: 1 } }]);
      expect(await h.run()).toMatchObject({ status: "error", errorReason: "busy" });
      expect(h.scripted.callCount()).toBe(2);
    });

    test("recovers from one 5xx", async () => {
      const h = harness([{ error: { status: 503 } }, { content: [{ type: "text", text: "Answer." }] }], {
        sleep: () => Promise.resolve(),
      });
      const outcome = await h.run();
      expect(outcome.status).toBe("complete");
      expect(outcome.quality.modelCalls).toBe(2);
    });

    test("reports a model error that isn't retryable", async () => {
      const h = harness([{ error: { status: 400, message: "bad request" } }]);
      expect(await h.run()).toMatchObject({ status: "error", errorReason: "modelError" });
      expect(h.scripted.callCount()).toBe(1);
    });

    test("reports a refusal", async () => {
      const h = harness([{ content: [{ type: "text", text: "" }], stopReason: "refusal" }]);
      expect(await h.run()).toMatchObject({ status: "error", errorReason: "refusal" });
    });

    test("keeps a truncated answer and labels it", async () => {
      const h = harness([{ content: [{ type: "text", text: "A partial answer" }], stopReason: "max_tokens" }]);
      const outcome = await h.run();
      expect(outcome).toMatchObject({ status: "error", errorReason: "truncated" });
      expect(outcome.parts.at(-1)).toEqual({ type: "text", text: "A partial answer" });
    });

    test("ends the turn when the viewer loses access", async () => {
      const h = harness([{ content: [coverageCall()] }], {
        runTool: async () => {
          throw authError("REMOVED", "Not a member of this organization");
        },
      });
      expect(await h.run()).toMatchObject({ status: "error", errorReason: "accessLost" });
    });

    test("a failing tool is reported to the model and the turn continues", async () => {
      const h = harness([{ content: [coverageCall()] }, { content: [{ type: "text", text: "I couldn't check coverage." }] }], {
        runTool: async () => {
          throw new Error("read limit");
        },
      });
      const outcome = await h.run();
      expect(outcome.status).toBe("complete");
      expect(outcome.parts.find((p) => p.type === "tool")).toMatchObject({ status: "failed" });
      const second = h.scripted.requests[1].messages.at(-1) as { content: Array<{ is_error?: boolean }> };
      expect(second.content[0].is_error).toBe(true);
    });
  });
});

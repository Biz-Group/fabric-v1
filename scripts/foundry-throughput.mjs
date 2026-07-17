// Foundry Claude throughput probe.
//
// Measures sustained generation throughput for the Claude synthesis deployment
// so we can tell WHY process-flow generation times out and whether raising the
// deployment's provisioned capacity fixes it.
//
// It reports, per run:
//   - TTFT (time to first token): mostly queue/scheduling wait. High TTFT with a
//     healthy post-TTFT rate => capacity contention (raising capacity helps).
//   - gen rate (tokens/sec after the first token): the model's actual streaming
//     speed. If THIS is ~4 tok/s, more capacity will not help; the deployment
//     tier/region is the constraint.
//   - projected time for a full flow-generation-sized response.
//
// Usage (PowerShell), with the same env the smoke test uses:
//   $env:FOUNDRY_ENDPOINT = "https://<account>.services.ai.azure.com"
//   $env:FOUNDRY_API_KEY = "<key>"
//   $env:FOUNDRY_CLAUDE_DEPLOYMENT = "fabric-claude-haiku-4-5"
//   node scripts/foundry-throughput.mjs            # defaults: 4000 tokens, 3 runs
//   node scripts/foundry-throughput.mjs 8000 5     # 8000 max tokens, 5 runs
//
// Run it before and after a capacity change to compare.

import AnthropicFoundry from "@anthropic-ai/foundry-sdk";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const endpoint = required("FOUNDRY_ENDPOINT")
  .replace(/\/+$/, "")
  .replace(/\/anthropic$/i, "")
  .replace(/\/openai\/v1$/i, "");
const apiKey = required("FOUNDRY_API_KEY");
const claudeDeployment = required("FOUNDRY_CLAUDE_DEPLOYMENT");

const maxTokens = Number(process.argv[2] ?? 4000);
const runs = Number(process.argv[3] ?? 3);

// A representative flow-generation call requests up to 32768 output tokens.
const FLOW_GENERATION_MAX_TOKENS = 32768;
// The single-attempt window we set for flow generation (see processFlows.ts).
const FLOW_TIMEOUT_MS = 450_000;

const anthropic = new AnthropicFoundry({
  apiKey,
  baseURL: `${endpoint}/anthropic`,
  maxRetries: 0,
  timeout: FLOW_TIMEOUT_MS,
});

const system =
  "You are a process-analysis assistant that writes detailed, structured output.";
const user =
  "Write a long, detailed description of a generic corporate procurement " +
  "process. Cover every step, every actor, every decision point, common pain " +
  "points, risks, and automation opportunities. Be exhaustive and verbose; " +
  "keep writing until you have produced a very long document.";

async function probe(runIndex) {
  const startedAt = Date.now();
  let firstTokenAt = null;

  const stream = anthropic.messages.stream({
    model: claudeDeployment,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });

  for await (const event of stream) {
    if (
      firstTokenAt === null &&
      event.type === "content_block_delta" &&
      event.delta?.type === "text_delta"
    ) {
      firstTokenAt = Date.now();
    }
  }

  const finalMessage = await stream.finalMessage();
  const finishedAt = Date.now();

  const outputTokens = finalMessage.usage?.output_tokens ?? 0;
  const ttftMs = firstTokenAt ? firstTokenAt - startedAt : finishedAt - startedAt;
  const genMs = firstTokenAt ? finishedAt - firstTokenAt : 0;
  const genRate = genMs > 0 ? outputTokens / (genMs / 1000) : 0;
  const overallRate = outputTokens / ((finishedAt - startedAt) / 1000);

  console.log(
    `run ${runIndex + 1}/${runs}: ` +
      `${outputTokens} out tok, ` +
      `TTFT ${ttftMs} ms, ` +
      `gen ${genMs} ms (${genRate.toFixed(1)} tok/s), ` +
      `overall ${overallRate.toFixed(1)} tok/s, ` +
      `stop=${finalMessage.stop_reason}`,
  );

  return { ttftMs, genRate, overallRate, outputTokens };
}

console.log(
  `Probing ${claudeDeployment} @ ${endpoint} — ${maxTokens} max tokens, ${runs} run(s)\n`,
);

const results = [];
for (let i = 0; i < runs; i++) {
  try {
    results.push(await probe(i));
  } catch (error) {
    console.error(`run ${i + 1}/${runs}: FAILED`, {
      name: error?.name,
      status: error?.status,
      message: error?.message,
    });
  }
}

if (results.length > 0) {
  const avg = (key) =>
    results.reduce((sum, r) => sum + r[key], 0) / results.length;
  const avgTtft = avg("ttftMs");
  const avgGenRate = avg("genRate");

  console.log("\n--- summary ---");
  console.log(`avg TTFT:      ${avgTtft.toFixed(0)} ms`);
  console.log(`avg gen rate:  ${avgGenRate.toFixed(1)} tok/s (after first token)`);
  console.log(`avg overall:   ${avg("overallRate").toFixed(1)} tok/s`);

  // Project a worst-case full flow response against our 450 s single attempt.
  if (avgGenRate > 0) {
    const projectedMs = avgTtft + (FLOW_GENERATION_MAX_TOKENS / avgGenRate) * 1000;
    console.log(
      `\nProjected worst-case flow response (${FLOW_GENERATION_MAX_TOKENS} tok): ` +
        `~${(projectedMs / 1000).toFixed(0)} s ` +
        `(${projectedMs <= FLOW_TIMEOUT_MS ? "fits" : "EXCEEDS"} the ` +
        `${FLOW_TIMEOUT_MS / 1000} s flow-gen timeout).`,
    );
    console.log(
      "Interpretation: high TTFT + healthy gen rate => capacity queuing " +
        "(a capacity raise should help). Low gen rate throughout => the " +
        "deployment tier/region is the limit (capacity will not help).",
    );
  }
}

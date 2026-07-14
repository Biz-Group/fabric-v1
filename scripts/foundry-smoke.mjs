import AnthropicFoundry from "@anthropic-ai/foundry-sdk";
import OpenAI from "openai";

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
const safetyDeployment = required("FOUNDRY_SAFETY_DEPLOYMENT");
const fallbackDeployment = required("FOUNDRY_OPENAI_FALLBACK_DEPLOYMENT");

const anthropic = new AnthropicFoundry({
  apiKey,
  baseURL: `${endpoint}/anthropic`,
  maxRetries: 2,
  timeout: 60_000,
});

const openai = new OpenAI({
  apiKey,
  baseURL: `${endpoint}/openai/v1/`,
  maxRetries: 2,
  timeout: 60_000,
});

async function timed(name, run) {
  const startedAt = Date.now();
  const result = await run();
  console.log(`${name}: ok (${Date.now() - startedAt} ms, ${result})`);
}

await timed("Claude synthesis", async () => {
  const message = await anthropic.messages.create({
    model: claudeDeployment,
    max_tokens: 32,
    system: "You are a deployment health check.",
    messages: [{ role: "user", content: "Reply with exactly OK." }],
  });
  return message.stop_reason ?? "unknown stop reason";
});

await timed("GPT-5 nano safety tool", async () => {
  const completion = await openai.chat.completions.create({
    model: safetyDeployment,
    max_completion_tokens: 128,
    reasoning_effort: "minimal",
    messages: [
      { role: "system", content: "Classify the text with the provided tool." },
      { role: "user", content: "Monthly payroll process context." },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "classify",
          description: "Return the test classification.",
          strict: true,
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              decision: { type: "string", enum: ["allow", "block"] },
            },
            required: ["decision"],
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "classify" } },
    parallel_tool_calls: false,
  });
  return completion.choices[0]?.finish_reason ?? "unknown finish reason";
});

await timed("GPT-5 mini fallback", async () => {
  const completion = await openai.chat.completions.create({
    model: fallbackDeployment,
    max_completion_tokens: 64,
    reasoning_effort: "minimal",
    messages: [{ role: "user", content: "Reply with exactly OK." }],
  });
  return completion.choices[0]?.finish_reason ?? "unknown finish reason";
});

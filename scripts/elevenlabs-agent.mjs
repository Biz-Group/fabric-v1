// The "Fabric" interview agent's configuration, under version control.
//
// The agent lives on the ElevenLabs dashboard and is shared by dev, prod and
// every tenant, so a portal edit is live everywhere at once. This script keeps
// the parts that decide its behaviour in git, in infra/elevenlabs/fabric-agent/,
// and checks the live agent against them. See infra/elevenlabs/README.md and
// docs/consultative-approach-task-list.md task 1.10.
//
// Usage (PowerShell):
//   $env:ELEVENLABS_API_KEY = npx convex env get ELEVENLABS_API_KEY
//   $env:ELEVENLABS_AGENT_ID = npx convex env get ELEVENLABS_AGENT_ID
//   node scripts/elevenlabs-agent.mjs export   # write the snapshot
//   node scripts/elevenlabs-agent.mjs check    # exit 1 if live differs
//
// Both commands are read-only against ElevenLabs. Nothing secret is written:
// only the prompt, first message, model and turn settings, data-collection
// fields, success criteria and tool names.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT_DIR = path.join(ROOT, "infra", "elevenlabs", "fabric-agent");

const command = process.argv[2];
if (command !== "export" && command !== "check") {
  console.error("Usage: node scripts/elevenlabs-agent.mjs <export|check>");
  process.exit(2);
}

const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
const agentId = process.env.ELEVENLABS_AGENT_ID?.trim();
if (!apiKey || !agentId) {
  console.error(
    "Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID.\n" +
      "  PowerShell: $env:ELEVENLABS_API_KEY = npx convex env get ELEVENLABS_API_KEY\n" +
      "              $env:ELEVENLABS_AGENT_ID = npx convex env get ELEVENLABS_AGENT_ID",
  );
  process.exit(1);
}

async function fetchAgent() {
  const url = `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(agentId)}`;
  const response = await fetch(url, { headers: { "xi-api-key": apiKey } });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}\n${body.slice(0, 400)}`);
  }
  return await response.json();
}

/** Keys sorted at every level, so the snapshot diffs cleanly. */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

const json = (value) => `${JSON.stringify(stable(value), null, 2)}\n`;
const text = (value) => `${String(value ?? "").replace(/\s+$/, "")}\n`;

/** The behaviour-deciding parts of the agent, as the files they are stored in. */
function snapshotFiles(agent) {
  const config = agent.conversation_config ?? {};
  const agentConfig = config.agent ?? {};
  const prompt = agentConfig.prompt ?? {};
  const platform = agent.platform_settings ?? {};
  // Built-in tools are listed both by key and in `tools`; count each once.
  const toolNames = [
    ...new Set([
      ...Object.entries(prompt.built_in_tools ?? {})
        .filter(([, tool]) => tool)
        .map(([name]) => name),
      ...(prompt.tools ?? []).map((tool) => tool.name).filter(Boolean),
    ]),
  ].sort();

  return {
    "system-prompt.md": text(prompt.prompt),
    "first-message.md": text(agentConfig.first_message),
    "settings.json": json({
      name: agent.name,
      language: agentConfig.language,
      llm: prompt.llm,
      temperature: prompt.temperature,
      maxTokens: prompt.max_tokens,
      tools: toolNames,
      voiceId: config.tts?.voice_id,
      ttsModel: config.tts?.model_id,
      turn: config.turn,
      maxDurationSeconds: config.conversation?.max_duration_seconds,
    }),
    "data-collection.json": json(platform.data_collection ?? {}),
    "evaluation.json": json(platform.evaluation ?? {}),
  };
}

const agent = await fetchAgent();
const files = snapshotFiles(agent);

if (command === "export") {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(SNAPSHOT_DIR, name), content, "utf8");
  }
  console.log(
    `Wrote ${Object.keys(files).length} files to infra/elevenlabs/fabric-agent/ ` +
      `(agent version ${agent.version_id ?? "unknown"}).`,
  );
} else {
  const drifted = [];
  for (const [name, content] of Object.entries(files)) {
    const stored = await readFile(path.join(SNAPSHOT_DIR, name), "utf8").catch(() => null);
    if (stored !== content) drifted.push(name);
  }
  if (drifted.length > 0) {
    console.error(
      `The live agent differs from the snapshot in: ${drifted.join(", ")}.\n` +
        "If the change was intended, run `export` and review the diff; otherwise roll the agent back.",
    );
    process.exit(1);
  }
  console.log(`The live agent matches the snapshot (version ${agent.version_id ?? "unknown"}).`);
}

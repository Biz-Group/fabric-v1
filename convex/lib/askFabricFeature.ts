import { env } from "../_generated/server";
import { TOKEN_RATES } from "./aiPricing";
import { isOrgInRollout, parseOrgRollout, type OrgRollout } from "./orgRollout";

/**
 * AskFabric rollout switch and configuration (FR-2.8, FR-9.6).
 *
 * AskFabric fails closed: with the switch off for the org, or any setting
 * missing or invalid, it is unavailable and makes no model call. It never
 * falls back to the pipeline's Claude deployment.
 */

/** Every AskFabric call is a Claude call on Foundry. */
export const ASKFABRIC_PROVIDER = "foundry-claude";

/**
 * Ledger operations (FR-8.1). Rows carry org, actor and thread, never content.
 * `turn` is one row per model call; a turn's rows share `runId` (the assistant
 * message), and `eval` and `judge` exist on dev only.
 */
export const ASKFABRIC_OPERATIONS = {
  turn: "askfabric.turn",
  title: "askfabric.title",
  eval: "askfabric.eval",
  judge: "askfabric.judge",
} as const;

/**
 * Foundry model version 2 is the Azure-hosted model (D24); version 1 is
 * Anthropic-hosted and was rejected for residency.
 */
const AZURE_HOSTED_MODEL_VERSION = "2";

export type AskFabricUnavailableReason =
  | "switchOff"
  | "missingConfig"
  | "invalidConfig";

export type AskFabricConfig = {
  endpoint: string;
  apiKey: string;
  deployment: string;
  /** Canonical model ID, e.g. `claude-sonnet-5-5`. */
  model: string;
  /** The `model` recorded on usage rows, matching the `TOKEN_RATES` key. */
  meteredModel: string;
  /** Answer effort. Unset is `medium`; the eval's effort sweep varies it (FR-10.5). */
  effort?: AskEffort;
};

export type AskEffort = "low" | "medium" | "high";

export type AskFabricConfigResult =
  | { ok: true; config: AskFabricConfig }
  | { ok: false; reason: Exclude<AskFabricUnavailableReason, "switchOff"> };

type AskFabricSettings = {
  endpoint?: string;
  apiKey?: string;
  deployment?: string;
  model?: string;
  pipelineDeployment?: string;
};

export function meteredAskFabricModel(model: string): string {
  return `foundry:${model}@${AZURE_HOSTED_MODEL_VERSION}`;
}

/** Pure half of `readAskFabricConfig`, so the rules are testable without env. */
export function parseAskFabricConfig(
  settings: AskFabricSettings,
): AskFabricConfigResult {
  const endpoint = settings.endpoint?.trim().replace(/\/+$/, "");
  const apiKey = settings.apiKey?.trim();
  const deployment = settings.deployment?.trim();
  const model = settings.model?.trim();
  if (!endpoint || !apiKey || !deployment || !model) {
    return { ok: false, reason: "missingConfig" };
  }

  const meteredModel = meteredAskFabricModel(model);
  const invalid =
    !endpoint.startsWith("https://") ||
    // D23: the deployment name carries the canonical model ID, so a mismatch
    // means one of the two variables points at the wrong thing.
    !deployment.includes(model) ||
    // AskFabric has its own capacity; sharing the pipeline's would let chat
    // traffic starve interview processing.
    deployment === settings.pipelineDeployment?.trim() ||
    // Usage is billed to the client, so an unpriced model must not run.
    !TOKEN_RATES[`${ASKFABRIC_PROVIDER}:${meteredModel}`];
  if (invalid) return { ok: false, reason: "invalidConfig" };

  return {
    ok: true,
    config: {
      endpoint: endpoint.replace(/\/anthropic$/i, ""),
      apiKey,
      deployment,
      model,
      meteredModel,
    },
  };
}

export function readAskFabricConfig(): AskFabricConfigResult {
  return parseAskFabricConfig({
    endpoint: env.FOUNDRY_ENDPOINT,
    apiKey: env.FOUNDRY_API_KEY,
    deployment: env.ASKFABRIC_FOUNDRY_DEPLOYMENT,
    model: env.ASKFABRIC_MODEL,
    pipelineDeployment: env.FOUNDRY_CLAUDE_DEPLOYMENT,
  });
}

// ---- Eval deployments (FR-10.5a) -------------------------------------------------

/**
 * `ASKFABRIC_EVAL_DEPLOYMENTS`: comma-separated `deployment=model` pairs the
 * eval harness may call, each priced at its own model's rate. Malformed or
 * unpriced pairs are dropped, so a typo can't run unmetered.
 */
export function parseEvalDeployments(raw: string | undefined): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const entry of (raw ?? "").split(",")) {
    const [deployment, model] = entry.split("=").map((part) => part?.trim());
    if (!deployment || !model || !deployment.includes(model)) continue;
    if (!TOKEN_RATES[`${ASKFABRIC_PROVIDER}:${meteredAskFabricModel(model)}`]) continue;
    pairs.set(deployment, model);
  }
  return pairs;
}

export type AskFabricEvalConfigResult =
  | { ok: true; config: AskFabricConfig }
  | { ok: false; reason: string };

/**
 * The config for an eval or judge call on `deployment`. Dev only: refused on a
 * deployment labelled prod, and for any deployment not listed in
 * `ASKFABRIC_EVAL_DEPLOYMENTS`, which production never sets.
 */
export function readAskFabricEvalConfig(deployment: string, effort?: AskEffort): AskFabricEvalConfigResult {
  if (env.USAGE_DEPLOYMENT_LABEL === "prod") return { ok: false, reason: "The eval harness never runs on prod." };
  const model = parseEvalDeployments(env.ASKFABRIC_EVAL_DEPLOYMENTS).get(deployment);
  if (!model) return { ok: false, reason: `${deployment} isn't listed in ASKFABRIC_EVAL_DEPLOYMENTS.` };
  const endpoint = env.FOUNDRY_ENDPOINT?.trim().replace(/\/+$/, "").replace(/\/anthropic$/i, "");
  const apiKey = env.FOUNDRY_API_KEY?.trim();
  if (!endpoint?.startsWith("https://") || !apiKey) return { ok: false, reason: "Foundry isn't configured." };
  return {
    ok: true,
    config: { endpoint, apiKey, deployment, model, meteredModel: meteredAskFabricModel(model), ...(effort ? { effort } : {}) },
  };
}

export function askFabricRollout(): OrgRollout {
  return parseOrgRollout(env.ASKFABRIC);
}

export type AskFabricAvailability =
  | { available: true }
  | { available: false; reason: AskFabricUnavailableReason };

export function askFabricAvailability(
  clerkOrgId: string,
): AskFabricAvailability {
  if (!isOrgInRollout(askFabricRollout(), clerkOrgId)) {
    return { available: false, reason: "switchOff" };
  }
  const config = readAskFabricConfig();
  return config.ok
    ? { available: true }
    : { available: false, reason: config.reason };
}

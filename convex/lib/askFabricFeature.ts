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
};

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

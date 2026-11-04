import { v } from "convex/values";

/**
 * The description-safety validators the schema stores. Kept apart from
 * `descriptionSafety.ts`, which imports the AI SDKs: the schema must not pull
 * them in, or Convex can't evaluate it (`NoImportModuleInSchema`).
 */

export const descriptionSafetyStatusValidator = v.union(
  v.literal("safe"),
  v.literal("blocked"),
);

export const descriptionSafetyRiskValidator = v.union(
  v.literal("none"),
  v.literal("prompt_injection"),
  v.literal("agent_instruction"),
  v.literal("policy_override"),
  v.literal("sensitive_data_request"),
  v.literal("malicious_or_abusive"),
  v.literal("irrelevant"),
);

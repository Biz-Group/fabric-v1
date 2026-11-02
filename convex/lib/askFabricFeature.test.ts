/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import {
  askFabricAvailability,
  parseAskFabricConfig,
} from "./askFabricFeature";

const modules = import.meta.glob("../**/*.ts");
const ORG = "org_askfabric_pilot";
const OTHER_ORG = "org_askfabric_other";
const ISSUER = "https://askfabric-feature.test";

const ENV_KEYS = [
  "ASKFABRIC",
  "ASKFABRIC_FOUNDRY_DEPLOYMENT",
  "ASKFABRIC_MODEL",
  "FOUNDRY_ENDPOINT",
  "FOUNDRY_API_KEY",
  "FOUNDRY_CLAUDE_DEPLOYMENT",
] as const;
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

const VALID = {
  endpoint: "https://ai-account.services.ai.azure.com/",
  apiKey: "key",
  deployment: "askfabric-claude-sonnet-5-5",
  model: "claude-sonnet-5-5",
  pipelineDeployment: "fabric-claude-haiku-5-5",
};

function configure(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}) {
  const values = {
    ASKFABRIC: ORG,
    ASKFABRIC_FOUNDRY_DEPLOYMENT: VALID.deployment,
    ASKFABRIC_MODEL: VALID.model,
    FOUNDRY_ENDPOINT: VALID.endpoint,
    FOUNDRY_API_KEY: VALID.apiKey,
    FOUNDRY_CLAUDE_DEPLOYMENT: VALID.pipelineDeployment,
    ...overrides,
  };
  for (const key of ENV_KEYS) {
    if (values[key] === "") delete process.env[key];
    else process.env[key] = values[key];
  }
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("parseAskFabricConfig", () => {
  test("accepts a priced model on its own deployment", () => {
    expect(parseAskFabricConfig(VALID)).toEqual({
      ok: true,
      config: {
        endpoint: "https://ai-account.services.ai.azure.com",
        apiKey: "key",
        deployment: "askfabric-claude-sonnet-5-5",
        model: "claude-sonnet-5-5",
        meteredModel: "foundry:claude-sonnet-5-5@2",
      },
    });
  });

  test.each(["endpoint", "apiKey", "deployment", "model"] as const)(
    "is missingConfig without %s",
    (field) => {
      expect(parseAskFabricConfig({ ...VALID, [field]: " " })).toEqual({
        ok: false,
        reason: "missingConfig",
      });
    },
  );

  test.each([
    ["the pipeline's deployment", { deployment: "claude-sonnet-5-5-pipeline", pipelineDeployment: "claude-sonnet-5-5-pipeline" }],
    ["a deployment that doesn't name the model", { deployment: "askfabric-chat" }],
    ["an unpriced model", { model: "claude-sonnet-9", deployment: "askfabric-claude-sonnet-9" }],
    ["a non-https endpoint", { endpoint: "http://ai-account.services.ai.azure.com" }],
  ])("is invalidConfig for %s", (_label, overrides) => {
    expect(parseAskFabricConfig({ ...VALID, ...overrides })).toEqual({
      ok: false,
      reason: "invalidConfig",
    });
  });
});

describe("askFabricAvailability", () => {
  test("is available for an allowlisted org with valid config", () => {
    configure();
    expect(askFabricAvailability(ORG)).toEqual({ available: true });
  });

  test.each(["", "false", OTHER_ORG])(
    "is switchOff when ASKFABRIC is %j",
    (value) => {
      configure({ ASKFABRIC: value });
      expect(askFabricAvailability(ORG)).toEqual({
        available: false,
        reason: "switchOff",
      });
    },
  );

  test("is on for every org when ASKFABRIC is true", () => {
    configure({ ASKFABRIC: "true" });
    expect(askFabricAvailability(OTHER_ORG)).toEqual({ available: true });
  });

  test.each([
    "ASKFABRIC_FOUNDRY_DEPLOYMENT",
    "ASKFABRIC_MODEL",
    "FOUNDRY_ENDPOINT",
    "FOUNDRY_API_KEY",
  ] as const)("is missingConfig without %s", (key) => {
    configure({ [key]: "" });
    expect(askFabricAvailability(ORG)).toEqual({
      available: false,
      reason: "missingConfig",
    });
  });

  test("is invalidConfig when pointed at the pipeline deployment", () => {
    configure({
      ASKFABRIC_FOUNDRY_DEPLOYMENT: "fabric-claude-sonnet-5-5",
      FOUNDRY_CLAUDE_DEPLOYMENT: "fabric-claude-sonnet-5-5",
    });
    expect(askFabricAvailability(ORG)).toEqual({
      available: false,
      reason: "invalidConfig",
    });
  });
});

describe("ask.getAvailability", () => {
  async function seed(role: "admin" | "viewer") {
    const t = convexTest(schema, modules);
    const name = `${role}-user`;
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: `${ISSUER}|${name}`,
        name,
        email: `${name}@example.test`,
        profileComplete: true,
      });
      await ctx.db.insert("memberships", {
        tokenIdentifier: `${ISSUER}|${name}`,
        userId,
        clerkOrgId: ORG,
        role,
        createdAt: Date.now(),
      });
    });
    return t.withIdentity({
      tokenIdentifier: `${ISSUER}|${name}`,
      subject: name,
      issuer: ISSUER,
      orgId: ORG,
      orgSlug: ORG,
    });
  }

  test("shows admins the reason and members only that it is unavailable", async () => {
    configure({ ASKFABRIC_MODEL: "" });
    const admin = await seed("admin");
    const viewer = await seed("viewer");

    expect(await admin.query(api.ask.getAvailability, {})).toEqual({
      available: false,
      reason: "missingConfig",
    });
    expect(await viewer.query(api.ask.getAvailability, {})).toEqual({
      available: false,
      reason: null,
    });
  });

  test("reports available when configured", async () => {
    configure();
    const viewer = await seed("viewer");
    expect(await viewer.query(api.ask.getAvailability, {})).toEqual({
      available: true,
      reason: null,
    });
  });
});

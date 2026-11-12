import { defineApp } from "convex/server";
import migrations from "@convex-dev/migrations/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import { v } from "convex/values";

const app = defineApp({
  env: {
    // Foundry is the only AI provider. There is no provider switch: adding one
    // back would make an unset variable route traffic to a second
    // sub-processor, which is exactly the failure mode the OpenRouter sunset
    // removed. Pick backends within Foundry via FOUNDRY_SYNTHESIS_BACKEND.
    FOUNDRY_ENDPOINT: v.optional(v.string()),
    FOUNDRY_API_KEY: v.optional(v.string()),
    FOUNDRY_SYNTHESIS_BACKEND: v.optional(
      v.union(v.literal("claude"), v.literal("openai")),
    ),
    FOUNDRY_CLAUDE_DEPLOYMENT: v.optional(v.string()),
    FOUNDRY_OPENAI_FALLBACK_DEPLOYMENT: v.optional(v.string()),
    FOUNDRY_SAFETY_DEPLOYMENT: v.optional(v.string()),
    // "true" (all tenants), "false"/unset (no tenants), or a comma-separated
    // Clerk organization allowlist for staged rollout on the shared prod
    // deployment. See lib/summaryV2Feature.ts.
    SUMMARY_V2: v.optional(v.string()),
    // AskFabric rollout switch, same three forms as SUMMARY_V2. See
    // lib/askFabricFeature.ts.
    ASKFABRIC: v.optional(v.string()),
    // AskFabric's own Foundry deployment and its canonical model ID (for
    // example `askfabric-claude-sonnet-5-5` and `claude-sonnet-5-5`). It reuses
    // FOUNDRY_ENDPOINT and FOUNDRY_API_KEY but never the pipeline deployment:
    // a missing value makes AskFabric unavailable instead of falling back.
    ASKFABRIC_FOUNDRY_DEPLOYMENT: v.optional(v.string()),
    ASKFABRIC_MODEL: v.optional(v.string()),
    // Beta limits (D51): questions per member and per org per Gulf-time day.
    // Unset means 10 and 100; `off` removes the limit. See lib/askLimits.ts.
    ASKFABRIC_DAILY_USER_LIMIT: v.optional(v.string()),
    ASKFABRIC_DAILY_ORG_LIMIT: v.optional(v.string()),
    // Read aloud: the ElevenLabs voice and model. Unset means the Fabric
    // interviewer's voice and v4 Turbo. See lib/askSpeech.ts.
    ASKFABRIC_TTS_VOICE_ID: v.optional(v.string()),
    ASKFABRIC_TTS_MODEL: v.optional(v.string()),
    // Dev only: comma-separated `deployment=model` pairs the eval harness may
    // run against, so each run is priced at its own model's rate. Production
    // never reads it.
    ASKFABRIC_EVAL_DEPLOYMENTS: v.optional(v.string()),
    // Tags every AI usage ledger row with the deployment that produced it, so
    // the platform console can show prod and dev in one merged view.
    // Unset defaults to "dev" — deliberately the safe direction: an
    // unconfigured deployment is by definition not the one we set up, and
    // mislabelling prod as dev is instantly visible (prod totals read empty),
    // whereas mislabelling dev as prod silently corrupts prod's numbers.
    USAGE_DEPLOYMENT_LABEL: v.optional(
      v.union(v.literal("prod"), v.literal("dev")),
    ),
    // Where this deployment forwards its usage rows. Set on dev only — the sink
    // (prod) leaves both unset, which is how `forwardPendingUsage` knows it has
    // nothing to forward. Point it at the sink's
    // `https://<prod-deployment>.convex.site/ai-usage/ingest`.
    USAGE_SINK_URL: v.optional(v.string()),
    // Shared bearer secret for the ingest route. Must match on both sides.
    USAGE_SINK_SECRET: v.optional(v.string()),
    // First-run onboarding cutoff, in epoch milliseconds. Only memberships
    // created at or after it are onboarded, and only users created after it
    // must watch the tour before building. Unset or invalid turns onboarding
    // off, which makes this the kill switch. See lib/onboarding.ts.
    ONBOARDING_LAUNCHED_AT: v.optional(v.string()),
    // Fabric MCP server (docs/fabric-mcp-server-feasibility.md, convex/mcp/).
    // Deployment-level switch in the same three forms as SUMMARY_V2.
    FABRIC_MCP: v.optional(v.string()),
    // Comma-separated Clerk OAuth client ids whose tokens the MCP server
    // accepts. Unset accepts none (fails closed).
    FABRIC_MCP_CLIENT_IDS: v.optional(v.string()),
    // The public base URL clients connect to, e.g. https://mcp.bizfabric.ai
    // (M11). Unset falls back to CONVEX_SITE_URL. Every connector is bound to
    // this URL, so change it only before real users connect.
    FABRIC_MCP_PUBLIC_URL: v.optional(v.string()),
    // "true" rejects tokens whose `aud` claim isn't this server's resource
    // URL. Otherwise a mismatch is only logged (Clerk instance setting
    // aud_claim_enabled controls whether tokens carry `aud` at all).
    FABRIC_MCP_ENFORCE_AUDIENCE: v.optional(v.string()),
  },
});
app.use(migrations);
app.use(rateLimiter);

export default app;

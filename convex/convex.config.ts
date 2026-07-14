import { defineApp } from "convex/server";
import migrations from "@convex-dev/migrations/convex.config.js";
import { v } from "convex/values";

const app = defineApp({
  env: {
    AI_PROVIDER: v.optional(
      v.union(v.literal("openrouter"), v.literal("foundry")),
    ),
    OPENROUTER_API_KEY: v.optional(v.string()),
    FOUNDRY_ENDPOINT: v.optional(v.string()),
    FOUNDRY_API_KEY: v.optional(v.string()),
    FOUNDRY_SYNTHESIS_BACKEND: v.optional(
      v.union(v.literal("claude"), v.literal("gpt5mini")),
    ),
    FOUNDRY_CLAUDE_DEPLOYMENT: v.optional(v.string()),
    FOUNDRY_OPENAI_FALLBACK_DEPLOYMENT: v.optional(v.string()),
    FOUNDRY_SAFETY_DEPLOYMENT: v.optional(v.string()),
  },
});
app.use(migrations);

export default app;

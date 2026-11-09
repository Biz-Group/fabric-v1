/**
 * Rates for the AI usage ledger.
 *
 * Every cost in this codebase is an **integer of micro-USD** (1e-6 USD). Floats
 * accumulate drift across thousands of rows, and per-token rates are 1e-6-scale
 * to begin with — so the natural unit and the storage unit are the same thing.
 *
 * Convenient consequence: **USD per million tokens is numerically identical to
 * micro-USD per token** ($1/MTok = 1e-6 USD/token = 1 µUSD/token). The token
 * rates below therefore read exactly as the providers publish them.
 *
 * Rates are versioned, not mutated. A ledger row keeps the `priceVersion` it
 * was priced at, so re-pricing history is a deliberate migration rather than a
 * silent restatement. When a rate changes: bump `PRICE_VERSION`, edit the
 * table, and leave existing rows alone.
 */

/** Bump on any rate change. Rows record the version they were priced at. */
export const PRICE_VERSION = "2026-11-09";

/**
 * Recorded instead of a version when no rate is known for a model. Such rows
 * carry `costMicroUsd: 0` — deliberately, and visibly. A wrong number in a
 * billing ledger is worse than an obviously missing one, and the console can
 * filter on this marker to show "N calls unpriced" rather than quietly
 * understating spend.
 */
export const UNPRICED_VERSION = "unpriced";

export type TokenRate = {
  /** Micro-USD per uncached input token. */
  readonly input: number;
  /** Micro-USD per output token. */
  readonly output: number;
  /** Micro-USD per input token served from the prompt cache. */
  readonly cachedRead: number;
  /** Micro-USD per input token written to the prompt cache. */
  readonly cacheWrite: number;
  /**
   * Whether the provider's reported input-token count already contains the
   * cached tokens — both cache reads and cache writes.
   *
   * This is the single most expensive detail in this file to get wrong.
   * Anthropic reports three **disjoint** buckets (`input_tokens`,
   * `cache_read_input_tokens`, `cache_creation_input_tokens`), whereas OpenAI
   * reports `prompt_tokens` as the **total** with
   * `prompt_tokens_details.cached_tokens` (and, on GPT-6,
   * `prompt_tokens_details.cache_write_tokens`) as subsets of it. Treating the
   * OpenAI shape as disjoint charges every cached token twice — once at the
   * full input rate and once at the cached rate.
   */
  readonly inputIncludesCached: boolean;
  /**
   * A higher tier that reprices the WHOLE request — output included — once
   * its prompt exceeds `aboveInputTokens`. The prompt is every input token,
   * cached or not, as Anthropic counts it for tiered pricing.
   */
  readonly longContext?: {
    readonly aboveInputTokens: number;
    readonly rate: Omit<TokenRate, "inputIncludesCached" | "longContext">;
  };
};

/**
 * Keyed `${provider}:${model}` using the exact `AICompletion.provider` and
 * `AICompletion.model` values (see the model constants in `aiProvider.ts`), so
 * a rename there fails to resolve loudly rather than silently mispricing.
 */
export const TOKEN_RATES: Readonly<Record<string, TokenRate>> = {
  // Claude on Microsoft Foundry bills at Anthropic's standard first-party API
  // rates through the Microsoft Marketplace — NOT at partner rates the way
  // Bedrock and Vertex do. Haiku 5.5: $0.10 / $0.50 per MTok for prompts up to
  // 100k tokens and $0.50 / $2.50 above, cache reads 0.1x, cache writes 1.25x
  // (5-minute TTL).
  "foundry-claude:foundry:claude-haiku-5-5@2": {
    input: 0.1,
    output: 0.5,
    cachedRead: 0.01,
    cacheWrite: 0.125,
    inputIncludesCached: false,
    longContext: {
      aboveInputTokens: 100_000,
      rate: { input: 0.5, output: 2.5, cachedRead: 0.05, cacheWrite: 0.625 },
    },
  },

  // Haiku 4.5 (prod moved to 5.5 on 2026-10-26): $1.00 / $5.00 per MTok. Kept so rows
  // written before the switch still resolve.
  "foundry-claude:foundry:claude-haiku-4-5@2": {
    input: 1.0,
    output: 5.0,
    cachedRead: 0.1,
    cacheWrite: 1.25,
    inputIncludesCached: false,
  },

  // AskFabric (D46): Sonnet 5.5, $2.00 / $10.00 per MTok, cache reads $0.20,
  // 5-minute cache writes 1.25x. Usage is passed through to the client, so
  // these rows are the billing basis.
  "foundry-claude:foundry:claude-sonnet-5-5@2": {
    input: 2.0,
    output: 10.0,
    cachedRead: 0.2,
    cacheWrite: 2.5,
    inputIncludesCached: false,
  },

  // AskFabric's dev eval judge (D48): Opus 5.5, $4.00 / $20.00 per MTok,
  // cache reads $0.20 (0.05x on this model), 5-minute cache writes 1.25x.
  "foundry-claude:foundry:claude-opus-5-5@2": {
    input: 4.0,
    output: 20.0,
    cachedRead: 0.2,
    cacheWrite: 5.0,
    inputIncludesCached: false,
  },

  // Description safety, from 2026-11-09. Azure EU Data Zone Standard, Sweden
  // Central retail meters "6-luna ... Std DZ" (prices.azure.com, 9 Nov 2026).
  // Unlike GPT-5, GPT-6 bills cache writes. The 272k long-context threshold
  // comes from third-party price tables, not Microsoft. No request on this
  // path comes near it.
  "foundry-openai:foundry:gpt-6-luna@2026-09-22": {
    input: 0.12,
    output: 0.6,
    cachedRead: 0.012,
    cacheWrite: 0.15,
    inputIncludesCached: true,
    longContext: {
      aboveInputTokens: 272_000,
      rate: { input: 0.24, output: 0.9, cachedRead: 0.024, cacheWrite: 0.3 },
    },
  },

  // Synthesis fallback (FOUNDRY_SYNTHESIS_BACKEND=openai), from 2026-11-09.
  // EU Data Zone Standard, meters "61 terra ... Std DZ". Same caveats as Luna.
  "foundry-openai:foundry:gpt-6.1-terra@2026-10-26": {
    input: 1.2,
    output: 6.0,
    cachedRead: 0.06,
    cacheWrite: 1.5,
    inputIncludesCached: true,
    longContext: {
      aboveInputTokens: 272_000,
      rate: { input: 2.4, output: 9.0, cachedRead: 0.12, cacheWrite: 3.0 },
    },
  },

  // gpt-5-nano (safety until 2026-11-09), Azure Global Standard. Kept so rows
  // written before the switch still resolve.
  "foundry-openai:foundry:gpt-5-nano@2025-08-07": {
    input: 0.05,
    output: 0.4,
    cachedRead: 0.005,
    // GPT-5's automatic prompt caching carried no separate write charge.
    cacheWrite: 0,
    inputIncludesCached: true,
  },

  // `foundry:gpt-5-mini@2025-08-07` never got a rate. It served no traffic:
  // FOUNDRY_SYNTHESIS_BACKEND stayed `claude` in both deployments.

};

const MICRO_USD_PER_USD = 1_000_000;

const usdPerMinute = (usd: number): number => (usd * MICRO_USD_PER_USD) / 60;
const usdPerHour = (usd: number): number => (usd * MICRO_USD_PER_USD) / 3600;

/**
 * Micro-USD **per second**. Voice is billed per minute or per hour upstream;
 * normalising to seconds here means the ledger never has to round a duration.
 */
export const VOICE_RATES: Readonly<Record<string, number>> = {
  // ElevenAgents call minutes, $0.08/min list rate.
  //
  // Only a fallback: an agent conversation's real cost comes from the provider
  // itself (`metadata.charging` — see `elevenLabsCharging.ts`), which reports
  // exact USD, whether the call bursted, and how much plan allowance it
  // absorbed. Use this rate only when that payload is unavailable.
  //
  // ElevenLabs applies a 95% discount to silence periods over 10 seconds, which
  // is already reflected in the billed duration they report — so feed this rate
  // their `call_duration_secs`, never a wall-clock duration.
  "elevenlabs:agent-call": usdPerMinute(0.08),

  // Scribe v2 speech-to-text, $0.22/hour. Our request sends diarize,
  // tag_audio_events, word timestamps and no_verbatim — none of which are
  // metered add-ons, so the base rate applies. If entity detection
  // (+$0.070/hr) or keyterm prompting (+$0.050/hr) is ever enabled, add a
  // distinct key rather than editing this one.
  "elevenlabs:scribe_v2": usdPerHour(0.22),
};

/**
 * Micro-USD **per character** of text-to-speech input, at the API list rate:
 * $0.04 per 1K characters for v4 Turbo, Flash and Turbo; $0.08 for v4 and
 * Multilingual v2 (elevenlabs.io/pricing/api, 3 Nov 2026).
 */
export const CHARACTER_RATES: Readonly<Record<string, number>> = {
  "elevenlabs:eleven_v4_turbo": 40,
  "elevenlabs:eleven_flash_v2_5": 40,
  "elevenlabs:eleven_turbo_v2_5": 40,
  "elevenlabs:eleven_multilingual_v2": 80,
};

export type PricedCost = {
  costMicroUsd: number;
  priceVersion: string;
};

const UNPRICED: PricedCost = {
  costMicroUsd: 0,
  priceVersion: UNPRICED_VERSION,
};

/**
 * One warning per unknown key per isolate. Unbounded warning on a hot path
 * (description-safety runs on every description edit) would bury the signal it
 * exists to raise.
 */
const warnedKeys = new Set<string>();

function warnUnpriced(kind: string, key: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn("AI usage priced at zero: no rate for this key", {
    kind,
    key,
    priceVersion: PRICE_VERSION,
    hint: "Add the rate to convex/lib/aiPricing.ts and bump PRICE_VERSION.",
  });
}

function tokenRateKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

export type TokenUsageForPricing = {
  /** As reported by the provider — see `TokenRate.inputIncludesCached`. */
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedReadTokens?: number;
  readonly cacheWriteTokens?: number;
};

function finite(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

/** Converts a provider-reported USD amount into micro-USD. */
export function microUsdFromUsd(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round(usd * MICRO_USD_PER_USD);
}

/**
 * Prices token usage from our own rate table.
 *
 * Returns `UNPRICED` for an unknown model rather than falling back to a
 * "similar" rate — a silently mispriced ledger cannot be distinguished from a
 * correct one after the fact, whereas an unpriced row announces itself.
 */
export function priceTokenUsage(
  provider: string,
  model: string,
  usage: TokenUsageForPricing,
): PricedCost {
  const key = tokenRateKey(provider, model);
  const rate = TOKEN_RATES[key];
  if (!rate) {
    warnUnpriced("tokens", key);
    return UNPRICED;
  }

  const cachedRead = finite(usage.cachedReadTokens);
  const cacheWrite = finite(usage.cacheWriteTokens);
  const reportedInput = finite(usage.inputTokens);
  // Never let a provider quirk produce a negative billable count.
  const uncachedInput = rate.inputIncludesCached
    ? Math.max(0, reportedInput - cachedRead - cacheWrite)
    : reportedInput;
  const promptTokens = uncachedInput + cachedRead + cacheWrite;
  const tier =
    rate.longContext && promptTokens > rate.longContext.aboveInputTokens
      ? rate.longContext.rate
      : rate;

  const costMicroUsd = Math.round(
    uncachedInput * tier.input +
      cachedRead * tier.cachedRead +
      cacheWrite * tier.cacheWrite +
      finite(usage.outputTokens) * tier.output,
  );

  return { costMicroUsd, priceVersion: PRICE_VERSION };
}

/**
 * Prices a duration-billed call. `key` is a `VOICE_RATES` key; `seconds` must
 * be the provider's **billed** duration, not a wall-clock measurement.
 */
export function priceVoiceUsage(key: string, seconds: number): PricedCost {
  const rate = VOICE_RATES[key];
  if (rate === undefined) {
    warnUnpriced("seconds", key);
    return UNPRICED;
  }
  return {
    costMicroUsd: Math.round(finite(seconds) * rate),
    priceVersion: PRICE_VERSION,
  };
}

/** Prices a character-billed call. `key` is a `CHARACTER_RATES` key. */
export function priceCharacterUsage(key: string, characters: number): PricedCost {
  const rate = CHARACTER_RATES[key];
  if (rate === undefined) {
    warnUnpriced("characters", key);
    return UNPRICED;
  }
  return {
    costMicroUsd: Math.round(finite(characters) * rate),
    priceVersion: PRICE_VERSION,
  };
}

/** Test seam — the per-isolate warning dedupe would otherwise leak between tests. */
export function resetUnpricedWarnings(): void {
  warnedKeys.clear();
}

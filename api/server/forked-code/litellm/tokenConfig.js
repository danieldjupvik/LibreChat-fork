const { logger } = require('@librechat/data-schemas');
const { EModelEndpoint } = require('librechat-data-provider');
const { getLiteLLMPricingSnapshot } = require('./modelInfoCache');

/** The only custom endpoint this bridge touches, matched case-insensitively. */
const LITELLM_ENDPOINT_NAME = 'litellm';
const PER_MILLION = 1_000_000;
const MAX_LOGGED_CONFLICTS = 5;
const CACHE_RATE_KEYS = ['cacheRead', 'cacheWrite'];

let cachedSnapshot = null;
let cachedDynamicPricing = null;

const isValidRate = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * LiteLLM prices per token; LibreChat's `tokenConfig` prices per million.
 * An explicit `0` is a real (free) rate; anything missing, non-numeric, NaN,
 * infinite, or negative is absent — never coerced to zero.
 * @returns {number | null}
 */
const toRatePerMillion = (value, priceMultiplier) => {
  if (!isValidRate(value)) {
    return null;
  }
  return value * priceMultiplier * PER_MILLION;
};

/** `max_input_tokens`, falling back to `max_tokens`. Must be positive. */
const toContext = (modelInfo) => {
  for (const candidate of [modelInfo.max_input_tokens, modelInfo.max_tokens]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return null;
};

/**
 * A LibreChat `tokenConfig` entry, or `null` when LiteLLM did not supply a
 * complete one (finite input + output prices and a positive context window).
 * Cache rates are optional and omitted when unavailable.
 */
const toTokenConfigEntry = (modelInfo, priceMultiplier) => {
  const prompt = toRatePerMillion(modelInfo.input_cost_per_token, priceMultiplier);
  const completion = toRatePerMillion(modelInfo.output_cost_per_token, priceMultiplier);
  const context = toContext(modelInfo);

  if (prompt == null || completion == null || context == null) {
    return null;
  }

  const entry = { prompt, completion, context };

  const cacheRead = toRatePerMillion(modelInfo.cache_read_input_token_cost, priceMultiplier);
  if (cacheRead != null) {
    entry.cacheRead = cacheRead;
  }
  const cacheWrite = toRatePerMillion(modelInfo.cache_creation_input_token_cost, priceMultiplier);
  if (cacheWrite != null) {
    entry.cacheWrite = cacheWrite;
  }

  return entry;
};

const isSameEntry = (a, b) =>
  a.prompt === b.prompt &&
  a.completion === b.completion &&
  a.context === b.context &&
  a.cacheRead === b.cacheRead &&
  a.cacheWrite === b.cacheWrite;

const isSamePricedEntry = (a, b) =>
  a.priceMultiplier === b.priceMultiplier && isSameEntry(a.tokenConfigEntry, b.tokenConfigEntry);

/**
 * Collects `key -> priced entry`, dropping any key whose duplicates disagree
 * so the static fallback stays in charge rather than silently last-write-wins.
 *
 * A conflicted key is remembered for the whole pass: deleting it from the map
 * alone would let a third occurrence look unseen and re-insert itself, quietly
 * reviving one of the disputed rates.
 */
const collectByKey = (pairs) => {
  const byModel = new Map();
  const conflicted = new Set();

  for (const [key, pricedEntry] of pairs) {
    if (conflicted.has(key)) {
      continue;
    }
    const existing = byModel.get(key);
    if (existing == null) {
      byModel.set(key, pricedEntry);
      continue;
    }
    if (!isSamePricedEntry(existing, pricedEntry)) {
      byModel.delete(key);
      conflicted.add(key);
    }
  }

  return { entries: Object.fromEntries(byModel), conflicts: [...conflicted] };
};

/**
 * Builds dynamic entries with the multiplier needed to adjust static cache
 * fallbacks. Public `model_name` aliases are preserved verbatim and win; the
 * underlying `litellm_params.model` is also keyed so a provider that reports
 * the real model instead of the alias still resolves. No fuzzy or substring
 * matching.
 */
const buildDynamicPricing = ({ entries, providerDiscounts, globalMargin }) => {
  const aliasPairs = [];
  const underlyingPairs = [];

  for (const { modelName, litellmModel, provider, modelInfo } of entries) {
    const discount =
      provider != null && Object.hasOwn(providerDiscounts, provider)
        ? providerDiscounts[provider]
        : 0;
    const priceMultiplier = (1 - discount) * (1 + globalMargin);
    const tokenConfigEntry = toTokenConfigEntry(modelInfo, priceMultiplier);
    if (tokenConfigEntry == null) {
      continue;
    }
    const pricedEntry = { tokenConfigEntry, priceMultiplier };
    if (modelName) {
      aliasPairs.push([modelName, pricedEntry]);
    }
    if (litellmModel) {
      underlyingPairs.push([litellmModel, pricedEntry]);
    }
  }

  const alias = collectByKey(aliasPairs);
  const underlying = collectByKey(underlyingPairs);

  const aliasConflicts = new Set(alias.conflicts);
  const conflicts = [...new Set([...aliasConflicts, ...underlying.conflicts])];
  if (conflicts.length > 0) {
    logger.warn('[LiteLLMTokenConfig] Conflicting duplicate model rates; keeping static fallback', {
      count: conflicts.length,
      models: conflicts.slice(0, MAX_LOGGED_CONFLICTS),
    });
  }

  const safeUnderlyingEntries = Object.fromEntries(
    Object.entries(underlying.entries).filter(([key]) => !aliasConflicts.has(key)),
  );

  return { ...safeUnderlyingEntries, ...alias.entries };
};

const getDynamicPricing = (snapshot) => {
  if (snapshot === cachedSnapshot && cachedDynamicPricing != null) {
    return cachedDynamicPricing;
  }

  const dynamicPricing = buildDynamicPricing(snapshot);
  cachedSnapshot = snapshot;
  cachedDynamicPricing = dynamicPricing;
  return dynamicPricing;
};

const findLiteLLMEndpointIndex = (customEndpoints) =>
  customEndpoints.findIndex(
    (endpoint) =>
      typeof endpoint?.name === 'string' &&
      endpoint.name.trim().toLowerCase() === LITELLM_ENDPOINT_NAME,
  );

function mergeTokenConfig(staticTokenConfig = {}, dynamicPricing) {
  const mergedTokenConfig = { ...staticTokenConfig };
  for (const [model, { tokenConfigEntry, priceMultiplier }] of Object.entries(dynamicPricing)) {
    const adjustedStaticEntry = { ...(staticTokenConfig[model] ?? {}) };
    for (const field of CACHE_RATE_KEYS) {
      const staticRate = adjustedStaticEntry[field];
      if (!Object.hasOwn(tokenConfigEntry, field) && isValidRate(staticRate)) {
        adjustedStaticEntry[field] = staticRate * priceMultiplier;
      }
    }
    mergedTokenConfig[model] = { ...adjustedStaticEntry, ...tokenConfigEntry };
  }
  return mergedTokenConfig;
}

/**
 * Makes LiteLLM model info, provider discounts, and the global margin the runtime
 * source of the flat prices and context limits LibreChat's native context-cost
 * pipeline reads. Provider discounts apply before the global percentage margin;
 * context limits remain unchanged.
 *
 * Returns a request-scoped config: the shared cached object is never mutated, and
 * only the levels that change (root, `endpoints`, `endpoints.custom`, the LiteLLM
 * endpoint, its `tokenConfig`) are cloned. Dynamic fields override matching static
 * fields while optional static cache rates absent from LiteLLM receive the same
 * discount and margin multiplier. Models LiteLLM does not describe completely
 * keep their static entry. When LiteLLM is unavailable and nothing is cached,
 * the input config is returned untouched — never zero-cost entries, and never a
 * thrown error.
 *
 * Known limitation: LiteLLM's long-context / tiered, per-request, image, audio and
 * time-based pricing cannot be represented by LibreChat's flat `tokenConfig`; only
 * the flat input/output/cache rates are bridged.
 *
 * @param {import('@librechat/data-schemas').AppConfig} appConfig
 * @returns {Promise<import('@librechat/data-schemas').AppConfig>}
 */
async function applyLiteLLMTokenConfig(appConfig) {
  try {
    const customEndpoints = appConfig?.endpoints?.[EModelEndpoint.custom];
    if (!Array.isArray(customEndpoints)) {
      return appConfig;
    }

    const index = findLiteLLMEndpointIndex(customEndpoints);
    if (index === -1) {
      return appConfig;
    }

    const snapshot = await getLiteLLMPricingSnapshot();
    if (snapshot == null) {
      return appConfig;
    }

    const dynamicPricing = getDynamicPricing(snapshot);
    if (Object.keys(dynamicPricing).length === 0) {
      return appConfig;
    }

    const litellmEndpoint = customEndpoints[index];
    const nextCustomEndpoints = customEndpoints.slice();
    nextCustomEndpoints[index] = {
      ...litellmEndpoint,
      tokenConfig: mergeTokenConfig(litellmEndpoint.tokenConfig, dynamicPricing),
    };

    return {
      ...appConfig,
      endpoints: {
        ...appConfig.endpoints,
        [EModelEndpoint.custom]: nextCustomEndpoints,
      },
    };
  } catch (error) {
    logger.warn('[LiteLLMTokenConfig] Skipped dynamic pricing injection', {
      error: error?.message,
    });
    return appConfig;
  }
}

module.exports = {
  applyLiteLLMTokenConfig,
};

const { logger } = require('@librechat/data-schemas');
const { EModelEndpoint } = require('librechat-data-provider');
const { getLiteLLMModelEntries } = require('./modelInfoCache');

/** The only custom endpoint this bridge touches, matched case-insensitively. */
const LITELLM_ENDPOINT_NAME = 'litellm';
const PER_MILLION = 1_000_000;
const MAX_LOGGED_CONFLICTS = 5;

let cachedEntries = null;
let cachedDynamicTokenConfig = null;

/**
 * LiteLLM prices per token; LibreChat's `tokenConfig` prices per million.
 * An explicit `0` is a real (free) rate; anything missing, non-numeric, NaN,
 * infinite, or negative is absent — never coerced to zero.
 * @returns {number | null}
 */
const toRatePerMillion = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value * PER_MILLION;
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
const toTokenConfigEntry = (modelInfo) => {
  const prompt = toRatePerMillion(modelInfo.input_cost_per_token);
  const completion = toRatePerMillion(modelInfo.output_cost_per_token);
  const context = toContext(modelInfo);

  if (prompt == null || completion == null || context == null) {
    return null;
  }

  const entry = { prompt, completion, context };

  const cacheRead = toRatePerMillion(modelInfo.cache_read_input_token_cost);
  if (cacheRead != null) {
    entry.cacheRead = cacheRead;
  }
  const cacheWrite = toRatePerMillion(modelInfo.cache_creation_input_token_cost);
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

/**
 * Collects `key -> entry`, dropping any key whose duplicates disagree so the
 * static fallback stays in charge for it rather than silently last-write-wins.
 *
 * A conflicted key is remembered for the whole pass: deleting it from the map
 * alone would let a third occurrence look unseen and re-insert itself, quietly
 * reviving one of the disputed rates.
 */
const collectByKey = (pairs) => {
  const byModel = new Map();
  const conflicted = new Set();

  for (const [key, entry] of pairs) {
    if (conflicted.has(key)) {
      continue;
    }
    const existing = byModel.get(key);
    if (existing == null) {
      byModel.set(key, entry);
      continue;
    }
    if (!isSameEntry(existing, entry)) {
      byModel.delete(key);
      conflicted.add(key);
    }
  }

  return { entries: Object.fromEntries(byModel), conflicts: [...conflicted] };
};

/**
 * Builds the dynamic `tokenConfig` fragment. Public `model_name` aliases are
 * preserved verbatim and win; the underlying `litellm_params.model` is also
 * keyed so a provider that reports the real model instead of the alias still
 * resolves. No fuzzy or substring matching.
 */
const buildDynamicTokenConfig = (entries) => {
  const aliasPairs = [];
  const underlyingPairs = [];

  for (const { modelName, litellmModel, modelInfo } of entries) {
    const entry = toTokenConfigEntry(modelInfo);
    if (entry == null) {
      continue;
    }
    if (modelName) {
      aliasPairs.push([modelName, entry]);
    }
    if (litellmModel) {
      underlyingPairs.push([litellmModel, entry]);
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

const getDynamicTokenConfig = (entries) => {
  if (entries === cachedEntries && cachedDynamicTokenConfig != null) {
    return cachedDynamicTokenConfig;
  }

  const dynamicTokenConfig = buildDynamicTokenConfig(entries);
  cachedEntries = entries;
  cachedDynamicTokenConfig = dynamicTokenConfig;
  return dynamicTokenConfig;
};

const findLiteLLMEndpointIndex = (customEndpoints) =>
  customEndpoints.findIndex(
    (endpoint) =>
      typeof endpoint?.name === 'string' &&
      endpoint.name.trim().toLowerCase() === LITELLM_ENDPOINT_NAME,
  );

function mergeTokenConfig(staticTokenConfig = {}, dynamicTokenConfig) {
  const mergedTokenConfig = { ...staticTokenConfig };
  for (const [model, dynamicEntry] of Object.entries(dynamicTokenConfig)) {
    mergedTokenConfig[model] = { ...(staticTokenConfig[model] ?? {}), ...dynamicEntry };
  }
  return mergedTokenConfig;
}

/**
 * Makes LiteLLM `/model/info` the runtime source of the flat prices and context
 * limits LibreChat's native context-cost pipeline reads — `/api/endpoints/token-config`
 * for the client gauge, and `endpointTokenConfig` for server-side cost calculation.
 * Both resolve from `req.config`, so this one call at the config middleware feeds both.
 *
 * Returns a request-scoped config: the shared cached object is never mutated, and
 * only the levels that change (root, `endpoints`, `endpoints.custom`, the LiteLLM
 * endpoint, its `tokenConfig`) are cloned. Dynamic fields override matching static
 * fields while optional static fields absent from LiteLLM are preserved. Models
 * LiteLLM does not describe completely keep their static entry. When LiteLLM is
 * unavailable and nothing is cached, the input config is returned untouched —
 * never zero-cost entries, and never a thrown error.
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

    const dynamicTokenConfig = getDynamicTokenConfig(await getLiteLLMModelEntries());
    if (Object.keys(dynamicTokenConfig).length === 0) {
      return appConfig;
    }

    const litellmEndpoint = customEndpoints[index];
    const nextCustomEndpoints = customEndpoints.slice();
    nextCustomEndpoints[index] = {
      ...litellmEndpoint,
      tokenConfig: mergeTokenConfig(litellmEndpoint.tokenConfig, dynamicTokenConfig),
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

const axios = require('axios');
const { logger } = require('@librechat/data-schemas');

const CACHE_DURATION_MS = 60 * 60 * 1000;
/** After a failure, stop calling LiteLLM for this long. Without it a cold-cache
 *  outage makes every request start another fetch, and an expired cache re-arms
 *  a background refresh on every request (the timestamp stays stale). */
const FAILURE_BACKOFF_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_BASE_URL = 'https://litellm.danieldjupvik.com';

/** Complete last-known-good pricing snapshot. */
let cache = null;
let cacheTimestamp = 0;
let lastFailureAt = 0;
let inflightPromise = null;

const inFailureBackoff = () => lastFailureAt > 0 && Date.now() - lastFailureAt < FAILURE_BACKOFF_MS;

/**
 * @typedef {object} LiteLLMModelEntry
 * @property {string} [modelName] Public alias clients request (`model_name`).
 * @property {string} [litellmModel] Underlying provider model (`litellm_params.model`).
 * @property {string} [provider] Provider LiteLLM uses for cost adjustments.
 * @property {object} modelInfo Merged `model_info` — explicit admin config already
 *   overrides LiteLLM's built-in model-cost map in the upstream response.
 */

const asString = (value) => (typeof value === 'string' ? value : undefined);
const isObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);
const areCostAdjustmentsEnabled = () =>
  process.env.LITELLM_COST_MARGIN_ENABLED?.trim().toLowerCase() === 'true';

/** @returns {LiteLLMModelEntry[]} */
const toModelEntries = (payload) => {
  if (!isObject(payload) || !Array.isArray(payload.data)) {
    throw new Error('Invalid model info response');
  }

  const models = payload.data;
  const entries = [];

  for (const modelData of models) {
    const modelInfo = modelData?.model_info;
    if (!isObject(modelInfo)) {
      continue;
    }
    entries.push({
      modelName: asString(modelData.model_name),
      litellmModel: asString(modelData.litellm_params?.model),
      provider:
        asString(modelData.litellm_params?.custom_llm_provider) ??
        asString(modelInfo.litellm_provider),
      modelInfo,
    });
  }

  return entries;
};

const toGlobalMargin = (payload) => {
  const values = payload?.values;
  if (!isObject(values)) {
    throw new Error('Invalid cost margin response');
  }

  if (Object.keys(values).some((provider) => provider !== 'global')) {
    throw new Error('Provider-specific cost margins cannot be represented by tokenConfig');
  }

  if (!Object.hasOwn(values, 'global')) {
    throw new Error('Empty cost margin response is ambiguous');
  }

  const globalMargin = values.global;
  const hasPercentage = isObject(globalMargin) && Object.hasOwn(globalMargin, 'percentage');
  const hasFixedAmount = isObject(globalMargin) && Object.hasOwn(globalMargin, 'fixed_amount');
  if (isObject(globalMargin) && !hasPercentage && !hasFixedAmount) {
    throw new Error('Invalid global cost margin');
  }

  if (hasFixedAmount) {
    const fixedAmount = globalMargin.fixed_amount;
    if (typeof fixedAmount !== 'number' || !Number.isFinite(fixedAmount) || fixedAmount < 0) {
      throw new Error('Invalid fixed cost margin');
    }
    if (fixedAmount > 0) {
      throw new Error('Fixed cost margins cannot be represented by tokenConfig');
    }
  }

  if (isObject(globalMargin) && !hasPercentage) {
    return 0;
  }

  const percentage = isObject(globalMargin) ? globalMargin.percentage : globalMargin;
  if (typeof percentage !== 'number' || !Number.isFinite(percentage) || percentage < 0) {
    throw new Error('Invalid global cost margin percentage');
  }

  return percentage;
};

const toProviderDiscounts = (payload) => {
  const values = payload?.values;
  if (!isObject(values)) {
    throw new Error('Invalid cost discount response');
  }

  for (const [provider, discount] of Object.entries(values)) {
    if (
      typeof discount !== 'number' ||
      !Number.isFinite(discount) ||
      discount < 0 ||
      discount > 1
    ) {
      throw new Error(`Invalid cost discount for provider ${provider}`);
    }
  }

  return { ...values };
};

const hasActiveProviderDiscounts = (discounts) =>
  Object.values(discounts).some((discount) => discount > 0);

async function fetchLiteLLMPricingSnapshot() {
  const apiKey = process.env.LITELLM_API_KEY;
  if (!apiKey) {
    return null;
  }

  const baseURL = process.env.LITELLM_BASE_URL || DEFAULT_BASE_URL;
  const requestConfig = {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: REQUEST_TIMEOUT_MS,
  };
  const modelInfoRequest = axios.get(`${baseURL}/model/info`, requestConfig);
  if (!areCostAdjustmentsEnabled()) {
    const modelInfoResponse = await modelInfoRequest;
    return {
      entries: toModelEntries(modelInfoResponse.data),
      providerDiscounts: {},
      globalMargin: 0,
    };
  }

  const [modelInfoResponse, discountResponse, marginResponse] = await Promise.all([
    modelInfoRequest,
    axios.get(`${baseURL}/config/cost_discount_config`, requestConfig),
    axios.get(`${baseURL}/config/cost_margin_config`, requestConfig),
  ]);
  const entries = toModelEntries(modelInfoResponse.data);
  const providerDiscounts = toProviderDiscounts(discountResponse.data);
  const globalMargin = toGlobalMargin(marginResponse.data);
  if (
    Object.keys(providerDiscounts).length === 0 &&
    hasActiveProviderDiscounts(cache?.providerDiscounts ?? {})
  ) {
    throw new Error('Empty cost discount response is ambiguous while discounts are cached');
  }
  if (
    hasActiveProviderDiscounts(providerDiscounts) &&
    entries.some((entry) => entry.provider == null)
  ) {
    throw new Error('Model provider is required when cost discounts are configured');
  }

  return {
    entries,
    providerDiscounts,
    globalMargin,
  };
}

function refresh() {
  if (inflightPromise) {
    return inflightPromise;
  }

  inflightPromise = fetchLiteLLMPricingSnapshot()
    .then((snapshot) => {
      if (snapshot == null) {
        return cache;
      }
      cache = snapshot;
      cacheTimestamp = Date.now();
      lastFailureAt = 0;
      return snapshot;
    })
    .catch((error) => {
      lastFailureAt = Date.now();
      /** Never log the payload or credentials — only the failure reason. */
      logger.warn('[LiteLLMModelInfoCache] Failed to refresh pricing snapshot', {
        error: error?.message,
      });
      return cache;
    })
    .finally(() => {
      inflightPromise = null;
    });

  return inflightPromise;
}

function warmLiteLLMModelCache() {
  if (cache != null || inFailureBackoff()) {
    return Promise.resolve(cache);
  }
  return refresh();
}

/**
 * Atomic LiteLLM model-info, provider-discount, and global-margin snapshot,
 * cached for an hour.
 *
 * Stale-while-revalidate: cached entries are returned immediately while expired
 * data refreshes in the background. A cold cache also starts a background fetch
 * and returns `null`, so request handling never waits on LiteLLM.
 *
 * A failure suppresses further calls for {@link FAILURE_BACKOFF_MS}: during an
 * outage a cold cache returns `null` without starting another fetch, and a stale
 * cache keeps serving last-known-good without re-arming a refresh on every
 * request. That also bounds the failure logging to one entry per backoff window.
 *
 * @returns {Promise<{entries: LiteLLMModelEntry[], providerDiscounts: object, globalMargin: number} | null>}
 */
async function getLiteLLMPricingSnapshot() {
  if (cache == null) {
    void warmLiteLLMModelCache();
    return null;
  }

  if (Date.now() - cacheTimestamp >= CACHE_DURATION_MS && !inFailureBackoff()) {
    refresh().catch(() => undefined);
  }

  return cache;
}

/** Test seam — drops the in-memory cache. */
function resetLiteLLMModelCache() {
  cache = null;
  cacheTimestamp = 0;
  lastFailureAt = 0;
  inflightPromise = null;
}

module.exports = {
  getLiteLLMPricingSnapshot,
  warmLiteLLMModelCache,
  resetLiteLLMModelCache,
};

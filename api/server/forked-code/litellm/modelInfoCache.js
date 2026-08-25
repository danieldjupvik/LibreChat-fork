const axios = require('axios');
const { logger } = require('@librechat/data-schemas');

const CACHE_DURATION_MS = 60 * 60 * 1000;
/** After a failure, stop calling LiteLLM for this long. Without it a cold-cache
 *  outage makes every request start another fetch, and an expired cache re-arms
 *  a background refresh on every request (the timestamp stays stale). */
const FAILURE_BACKOFF_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_BASE_URL = 'https://litellm.danieldjupvik.com';

/** Last-known-good entries. Survives a failed refresh so callers keep pricing. */
let cache = null;
let cacheTimestamp = 0;
let lastFailureAt = 0;
let inflightPromise = null;

const inFailureBackoff = () => lastFailureAt > 0 && Date.now() - lastFailureAt < FAILURE_BACKOFF_MS;

/**
 * @typedef {object} LiteLLMModelEntry
 * @property {string} [modelName] Public alias clients request (`model_name`).
 * @property {string} [litellmModel] Underlying provider model (`litellm_params.model`).
 * @property {object} modelInfo Merged `model_info` — explicit admin config already
 *   overrides LiteLLM's built-in model-cost map in the upstream response.
 */

const asString = (value) => (typeof value === 'string' ? value : undefined);

/** @returns {LiteLLMModelEntry[]} */
const toModelEntries = (payload) => {
  const models = Array.isArray(payload?.data) ? payload.data : [];
  const entries = [];

  for (const modelData of models) {
    const modelInfo = modelData?.model_info;
    if (!modelInfo || typeof modelInfo !== 'object') {
      continue;
    }
    entries.push({
      modelName: asString(modelData.model_name),
      litellmModel: asString(modelData.litellm_params?.model),
      modelInfo,
    });
  }

  return entries;
};

async function fetchLiteLLMModelEntries() {
  const apiKey = process.env.LITELLM_API_KEY;
  if (!apiKey) {
    return [];
  }

  const baseURL = process.env.LITELLM_BASE_URL || DEFAULT_BASE_URL;
  const response = await axios.get(`${baseURL}/model/info`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: REQUEST_TIMEOUT_MS,
  });

  return toModelEntries(response.data);
}

function refresh() {
  if (inflightPromise) {
    return inflightPromise;
  }

  inflightPromise = fetchLiteLLMModelEntries()
    .then((entries) => {
      cache = entries;
      cacheTimestamp = Date.now();
      lastFailureAt = 0;
      return entries;
    })
    .catch((error) => {
      lastFailureAt = Date.now();
      /** Never log the payload or credentials — only the failure reason. */
      logger.warn('[LiteLLMModelInfoCache] Failed to fetch model info', {
        error: error?.message,
      });
      return cache ?? [];
    })
    .finally(() => {
      inflightPromise = null;
    });

  return inflightPromise;
}

function warmLiteLLMModelCache() {
  if (cache != null || inFailureBackoff()) {
    return Promise.resolve(cache ?? []);
  }
  return refresh();
}

/**
 * Normalized LiteLLM `/model/info` entries, cached for an hour.
 *
 * Stale-while-revalidate: cached entries are returned immediately while expired
 * data refreshes in the background. A cold cache also starts a background fetch
 * and returns `[]`, so request handling never waits on LiteLLM.
 *
 * A failure suppresses further calls for {@link FAILURE_BACKOFF_MS}: during an
 * outage a cold cache returns `[]` without starting another fetch, and a stale
 * cache keeps serving last-known-good without re-arming a refresh on every
 * request. That also bounds the failure logging to one entry per backoff window.
 *
 * @returns {Promise<LiteLLMModelEntry[]>}
 */
async function getLiteLLMModelEntries() {
  if (cache == null) {
    void warmLiteLLMModelCache();
    return [];
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
  getLiteLLMModelEntries,
  warmLiteLLMModelCache,
  resetLiteLLMModelCache,
};

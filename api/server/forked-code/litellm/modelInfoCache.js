const axios = require('axios');
const { logger } = require('@librechat/data-schemas');

const CACHE_DURATION_MS = 60 * 60 * 1000;

let cache = null;
let cacheTimestamp = 0;
let inflightPromise = null;

const toModelInfoMap = (payload) => {
  const modelInfoMap = {};
  const models = Array.isArray(payload?.data) ? payload.data : [];

  for (const modelData of models) {
    const modelName = modelData?.model_name;
    const modelInfo = modelData?.model_info;
    const litellmModel = modelData?.litellm_params?.model;

    if (modelName && modelInfo) {
      modelInfoMap[modelName] = modelInfo;
    }
    if (litellmModel && modelInfo) {
      modelInfoMap[litellmModel] = modelInfo;
    }
  }

  return modelInfoMap;
};

async function fetchLiteLLMModelInfoMap() {
  const apiKey = process.env.LITELLM_API_KEY;
  if (!apiKey) {
    return {};
  }

  const baseURL = process.env.LITELLM_BASE_URL || 'https://litellm.danieldjupvik.com';
  const response = await axios.get(`${baseURL}/model/info`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 5000,
  });

  return toModelInfoMap(response.data);
}

async function getLiteLLMModelInfoMap() {
  const now = Date.now();

  if (cache && now - cacheTimestamp < CACHE_DURATION_MS) {
    return cache;
  }

  if (inflightPromise) {
    return inflightPromise;
  }

  inflightPromise = fetchLiteLLMModelInfoMap()
    .then((data) => {
      cache = data;
      cacheTimestamp = Date.now();
      return data;
    })
    .catch((error) => {
      logger.warn('[LiteLLMModelInfoCache] Failed to fetch model info', {
        error: error?.message,
      });
      return cache ?? {};
    })
    .finally(() => {
      inflightPromise = null;
    });

  return inflightPromise;
}

module.exports = {
  getLiteLLMModelInfoMap,
};

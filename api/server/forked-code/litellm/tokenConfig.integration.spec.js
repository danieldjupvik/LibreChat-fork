jest.mock('axios');
jest.mock('~/server/services/Config', () => ({ getAppConfig: jest.fn() }));

const axios = require('axios');
const mongoose = require('mongoose');
const { createTxMethods } = require('@librechat/data-schemas');
const {
  initializeCustom,
  matchModelName,
  computeUsageCostUSD,
  findMatchingPattern,
  resolveTokenConfigMap,
} = require('@librechat/api');
const { getAppConfig } = require('~/server/services/Config');
const configMiddleware = require('~/server/middleware/config/app');
const { warmLiteLLMModelCache, resetLiteLLMModelCache } = require('./modelInfoCache');

const txMethods = createTxMethods(mongoose, { matchModelName, findMatchingPattern });
const { getValueKey, getMultiplier, getCacheMultiplier } = txMethods;

const baseAppConfig = () => ({
  interfaceConfig: { contextCost: true },
  endpoints: {
    custom: [
      {
        name: 'LiteLLM',
        apiKey: 'litellm-key',
        baseURL: 'https://litellm.example.com',
        models: { default: ['gpt-4.1'] },
      },
    ],
  },
});

const runMiddleware = async (req = { user: { id: 'u1' }, path: '/x' }) => {
  await warmLiteLLMModelCache();
  await new Promise((resolve, reject) => {
    configMiddleware(req, {}, (error) => (error ? reject(error) : resolve()));
  });
  return req.config;
};

/**
 * Proves the middleware seam feeds BOTH native consumers of `req.config`:
 * `/api/endpoints/token-config` (client gauge) and `initializeCustom`'s
 * `endpointTokenConfig` (server-side cost calculation).
 */
describe('LiteLLM token-config bridge (integration)', () => {
  const originalApiKey = process.env.LITELLM_API_KEY;
  const originalBaseURL = process.env.LITELLM_BASE_URL;
  const originalCostMarginEnabled = process.env.LITELLM_COST_MARGIN_ENABLED;

  beforeEach(() => {
    resetLiteLLMModelCache();
    process.env.LITELLM_API_KEY = 'test-key';
    process.env.LITELLM_BASE_URL = 'https://litellm.example.com';
    process.env.LITELLM_COST_MARGIN_ENABLED = 'true';
    axios.get.mockReset();
    axios.get.mockImplementation((url) => {
      if (url.endsWith('/config/cost_discount_config')) {
        return Promise.resolve({ data: { values: { azure: 0.1 } } });
      }
      if (url.endsWith('/config/cost_margin_config')) {
        return Promise.resolve({ data: { values: { global: 0.17 } } });
      }
      return Promise.resolve({
        data: {
          data: [
            {
              model_name: 'gpt-4.1',
              litellm_params: { model: 'azure/gpt-4.1' },
              model_info: {
                litellm_provider: 'azure',
                input_cost_per_token: 0.000002,
                output_cost_per_token: 0.000008,
                cache_read_input_token_cost: 0.0000005,
                cache_creation_input_token_cost: 0.0000025,
                max_input_tokens: 1047576,
              },
            },
          ],
        },
      });
    });
    getAppConfig.mockReset();
    getAppConfig.mockResolvedValue(baseAppConfig());
  });

  afterAll(() => {
    if (originalApiKey === undefined) {
      delete process.env.LITELLM_API_KEY;
    } else {
      process.env.LITELLM_API_KEY = originalApiKey;
    }
    if (originalBaseURL === undefined) {
      delete process.env.LITELLM_BASE_URL;
    } else {
      process.env.LITELLM_BASE_URL = originalBaseURL;
    }
    if (originalCostMarginEnabled === undefined) {
      delete process.env.LITELLM_COST_MARGIN_ENABLED;
    } else {
      process.env.LITELLM_COST_MARGIN_ENABLED = originalCostMarginEnabled;
    }
  });

  it('injects LiteLLM pricing into req.config on the normal config path', async () => {
    const config = await runMiddleware();

    const entry = config.endpoints.custom[0].tokenConfig['gpt-4.1'];
    expect(entry.prompt).toBeCloseTo(2.106, 12);
    expect(entry.completion).toBeCloseTo(8.424, 12);
    expect(entry.cacheRead).toBeCloseTo(0.5265, 12);
    expect(entry.cacheWrite).toBeCloseTo(2.6325, 12);
    expect(entry.context).toBe(1047576);
  });

  it('injects LiteLLM pricing on the fallback config path', async () => {
    getAppConfig.mockRejectedValueOnce(new Error('role resolution failed'));

    const config = await runMiddleware({ user: { id: 'u1', tenantId: 't1' }, path: '/x' });

    expect(getAppConfig).toHaveBeenCalledTimes(2);
    expect(config.endpoints.custom[0].tokenConfig['gpt-4.1'].prompt).toBeCloseTo(2.106, 12);
  });

  it('reaches the native /endpoints/token-config response', async () => {
    const config = await runMiddleware();

    const tokenConfigMap = await resolveTokenConfigMap(
      {
        appConfig: config,
        modelsConfig: { LiteLLM: ['gpt-4.1'] },
        userId: 'u1',
      },
      { getValueKey, getMultiplier, getCacheMultiplier },
    );

    const entry = tokenConfigMap.LiteLLM['gpt-4.1'];
    expect(entry.prompt).toBeCloseTo(2.106, 12);
    expect(entry.completion).toBeCloseTo(8.424, 12);
    expect(entry.cacheRead).toBeCloseTo(0.5265, 12);
    expect(entry.cacheWrite).toBeCloseTo(2.6325, 12);
    expect(entry.context).toBe(1047576);
  });

  it('reaches endpointTokenConfig and native server-side cost calculation', async () => {
    const config = await runMiddleware();

    const options = await initializeCustom({
      req: { config, body: {}, user: { id: 'u1' } },
      endpoint: 'LiteLLM',
      model_parameters: { model: 'gpt-4.1' },
      db: { getUserKeyValues: async () => ({}) },
    });

    const entry = options.endpointTokenConfig['gpt-4.1'];
    expect(entry.prompt).toBeCloseTo(2.106, 12);
    expect(entry.completion).toBeCloseTo(8.424, 12);
    expect(entry.read).toBeCloseTo(0.5265, 12);
    expect(entry.write).toBeCloseTo(2.6325, 12);

    const cost = computeUsageCostUSD(
      { model: 'gpt-4.1', input_tokens: 1_000_000, output_tokens: 1_000_000 },
      { getMultiplier, getCacheMultiplier },
      options.endpointTokenConfig,
    );

    expect(cost).toBeCloseTo(10.53, 6);
  });

  it('falls back to the static config when LiteLLM is unreachable', async () => {
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const staticConfig = baseAppConfig();
    staticConfig.endpoints.custom[0].tokenConfig = {
      'gpt-4.1': { prompt: 5, completion: 20, context: 128000 },
    };
    getAppConfig.mockResolvedValue(staticConfig);

    const config = await runMiddleware();

    const tokenConfigMap = await resolveTokenConfigMap(
      { appConfig: config, modelsConfig: { LiteLLM: ['gpt-4.1'] }, userId: 'u1' },
      { getValueKey, getMultiplier, getCacheMultiplier },
    );

    expect(tokenConfigMap.LiteLLM['gpt-4.1']).toMatchObject({
      prompt: 5,
      completion: 20,
      context: 128000,
    });
  });
});

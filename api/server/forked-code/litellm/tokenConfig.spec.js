jest.mock('axios');

const axios = require('axios');
const { logger } = require('@librechat/data-schemas');
const { applyLiteLLMTokenConfig } = require('./tokenConfig');
const { warmLiteLLMModelCache, resetLiteLLMModelCache } = require('./modelInfoCache');

const modelEntry = (modelName, modelInfo, litellmModel) => ({
  model_name: modelName,
  ...(litellmModel ? { litellm_params: { model: litellmModel } } : {}),
  model_info: modelInfo,
});

/** A complete LiteLLM `model_info`: $3/1M in, $15/1M out, 200k context. */
const completeInfo = (overrides = {}) => ({
  input_cost_per_token: 0.000003,
  output_cost_per_token: 0.000015,
  max_input_tokens: 200000,
  ...overrides,
});

const respondWith = (models, marginValues = { global: 0 }, discountValues = {}) => {
  axios.get.mockImplementation((url) => {
    if (url.endsWith('/model/info')) {
      return Promise.resolve({ data: { data: models } });
    }
    if (url.endsWith('/config/cost_discount_config')) {
      return Promise.resolve({ data: { values: discountValues } });
    }
    if (url.endsWith('/config/cost_margin_config')) {
      return Promise.resolve({ data: { values: marginValues } });
    }
    return Promise.reject(new Error(`Unexpected LiteLLM URL: ${url}`));
  });
};

const resolverKeyFor = (url) => {
  if (url.endsWith('/model/info')) {
    return 'models';
  }
  if (url.endsWith('/config/cost_discount_config')) {
    return 'discounts';
  }
  return 'margin';
};

const appConfigWith = (customEndpoints) => ({
  interfaceConfig: { contextCost: true },
  endpoints: { custom: customEndpoints },
});

const litellmTokenConfig = (config) =>
  config.endpoints.custom.find((endpoint) => endpoint.name === 'LiteLLM')?.tokenConfig;

/** Runs the bridge over a config holding only the LiteLLM endpoint. */
const runBridge = async (litellmEndpoint = { name: 'LiteLLM' }) => {
  await warmLiteLLMModelCache();
  return applyLiteLLMTokenConfig(appConfigWith([litellmEndpoint]));
};

/** The resulting LiteLLM `tokenConfig` — what nearly every case asserts on. */
const tokenConfigFor = async (litellmEndpoint) =>
  litellmTokenConfig(await runBridge(litellmEndpoint));

describe('applyLiteLLMTokenConfig', () => {
  const originalApiKey = process.env.LITELLM_API_KEY;
  const originalCostMarginEnabled = process.env.LITELLM_COST_MARGIN_ENABLED;

  beforeEach(() => {
    resetLiteLLMModelCache();
    process.env.LITELLM_API_KEY = 'test-key';
    process.env.LITELLM_COST_MARGIN_ENABLED = 'true';
    axios.get.mockReset();
  });

  afterAll(() => {
    if (originalApiKey === undefined) {
      delete process.env.LITELLM_API_KEY;
    } else {
      process.env.LITELLM_API_KEY = originalApiKey;
    }
    if (originalCostMarginEnabled === undefined) {
      delete process.env.LITELLM_COST_MARGIN_ENABLED;
    } else {
      process.env.LITELLM_COST_MARGIN_ENABLED = originalCostMarginEnabled;
    }
  });

  it('converts per-token prices to per-million rates under the public alias', async () => {
    respondWith([modelEntry('claude-sonnet-4', completeInfo())]);

    const result = await runBridge();

    expect(litellmTokenConfig(result)).toEqual({
      'claude-sonnet-4': { prompt: 3, completion: 15, context: 200000 },
    });
  });

  it('also keys the underlying litellm_params.model', async () => {
    respondWith([
      modelEntry('claude-sonnet-4', completeInfo(), 'anthropic/claude-sonnet-4-20250514'),
    ]);

    const tokenConfig = await tokenConfigFor();

    expect(tokenConfig['claude-sonnet-4']).toEqual({ prompt: 3, completion: 15, context: 200000 });
    expect(tokenConfig['anthropic/claude-sonnet-4-20250514']).toEqual({
      prompt: 3,
      completion: 15,
      context: 200000,
    });
  });

  it('lets the public alias win when it collides with another model’s underlying name', async () => {
    respondWith([
      modelEntry('gpt-4.1', completeInfo({ input_cost_per_token: 0.000002 }), 'azure/gpt-4.1'),
      modelEntry('azure/gpt-4.1', completeInfo({ input_cost_per_token: 0.000009 })),
    ]);

    const tokenConfig = await tokenConfigFor();

    expect(tokenConfig['azure/gpt-4.1'].prompt).toBe(9);
  });

  it('carries optional cache-read and cache-write rates', async () => {
    respondWith([
      modelEntry(
        'claude-sonnet-4',
        completeInfo({
          cache_read_input_token_cost: 0.0000003,
          cache_creation_input_token_cost: 0.00000375,
        }),
      ),
    ]);

    expect((await tokenConfigFor())['claude-sonnet-4']).toEqual({
      prompt: 3,
      completion: 15,
      context: 200000,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    });
  });

  it('requests one authenticated pricing triplet with the same timeout', async () => {
    respondWith([modelEntry('gpt-4.1', completeInfo())], { global: 0.17 });

    await runBridge();

    expect(axios.get).toHaveBeenCalledTimes(3);
    expect(axios.get.mock.calls.map(([url]) => url)).toEqual([
      'https://litellm.danieldjupvik.com/model/info',
      'https://litellm.danieldjupvik.com/config/cost_discount_config',
      'https://litellm.danieldjupvik.com/config/cost_margin_config',
    ]);
    const [, modelRequest] = axios.get.mock.calls[0];
    const [, discountRequest] = axios.get.mock.calls[1];
    const [, marginRequest] = axios.get.mock.calls[2];
    expect(modelRequest).toBe(discountRequest);
    expect(modelRequest).toBe(marginRequest);
    expect(modelRequest).toEqual({
      headers: {
        Authorization: 'Bearer test-key',
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    });
  });

  it.each([
    ['unset', undefined],
    ['false', ' FALSE '],
  ])(
    'uses base prices and skips the cost settings endpoints when the feature is %s',
    async (_label, value) => {
      if (value === undefined) {
        delete process.env.LITELLM_COST_MARGIN_ENABLED;
      } else {
        process.env.LITELLM_COST_MARGIN_ENABLED = value;
      }
      respondWith([modelEntry('gpt-4.1', completeInfo())], { global: 0.17 });

      expect((await tokenConfigFor())['gpt-4.1']).toEqual({
        prompt: 3,
        completion: 15,
        context: 200000,
      });
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(axios.get).toHaveBeenCalledWith(
        'https://litellm.danieldjupvik.com/model/info',
        expect.objectContaining({ timeout: 5000 }),
      );
    },
  );

  it('applies the global percentage to every price but not the context limit', async () => {
    respondWith(
      [
        modelEntry(
          'claude-sonnet-4',
          completeInfo({
            cache_read_input_token_cost: 0.0000003,
            cache_creation_input_token_cost: 0.00000375,
          }),
        ),
      ],
      { global: 0.17 },
    );

    const entry = (await tokenConfigFor())['claude-sonnet-4'];

    expect(entry.prompt).toBeCloseTo(3.51, 12);
    expect(entry.completion).toBeCloseTo(17.55, 12);
    expect(entry.cacheRead).toBeCloseTo(0.351, 12);
    expect(entry.cacheWrite).toBeCloseTo(4.3875, 12);
    expect(entry.context).toBe(200000);
  });

  it('applies the provider discount before the global margin', async () => {
    respondWith(
      [
        modelEntry(
          'gpt-4.1',
          completeInfo({
            litellm_provider: 'openai',
            cache_read_input_token_cost: 0.0000003,
            cache_creation_input_token_cost: 0.00000375,
          }),
        ),
      ],
      { global: 0.17 },
      { openai: 0.1 },
    );

    const entry = (await tokenConfigFor())['gpt-4.1'];

    expect(entry.prompt).toBeCloseTo(3.159, 12);
    expect(entry.completion).toBeCloseTo(15.795, 12);
    expect(entry.cacheRead).toBeCloseTo(0.3159, 12);
    expect(entry.cacheWrite).toBeCloseTo(3.94875, 12);
    expect(entry.context).toBe(200000);
  });

  it('does not apply a discount configured for another provider', async () => {
    respondWith(
      [modelEntry('gpt-4.1', completeInfo({ litellm_provider: 'openai' }))],
      { global: 0.17 },
      { anthropic: 0.1 },
    );

    expect((await tokenConfigFor())['gpt-4.1'].prompt).toBeCloseTo(3.51, 12);
  });

  it('keeps the static fallback when an active discount lacks model provider data', async () => {
    respondWith([modelEntry('gpt-4.1', completeInfo())], { global: 0.17 }, { openai: 0.1 });
    const appConfig = appConfigWith([
      { name: 'LiteLLM', tokenConfig: { 'gpt-4.1': { prompt: 5, completion: 10, context: 8000 } } },
    ]);

    await warmLiteLLMModelCache();

    expect(await applyLiteLLMTokenConfig(appConfig)).toBe(appConfig);
  });

  it.each([
    ['non-numeric', '0.1'],
    ['NaN', NaN],
    ['infinite', Infinity],
    ['negative', -0.1],
    ['over 100%', 1.1],
  ])('keeps the static fallback when a provider discount is %s', async (_label, discount) => {
    respondWith(
      [modelEntry('gpt-4.1', completeInfo({ litellm_provider: 'openai' }))],
      { global: 0.17 },
      { openai: discount },
    );
    const appConfig = appConfigWith([{ name: 'LiteLLM' }]);

    await warmLiteLLMModelCache();

    expect(await applyLiteLLMTokenConfig(appConfig)).toBe(appConfig);
  });

  it('accepts the global percentage object form', async () => {
    respondWith([modelEntry('gpt-4.1', completeInfo())], {
      global: { percentage: 0.17 },
    });

    expect((await tokenConfigFor())['gpt-4.1'].prompt).toBeCloseTo(3.51, 12);
  });

  it('keeps the static fallback when a cold margin response is empty', async () => {
    respondWith([modelEntry('gpt-4.1', completeInfo())], {});
    const appConfig = appConfigWith([
      { name: 'LiteLLM', tokenConfig: { 'gpt-4.1': { prompt: 5, completion: 10, context: 8000 } } },
    ]);

    await warmLiteLLMModelCache();

    const result = await applyLiteLLMTokenConfig(appConfig);

    expect(result).toBe(appConfig);
    expect(litellmTokenConfig(result)['gpt-4.1']).toEqual({
      prompt: 5,
      completion: 10,
      context: 8000,
    });
  });

  it('accepts a zero-only fixed margin as zero margin', async () => {
    respondWith([modelEntry('gpt-4.1', completeInfo())], {
      global: { fixed_amount: 0 },
    });

    expect((await tokenConfigFor())['gpt-4.1']).toEqual({
      prompt: 3,
      completion: 15,
      context: 200000,
    });
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['non-numeric', '0.17'],
    ['NaN', NaN],
    ['infinite', Infinity],
    ['negative', -0.17],
    ['empty object', {}],
    ['malformed object', { percentage: '0.17' }],
  ])('does not inject base prices when the global margin is %s', async (_label, margin) => {
    respondWith([modelEntry('gpt-4.1', completeInfo())], { global: margin });
    const appConfig = appConfigWith([{ name: 'LiteLLM' }]);

    await warmLiteLLMModelCache();

    expect(await applyLiteLLMTokenConfig(appConfig)).toBe(appConfig);
  });

  it('does not inject token prices for a positive fixed margin', async () => {
    respondWith([modelEntry('gpt-4.1', completeInfo())], {
      global: { percentage: 0.17, fixed_amount: 0.001 },
    });
    const appConfig = appConfigWith([{ name: 'LiteLLM' }]);

    await warmLiteLLMModelCache();

    expect(await applyLiteLLMTokenConfig(appConfig)).toBe(appConfig);
  });

  it('does not inject token prices when a provider-specific margin overrides global', async () => {
    respondWith([modelEntry('gpt-4.1', completeInfo())], {
      global: 0.17,
      openai: 0.1,
    });
    const appConfig = appConfigWith([{ name: 'LiteLLM' }]);

    await warmLiteLLMModelCache();

    expect(await applyLiteLLMTokenConfig(appConfig)).toBe(appConfig);
  });

  it('omits cache rates that LiteLLM does not report', async () => {
    respondWith([
      modelEntry(
        'gpt-4.1',
        completeInfo({
          cache_read_input_token_cost: null,
          cache_creation_input_token_cost: undefined,
        }),
      ),
    ]);

    const entry = (await tokenConfigFor())['gpt-4.1'];

    expect(entry).not.toHaveProperty('cacheRead');
    expect(entry).not.toHaveProperty('cacheWrite');
  });

  it('prefers max_input_tokens over max_tokens', async () => {
    respondWith([
      modelEntry('gpt-4.1', completeInfo({ max_input_tokens: 1047576, max_tokens: 32768 })),
    ]);

    expect((await tokenConfigFor())['gpt-4.1'].context).toBe(1047576);
  });

  it('falls back to max_tokens when max_input_tokens is absent', async () => {
    respondWith([
      modelEntry('gpt-4.1', completeInfo({ max_input_tokens: null, max_tokens: 128000 })),
    ]);

    expect((await tokenConfigFor())['gpt-4.1'].context).toBe(128000);
  });

  it('treats an explicit zero price as a real free rate', async () => {
    respondWith(
      [
        modelEntry(
          'free-model',
          completeInfo({
            input_cost_per_token: 0,
            output_cost_per_token: 0,
            cache_read_input_token_cost: 0,
            cache_creation_input_token_cost: 0,
          }),
        ),
      ],
      { global: 0.17 },
    );

    expect((await tokenConfigFor())['free-model']).toEqual({
      prompt: 0,
      completion: 0,
      context: 200000,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['non-numeric', '0.000003'],
    ['NaN', NaN],
    ['infinite', Infinity],
    ['negative', -0.000003],
  ])('produces no entry when the input price is %s', async (_label, inputCost) => {
    respondWith([modelEntry('bad-model', completeInfo({ input_cost_per_token: inputCost }))]);

    const result = await runBridge();

    expect(litellmTokenConfig(result)).toBeUndefined();
  });

  it('produces no entry when the context window is missing or non-positive', async () => {
    respondWith([
      modelEntry('no-context', completeInfo({ max_input_tokens: undefined, max_tokens: 0 })),
    ]);

    expect(await tokenConfigFor()).toBeUndefined();
  });

  it('overrides a matching static tokenConfig entry', async () => {
    respondWith([modelEntry('gpt-4.1', completeInfo())]);

    const tokenConfig = await tokenConfigFor({
      name: 'LiteLLM',
      tokenConfig: { 'gpt-4.1': { prompt: 999, completion: 999, context: 1 } },
    });

    expect(tokenConfig['gpt-4.1']).toEqual({ prompt: 3, completion: 15, context: 200000 });
  });

  it('adjusts static cache rates when LiteLLM does not report them', async () => {
    respondWith(
      [modelEntry('gpt-4.1', completeInfo({ litellm_provider: 'openai' }))],
      { global: 0.17 },
      { openai: 0.1 },
    );

    const tokenConfig = await tokenConfigFor({
      name: 'LiteLLM',
      tokenConfig: {
        'gpt-4.1': {
          prompt: 999,
          completion: 999,
          context: 1,
          cacheRead: 0.5,
          cacheWrite: 3.75,
        },
      },
    });

    const entry = tokenConfig['gpt-4.1'];
    expect(entry.prompt).toBeCloseTo(3.159, 12);
    expect(entry.completion).toBeCloseTo(15.795, 12);
    expect(entry.cacheRead).toBeCloseTo(0.5265, 12);
    expect(entry.cacheWrite).toBeCloseTo(3.94875, 12);
    expect(entry.context).toBe(200000);
  });

  it('keeps static entries LiteLLM does not describe completely', async () => {
    respondWith([
      modelEntry('gpt-4.1', completeInfo()),
      modelEntry('legacy-model', completeInfo({ output_cost_per_token: null })),
    ]);

    const tokenConfig = await tokenConfigFor({
      name: 'LiteLLM',
      tokenConfig: {
        'gpt-4.1': { prompt: 999, completion: 999, context: 1 },
        'legacy-model': { prompt: 5, completion: 10, context: 8000 },
      },
    });

    expect(tokenConfig).toEqual({
      'gpt-4.1': { prompt: 3, completion: 15, context: 200000 },
      'legacy-model': { prompt: 5, completion: 10, context: 8000 },
    });
  });

  it('drops an alias whose duplicates disagree and warns once', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    respondWith([
      modelEntry('gpt-4.1', completeInfo()),
      modelEntry('gpt-4.1', completeInfo({ input_cost_per_token: 0.000009 })),
    ]);

    const tokenConfig = await tokenConfigFor({
      name: 'LiteLLM',
      tokenConfig: { 'gpt-4.1': { prompt: 5, completion: 10, context: 8000 } },
    });
    await tokenConfigFor({
      name: 'LiteLLM',
      tokenConfig: { 'gpt-4.1': { prompt: 5, completion: 10, context: 8000 } },
    });

    expect(tokenConfig['gpt-4.1']).toEqual({ prompt: 5, completion: 10, context: 8000 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Conflicting duplicate model rates'),
      expect.objectContaining({ count: 1, models: ['gpt-4.1'] }),
    );
    warn.mockRestore();
  });

  it('keeps the static fallback when a conflicted alias is also an underlying model', async () => {
    respondWith([
      modelEntry('shared', completeInfo({ input_cost_per_token: 0.000001 }), 'shared'),
      modelEntry('shared', completeInfo({ input_cost_per_token: 0.000009 }), 'provider/shared'),
    ]);

    const tokenConfig = await tokenConfigFor({
      name: 'LiteLLM',
      tokenConfig: { shared: { prompt: 5, completion: 10, context: 8000 } },
    });

    expect(tokenConfig.shared).toEqual({ prompt: 5, completion: 10, context: 8000 });
  });

  it('keeps an alias suppressed when a third duplicate follows a conflict', async () => {
    respondWith([
      modelEntry('gpt-4.1', completeInfo()),
      modelEntry('gpt-4.1', completeInfo({ input_cost_per_token: 0.000009 })),
      modelEntry('gpt-4.1', completeInfo({ input_cost_per_token: 0.000004 })),
    ]);

    const tokenConfig = await tokenConfigFor({
      name: 'LiteLLM',
      tokenConfig: { 'gpt-4.1': { prompt: 5, completion: 10, context: 8000 } },
    });

    expect(tokenConfig['gpt-4.1']).toEqual({ prompt: 5, completion: 10, context: 8000 });
  });

  it('keeps an alias whose duplicates agree', async () => {
    respondWith([modelEntry('gpt-4.1', completeInfo()), modelEntry('gpt-4.1', completeInfo())]);

    expect((await tokenConfigFor())['gpt-4.1']).toEqual({
      prompt: 3,
      completion: 15,
      context: 200000,
    });
  });

  it('leaves the config untouched when the LiteLLM request fails with nothing cached', async () => {
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const appConfig = appConfigWith([
      { name: 'LiteLLM', tokenConfig: { 'gpt-4.1': { prompt: 5, completion: 10, context: 8000 } } },
    ]);

    const result = await applyLiteLLMTokenConfig(appConfig);
    await warmLiteLLMModelCache();

    expect(result).toBe(appConfig);
    expect(litellmTokenConfig(result)['gpt-4.1']).toEqual({
      prompt: 5,
      completion: 10,
      context: 8000,
    });
  });

  it('returns static config without waiting for a cold LiteLLM request', async () => {
    const resolvers = {};
    axios.get.mockImplementation(
      (url) =>
        new Promise((resolve) => {
          resolvers[resolverKeyFor(url)] = resolve;
        }),
    );
    const appConfig = appConfigWith([
      { name: 'LiteLLM', tokenConfig: { 'gpt-4.1': { prompt: 5, completion: 10, context: 8000 } } },
    ]);

    const resultPromise = applyLiteLLMTokenConfig(appConfig);
    const outcome = await Promise.race([
      resultPromise.then((result) => ({ status: 'resolved', result })),
      new Promise((resolve) => setImmediate(() => resolve({ status: 'pending' }))),
    ]);

    resolvers.models({ data: { data: [modelEntry('gpt-4.1', completeInfo())] } });
    resolvers.discounts({ data: { values: {} } });
    resolvers.margin({ data: { values: { global: 0.17 } } });
    await warmLiteLLMModelCache();

    expect(outcome).toEqual({ status: 'resolved', result: appConfig });
  });

  it('shares one in-flight request triplet across concurrent cold calls', async () => {
    const resolvers = {};
    axios.get.mockImplementation(
      (url) =>
        new Promise((resolve) => {
          resolvers[resolverKeyFor(url)] = resolve;
        }),
    );
    const appConfig = appConfigWith([{ name: 'LiteLLM' }]);

    const [first, second] = await Promise.all([
      applyLiteLLMTokenConfig(appConfig),
      applyLiteLLMTokenConfig(appConfig),
    ]);

    expect(first).toBe(appConfig);
    expect(second).toBe(appConfig);
    expect(axios.get).toHaveBeenCalledTimes(3);

    resolvers.models({ data: { data: [modelEntry('gpt-4.1', completeInfo())] } });
    resolvers.discounts({ data: { values: {} } });
    resolvers.margin({ data: { values: { global: 0.17 } } });
    await warmLiteLLMModelCache();
  });

  it('keeps the marked-up last-known-good snapshot when a later margin fetch fails', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    respondWith([modelEntry('gpt-4.1', completeInfo())], { global: 0.17 });
    await runBridge();

    now.mockReturnValue(1_000 + 60 * 60 * 1000 + 1);
    axios.get.mockImplementation((url) => {
      if (url.endsWith('/model/info')) {
        return Promise.resolve({ data: { data: [modelEntry('gpt-4.1', completeInfo())] } });
      }
      return Promise.reject(new Error('margin unavailable'));
    });
    const staleTokenConfig = await tokenConfigFor();
    await new Promise((resolve) => setImmediate(resolve));
    const tokenConfig = await tokenConfigFor();

    expect(staleTokenConfig['gpt-4.1'].prompt).toBeCloseTo(3.51, 12);
    expect(tokenConfig['gpt-4.1'].prompt).toBeCloseTo(3.51, 12);
    expect(axios.get).toHaveBeenCalledTimes(6);
    now.mockRestore();
  });

  it('keeps a nonzero last-known-good margin when a later response is empty', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    respondWith([modelEntry('gpt-4.1', completeInfo())], { global: 0.17 });
    await runBridge();

    now.mockReturnValue(1_000 + 60 * 60 * 1000 + 1);
    respondWith([modelEntry('gpt-4.1', completeInfo())], {});
    const staleTokenConfig = await tokenConfigFor();
    await new Promise((resolve) => setImmediate(resolve));
    const tokenConfig = await tokenConfigFor();

    expect(staleTokenConfig['gpt-4.1'].prompt).toBeCloseTo(3.51, 12);
    expect(tokenConfig['gpt-4.1'].prompt).toBeCloseTo(3.51, 12);
    expect(axios.get).toHaveBeenCalledTimes(6);
    now.mockRestore();
  });

  it('keeps an active last-known-good discount when a later response is empty', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const models = [modelEntry('gpt-4.1', completeInfo({ litellm_provider: 'openai' }))];
    respondWith(models, { global: 0.17 }, { openai: 0.1 });
    await runBridge();

    now.mockReturnValue(1_000 + 60 * 60 * 1000 + 1);
    respondWith(models, { global: 0.17 }, {});
    const staleTokenConfig = await tokenConfigFor();
    await new Promise((resolve) => setImmediate(resolve));
    const tokenConfig = await tokenConfigFor();

    expect(staleTokenConfig['gpt-4.1'].prompt).toBeCloseTo(3.159, 12);
    expect(tokenConfig['gpt-4.1'].prompt).toBeCloseTo(3.159, 12);
    expect(axios.get).toHaveBeenCalledTimes(6);
    now.mockRestore();
  });

  it('clears an active discount when the provider is explicitly set to zero', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const models = [modelEntry('gpt-4.1', completeInfo({ litellm_provider: 'openai' }))];
    respondWith(models, { global: 0.17 }, { openai: 0.1 });
    await runBridge();

    now.mockReturnValue(1_000 + 60 * 60 * 1000 + 1);
    respondWith(models, { global: 0.17 }, { openai: 0 });
    const staleTokenConfig = await tokenConfigFor();
    await new Promise((resolve) => setImmediate(resolve));
    const tokenConfig = await tokenConfigFor();

    expect(staleTokenConfig['gpt-4.1'].prompt).toBeCloseTo(3.159, 12);
    expect(tokenConfig['gpt-4.1'].prompt).toBeCloseTo(3.51, 12);
    expect(axios.get).toHaveBeenCalledTimes(6);
    now.mockRestore();
  });

  it('does not cache a partial snapshot when only model info succeeds', async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith('/model/info')) {
        return Promise.resolve({ data: { data: [modelEntry('gpt-4.1', completeInfo())] } });
      }
      return Promise.reject(new Error('margin unavailable'));
    });
    const appConfig = appConfigWith([{ name: 'LiteLLM' }]);

    await warmLiteLLMModelCache();

    expect(await applyLiteLLMTokenConfig(appConfig)).toBe(appConfig);
  });

  it('fetches one LiteLLM request triplet across repeated calls', async () => {
    respondWith([modelEntry('gpt-4.1', completeInfo())]);

    await runBridge();
    await runBridge();

    expect(axios.get).toHaveBeenCalledTimes(3);
  });

  it('does not mutate the input application config', async () => {
    respondWith([modelEntry('gpt-4.1', completeInfo())]);
    const staticTokenConfig = { 'gpt-4.1': { prompt: 5, completion: 10, context: 8000 } };
    const litellmEndpoint = { name: 'LiteLLM', tokenConfig: staticTokenConfig };
    const appConfig = appConfigWith([litellmEndpoint]);
    const snapshot = JSON.parse(JSON.stringify(appConfig));

    const result = await runBridge(litellmEndpoint);

    expect(appConfig).toEqual(snapshot);
    expect(result).not.toBe(appConfig);
    expect(result.endpoints).not.toBe(appConfig.endpoints);
    expect(result.endpoints.custom).not.toBe(appConfig.endpoints.custom);
    expect(result.endpoints.custom[0]).not.toBe(litellmEndpoint);
    expect(result.endpoints.custom[0].tokenConfig).not.toBe(staticTokenConfig);
  });

  it('only touches the endpoint named LiteLLM, case-insensitively', async () => {
    respondWith([modelEntry('gpt-4.1', completeInfo())]);
    const other = {
      name: 'LiteLLM-Staging',
      tokenConfig: { a: { prompt: 1, completion: 1, context: 2 } },
    };
    const another = { name: 'OpenRouter' };

    await warmLiteLLMModelCache();
    const result = await applyLiteLLMTokenConfig(
      appConfigWith([other, { name: 'litellm' }, another]),
    );

    expect(result.endpoints.custom[0]).toBe(other);
    expect(result.endpoints.custom[2]).toBe(another);
    expect(result.endpoints.custom[1].tokenConfig['gpt-4.1']).toEqual({
      prompt: 3,
      completion: 15,
      context: 200000,
    });
  });

  it('returns the config unchanged when no LiteLLM custom endpoint is configured', async () => {
    respondWith([modelEntry('gpt-4.1', completeInfo())]);
    const appConfig = appConfigWith([{ name: 'OpenRouter' }]);

    expect(await applyLiteLLMTokenConfig(appConfig)).toBe(appConfig);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('returns the config unchanged when there are no custom endpoints', async () => {
    const appConfig = { endpoints: {} };
    expect(await applyLiteLLMTokenConfig(appConfig)).toBe(appConfig);
    expect(await applyLiteLLMTokenConfig(undefined)).toBeUndefined();
  });

  describe('failure backoff', () => {
    const flushBackgroundRefresh = () => new Promise((resolve) => setImmediate(resolve));

    it('does not re-request LiteLLM on every request after a failed cold fetch', async () => {
      axios.get.mockRejectedValue(new Error('ECONNREFUSED'));

      await runBridge();
      await runBridge();
      await runBridge();

      expect(axios.get).toHaveBeenCalledTimes(3);
    });

    it('retries a cold fetch once the backoff window has elapsed', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
      axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
      await runBridge();
      await runBridge();
      expect(axios.get).toHaveBeenCalledTimes(3);

      now.mockReturnValue(1_000 + 60_001);
      respondWith([modelEntry('gpt-4.1', completeInfo())]);
      const tokenConfig = litellmTokenConfig(await runBridge());

      expect(axios.get).toHaveBeenCalledTimes(6);
      expect(tokenConfig['gpt-4.1']).toEqual({ prompt: 3, completion: 15, context: 200000 });
      now.mockRestore();
    });

    it('does not re-arm a stale refresh on every request while LiteLLM keeps failing', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
      respondWith([modelEntry('gpt-4.1', completeInfo())]);
      await runBridge();

      axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
      now.mockReturnValue(1_000 + 60 * 60 * 1000 + 1);

      await runBridge();
      await flushBackgroundRefresh();
      await runBridge();
      const tokenConfig = litellmTokenConfig(
        await applyLiteLLMTokenConfig(appConfigWith([{ name: 'LiteLLM' }])),
      );

      /** one successful triplet + exactly one failed background triplet */
      expect(axios.get).toHaveBeenCalledTimes(6);
      expect(tokenConfig['gpt-4.1']).toEqual({ prompt: 3, completion: 15, context: 200000 });
      now.mockRestore();
    });

    it('logs a fetch failure once per backoff window', async () => {
      const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
      axios.get.mockRejectedValue(new Error('ECONNREFUSED'));

      await runBridge();
      await runBridge();
      await runBridge();

      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  it('never requests LiteLLM without an API key', async () => {
    delete process.env.LITELLM_API_KEY;
    const appConfig = appConfigWith([{ name: 'LiteLLM' }]);

    expect(await applyLiteLLMTokenConfig(appConfig)).toBe(appConfig);
    await warmLiteLLMModelCache();
    expect(axios.get).not.toHaveBeenCalled();
  });
});

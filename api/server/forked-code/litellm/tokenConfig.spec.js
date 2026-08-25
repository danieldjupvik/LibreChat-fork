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

const respondWith = (models) => {
  axios.get.mockResolvedValue({ data: { data: models } });
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

  beforeEach(() => {
    resetLiteLLMModelCache();
    process.env.LITELLM_API_KEY = 'test-key';
    axios.get.mockReset();
  });

  afterAll(() => {
    if (originalApiKey === undefined) {
      delete process.env.LITELLM_API_KEY;
    } else {
      process.env.LITELLM_API_KEY = originalApiKey;
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
    respondWith([
      modelEntry('free-model', completeInfo({ input_cost_per_token: 0, output_cost_per_token: 0 })),
    ]);

    expect((await tokenConfigFor())['free-model']).toEqual({
      prompt: 0,
      completion: 0,
      context: 200000,
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

  it('keeps static cache rates when LiteLLM does not report them', async () => {
    respondWith([modelEntry('gpt-4.1', completeInfo())]);

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

    expect(tokenConfig['gpt-4.1']).toEqual({
      prompt: 3,
      completion: 15,
      context: 200000,
      cacheRead: 0.5,
      cacheWrite: 3.75,
    });
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
    let resolveRequest;
    axios.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
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

    resolveRequest({ data: { data: [modelEntry('gpt-4.1', completeInfo())] } });
    await warmLiteLLMModelCache();

    expect(outcome).toEqual({ status: 'resolved', result: appConfig });
  });

  it('serves the last-known-good cache after a later fetch fails', async () => {
    respondWith([modelEntry('gpt-4.1', completeInfo())]);
    await runBridge();

    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const tokenConfig = await tokenConfigFor();

    expect(tokenConfig['gpt-4.1']).toEqual({ prompt: 3, completion: 15, context: 200000 });
  });

  it('fetches LiteLLM at most once across repeated calls', async () => {
    respondWith([modelEntry('gpt-4.1', completeInfo())]);

    await runBridge();
    await runBridge();

    expect(axios.get).toHaveBeenCalledTimes(1);
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

      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('retries a cold fetch once the backoff window has elapsed', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
      axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
      await runBridge();
      await runBridge();
      expect(axios.get).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1_000 + 60_001);
      respondWith([modelEntry('gpt-4.1', completeInfo())]);
      const tokenConfig = litellmTokenConfig(await runBridge());

      expect(axios.get).toHaveBeenCalledTimes(2);
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

      /** one success + exactly one failed background refresh */
      expect(axios.get).toHaveBeenCalledTimes(2);
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

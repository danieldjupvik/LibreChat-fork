import {
  buildBreakdownFromModelInfo,
  buildBreakdownFromRates,
  buildBreakdownFromSnapshot,
} from './pricing';

describe('ResponseCost snapshot breakdown', () => {
  it('uses persisted cache-aware costs when a snapshot also includes rates', () => {
    const breakdown = buildBreakdownFromSnapshot({
      model: 'gpt-cache',
      usage: {
        model: 'gpt-cache',
        input_tokens: 100,
        output_tokens: 10,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 30,
        rates: {
          input_cost_per_token: 0.000003,
          cache_creation_input_token_cost: 0.00000375,
          cache_read_input_token_cost: 0.0000003,
          output_cost_per_token: 0.000015,
        },
        costs: {
          input: 50 * 0.000003 + 20 * 0.00000375 + 30 * 0.0000003,
          output: 10 * 0.000015,
          reasoning: 0,
          total: 50 * 0.000003 + 20 * 0.00000375 + 30 * 0.0000003 + 10 * 0.000015,
        },
        currency: 'USD',
      },
    });

    expect(breakdown).toEqual(
      expect.objectContaining({
        inputCost: 50 * 0.000003 + 20 * 0.00000375 + 30 * 0.0000003,
        outputCost: 10 * 0.000015,
        totalCost: 50 * 0.000003 + 20 * 0.00000375 + 30 * 0.0000003 + 10 * 0.000015,
      }),
    );
  });

  it('uses live cache buckets when calculating from fallback rates', () => {
    const breakdown = buildBreakdownFromRates({
      model: 'gpt-cache',
      inputTokens: 100,
      outputTokens: 10,
      cacheCreationTokens: 20,
      cacheReadTokens: 30,
      reasoningTokens: null,
      rates: {
        input_cost_per_token: 0.000003,
        cache_creation_input_token_cost: 0.00000375,
        cache_read_input_token_cost: 0.0000003,
        output_cost_per_token: 0.000015,
      },
      lockedRates: false,
    });

    expect(breakdown).toEqual(
      expect.objectContaining({
        inputCost: 50 * 0.000003 + 20 * 0.00000375 + 30 * 0.0000003,
        outputCost: 10 * 0.000015,
        totalCost: 50 * 0.000003 + 20 * 0.00000375 + 30 * 0.0000003 + 10 * 0.000015,
      }),
    );
  });

  it('includes cache rates from model info in live fallback pricing', () => {
    const breakdown = buildBreakdownFromModelInfo({
      model: 'gpt-cache',
      inputTokens: 100,
      outputTokens: 10,
      cacheCreationTokens: 20,
      cacheReadTokens: 30,
      reasoningTokens: null,
      modelInfo: {
        input_cost_per_token: 0.000003,
        cache_creation_input_token_cost: 0.00000375,
        cache_read_input_token_cost: 0.0000003,
        output_cost_per_token: 0.000015,
      },
      lockedRates: false,
    });

    expect(breakdown).toEqual(
      expect.objectContaining({
        inputCost: 50 * 0.000003 + 20 * 0.00000375 + 30 * 0.0000003,
        outputCost: 10 * 0.000015,
        totalCost: 50 * 0.000003 + 20 * 0.00000375 + 30 * 0.0000003 + 10 * 0.000015,
      }),
    );
  });
});

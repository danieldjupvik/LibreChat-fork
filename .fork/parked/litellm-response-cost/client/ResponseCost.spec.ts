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

  it('splits LiteLLM completion tokens into visible output and reasoning at base rates', () => {
    const breakdown = buildBreakdownFromRates({
      model: 'claude-opus-4-8-reasoning',
      inputTokens: 263,
      outputTokens: 2531,
      reasoningTokens: 18,
      rates: {
        input_cost_per_token: 5 / 1_000_000,
        output_cost_per_token: 25 / 1_000_000,
      },
      lockedRates: true,
    });

    expect(breakdown).toEqual(
      expect.objectContaining({
        inputTokens: 263,
        outputTokens: 2531,
        effectiveOutputTokens: 2513,
        reasoningTokens: 18,
      }),
    );
    expect(breakdown.inputCost).toBeCloseTo(0.001315, 12);
    expect(breakdown.outputCost).toBeCloseTo(0.062825, 12);
    expect(breakdown.reasoningCost).toBeCloseTo(0.00045, 12);
    expect(breakdown.totalCost).toBeCloseTo(0.06459, 12);
  });
});

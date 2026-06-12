const mockSaveMessage = jest.fn().mockResolvedValue();
const mockGetLiteLLMModelInfoMap = jest.fn().mockResolvedValue({
  'claude-fable-5': {
    input_cost_per_token: 0.000003,
    cache_creation_input_token_cost: 0.00000375,
    cache_read_input_token_cost: 0.0000003,
    output_cost_per_token: 0.000015,
  },
  'gemini-3.1-pro-preview': {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
  },
  'gpt-5.5': {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
  },
  'gpt-cache': {
    input_cost_per_token: 0.000003,
    cache_creation_input_token_cost: 0.00000375,
    cache_read_input_token_cost: 0.0000003,
    output_cost_per_token: 0.000015,
  },
  'gpt-premium': {
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00002,
  },
});

jest.mock('~/models', () => ({
  saveMessage: (...args) => mockSaveMessage(...args),
}));

jest.mock('~/server/forked-code/litellm/modelInfoCache', () => ({
  getLiteLLMModelInfoMap: (...args) => mockGetLiteLLMModelInfoMap(...args),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn() },
}));

const { syncResponseUsage } = require('./syncResponseUsage');

describe('syncResponseUsage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    {
      model: 'claude-fable-5',
      totalTokens: 3506,
      promptTokens: 263,
      completionTokens: 3243,
      reasoningTokens: 274,
    },
    {
      model: 'gemini-3.1-pro-preview',
      totalTokens: 505,
      promptTokens: 179,
      completionTokens: 326,
      reasoningTokens: 300,
    },
    {
      model: 'gpt-5.5',
      totalTokens: 264,
      promptTokens: 168,
      completionTokens: 96,
      reasoningTokens: 69,
    },
  ])(
    'normalizes LiteLLM OpenAI-compatible usage for $model input output and reasoning tokens',
    async ({ model, totalTokens, promptTokens, completionTokens, reasoningTokens }) => {
      const response = {
        messageId: 'message-1',
        conversationId: 'conversation-1',
        model,
        metadata: {},
      };
      const usage = {
        total_tokens: totalTokens,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        completion_tokens_details: {
          reasoning_tokens: reasoningTokens,
        },
      };

      await syncResponseUsage({
        client: {
          getStreamUsage: () => usage,
          collectedUsage: [usage],
        },
        response,
        req: { user: { id: 'user-1' } },
        persist: true,
      });

      expect(response.promptTokens).toBe(promptTokens);
      expect(response.tokenCount).toBe(completionTokens);
      expect(response.metadata.forked_litellm_usage).toEqual(
        expect.objectContaining({
          input_tokens: promptTokens,
          output_tokens: completionTokens,
          reasoning_tokens: reasoningTokens,
          model,
        }),
      );
      expect(response.metadata.forked_litellm_usage.costs).toMatchObject({
        input: promptTokens * 0.000003,
        output: (completionTokens - reasoningTokens) * 0.000015,
        reasoning: reasoningTokens * 0.000015,
      });
      expect(mockSaveMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          messageId: 'message-1',
          conversationId: 'conversation-1',
          tokenCount: completionTokens,
          metadata: response.metadata,
        }),
        { context: 'api/server/forked-code/agents/syncResponseUsage.js' },
      );
    },
  );

  it('uses LiteLLM cache rates for persisted input cost snapshots', async () => {
    const response = {
      messageId: 'message-cache',
      conversationId: 'conversation-cache',
      model: 'gpt-cache',
      metadata: {},
    };
    const usage = {
      provider: 'openAI',
      input_tokens: 100,
      output_tokens: 10,
      total_tokens: 110,
      input_token_details: {
        cache_creation: 20,
        cache_read: 30,
      },
    };

    await syncResponseUsage({
      client: {
        getStreamUsage: () => ({ input_tokens: 100, output_tokens: 10 }),
        collectedUsage: [usage],
      },
      response,
      req: { user: { id: 'user-1' } },
      persist: true,
    });

    expect(response.metadata.forked_litellm_usage).toEqual(
      expect.objectContaining({
        input_tokens: 100,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 30,
      }),
    );
    expect(response.metadata.forked_litellm_usage.costs).toMatchObject({
      input: 50 * 0.000003 + 20 * 0.00000375 + 30 * 0.0000003,
      output: 10 * 0.000015,
    });
  });

  it('treats Anthropic cache buckets as additive prompt tokens', async () => {
    const response = {
      messageId: 'message-anthropic-cache',
      conversationId: 'conversation-anthropic-cache',
      model: 'claude-fable-5',
      metadata: {},
    };
    const usage = {
      provider: 'anthropic',
      model: 'claude-fable-5',
      input_tokens: 100,
      output_tokens: 10,
      total_tokens: 160,
      input_token_details: {
        cache_creation: 20,
        cache_read: 30,
      },
    };

    await syncResponseUsage({
      client: {
        getStreamUsage: () => usage,
        collectedUsage: [usage],
      },
      response,
      req: { user: { id: 'user-1' } },
      persist: true,
    });

    expect(response.promptTokens).toBe(150);
    expect(response.metadata.forked_litellm_usage).toEqual(
      expect.objectContaining({
        input_tokens: 150,
        output_tokens: 10,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 30,
      }),
    );
    expect(response.metadata.forked_litellm_usage.costs).toMatchObject({
      input: 100 * 0.000003 + 20 * 0.00000375 + 30 * 0.0000003,
      output: 10 * 0.000015,
    });
  });

  it('repairs Vertex output tokens when stream usage omits reasoning tokens', async () => {
    const response = {
      messageId: 'message-vertex-reasoning',
      conversationId: 'conversation-vertex-reasoning',
      model: 'gemini-3.1-pro-preview',
      metadata: {},
    };
    const usage = {
      provider: 'vertexai',
      model: 'gemini-3.1-pro-preview',
      input_tokens: 80657,
      output_tokens: 766,
      total_tokens: 83265,
      output_token_details: {
        reasoning: 1842,
      },
    };

    await syncResponseUsage({
      client: {
        getStreamUsage: () => usage,
        collectedUsage: [usage],
      },
      response,
      req: { user: { id: 'user-1' } },
      persist: true,
    });

    expect(response.promptTokens).toBe(80657);
    expect(response.tokenCount).toBe(2608);
    expect(response.metadata.forked_litellm_usage).toEqual(
      expect.objectContaining({
        input_tokens: 80657,
        output_tokens: 2608,
        reasoning_tokens: 1842,
      }),
    );
    expect(response.metadata.forked_litellm_usage.costs).toMatchObject({
      input: 80657 * 0.000003,
      output: 766 * 0.000015,
      reasoning: 1842 * 0.000015,
    });
  });

  it('keeps aggregate input and cache buckets consistent across tool calls', async () => {
    const response = {
      messageId: 'message-cache-tools',
      conversationId: 'conversation-cache-tools',
      model: 'gpt-cache',
      metadata: {},
    };
    const collectedUsage = [
      {
        provider: 'openAI',
        input_tokens: 100,
        output_tokens: 10,
        input_token_details: {
          cache_creation: 20,
          cache_read: 30,
        },
      },
      {
        provider: 'openAI',
        input_tokens: 200,
        output_tokens: 20,
        input_token_details: {
          cache_creation: 40,
          cache_read: 50,
        },
      },
    ];

    await syncResponseUsage({
      client: {
        getStreamUsage: () => ({ input_tokens: 100, output_tokens: 30 }),
        collectedUsage,
      },
      response,
      req: { user: { id: 'user-1' } },
      persist: true,
    });

    expect(response.metadata.forked_litellm_usage).toEqual(
      expect.objectContaining({
        input_tokens: 300,
        output_tokens: 30,
        cache_creation_input_tokens: 60,
        cache_read_input_tokens: 80,
      }),
    );
    expect(response.metadata.forked_litellm_usage.costs).toMatchObject({
      input: 160 * 0.000003 + 60 * 0.00000375 + 80 * 0.0000003,
      output: 30 * 0.000015,
    });
  });

  it('prices collected usage with each model rate instead of response model rates only', async () => {
    const response = {
      messageId: 'message-mixed-model',
      conversationId: 'conversation-mixed-model',
      model: 'gpt-cache',
      metadata: {},
    };
    const collectedUsage = [
      {
        model: 'gpt-cache',
        input_tokens: 100,
        output_tokens: 10,
      },
      {
        model: 'gpt-premium',
        input_tokens: 200,
        output_tokens: 20,
      },
    ];

    await syncResponseUsage({
      client: {
        getStreamUsage: () => ({ input_tokens: 100, output_tokens: 30 }),
        collectedUsage,
      },
      response,
      req: { user: { id: 'user-1' } },
      persist: true,
    });

    expect(response.metadata.forked_litellm_usage.costs).toMatchObject({
      input: 100 * 0.000003 + 200 * 0.00001,
      output: 10 * 0.000015 + 20 * 0.00002,
    });
  });

  it('excludes summarization usage from visible response token counts', async () => {
    const response = {
      messageId: 'message-with-summary',
      conversationId: 'conversation-with-summary',
      model: 'gpt-cache',
      metadata: {},
    };
    const collectedUsage = [
      {
        provider: 'openAI',
        model: 'gpt-cache',
        input_tokens: 100,
        output_tokens: 10,
      },
      {
        usage_type: 'summarization',
        provider: 'openAI',
        model: 'gpt-cache',
        input_tokens: 500,
        output_tokens: 50,
      },
    ];

    await syncResponseUsage({
      client: {
        getStreamUsage: () => ({ input_tokens: 100, output_tokens: 10 }),
        collectedUsage,
      },
      response,
      req: { user: { id: 'user-1' } },
      persist: true,
    });

    expect(response.promptTokens).toBe(100);
    expect(response.tokenCount).toBe(10);
    expect(response.metadata.forked_litellm_usage).toEqual(
      expect.objectContaining({
        input_tokens: 100,
        output_tokens: 10,
      }),
    );
  });

  it('does not expose aggregate fallback rates when mixed-model pricing is incomplete', async () => {
    const response = {
      messageId: 'message-mixed-missing-price',
      conversationId: 'conversation-mixed-missing-price',
      model: 'gpt-cache',
      metadata: {},
    };
    const collectedUsage = [
      {
        model: 'gpt-cache',
        input_tokens: 100,
        output_tokens: 10,
      },
      {
        model: 'missing-price-model',
        input_tokens: 200,
        output_tokens: 20,
      },
    ];

    await syncResponseUsage({
      client: {
        getStreamUsage: () => ({ input_tokens: 100, output_tokens: 30 }),
        collectedUsage,
      },
      response,
      req: { user: { id: 'user-1' } },
      persist: true,
    });

    expect(response.metadata.forked_litellm_usage.costs).toBeUndefined();
    expect(response.metadata.forked_litellm_usage.rates).toBeUndefined();
  });

  it('attaches cache usage metadata during non-persist live response sync', async () => {
    const response = {
      messageId: 'message-live-cache',
      conversationId: 'conversation-live-cache',
      model: 'gpt-cache',
      metadata: {},
    };
    const usage = {
      provider: 'openAI',
      model: 'gpt-cache',
      input_tokens: 100,
      output_tokens: 10,
      input_token_details: {
        cache_creation: 20,
        cache_read: 30,
      },
    };

    await syncResponseUsage({
      client: {
        getStreamUsage: () => ({ input_tokens: 100, output_tokens: 10 }),
        collectedUsage: [usage],
      },
      response,
    });

    expect(response.metadata.forked_litellm_usage).toEqual(
      expect.objectContaining({
        input_tokens: 100,
        output_tokens: 10,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 30,
      }),
    );
    expect(mockSaveMessage).not.toHaveBeenCalled();
  });

  it('does not attribute aggregate stream usage when only summarization usage is collected', async () => {
    const response = {
      messageId: 'message-only-summary',
      conversationId: 'conversation-only-summary',
      model: 'gpt-cache',
      metadata: {},
    };
    const collectedUsage = [
      {
        usage_type: 'summarization',
        provider: 'openAI',
        model: 'gpt-cache',
        input_tokens: 500,
        output_tokens: 50,
      },
    ];

    await syncResponseUsage({
      client: {
        getStreamUsage: () => ({ input_tokens: 500, output_tokens: 50 }),
        collectedUsage,
      },
      response,
      req: { user: { id: 'user-1' } },
      persist: true,
    });

    expect(response.promptTokens).toBeUndefined();
    expect(response.tokenCount).toBeUndefined();
    expect(response.metadata.forked_litellm_usage).toBeUndefined();
    expect(mockSaveMessage).not.toHaveBeenCalled();
  });
});

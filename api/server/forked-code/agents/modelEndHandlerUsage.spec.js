jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), debug: jest.fn() },
}));

jest.mock(
  'librechat-data-provider',
  () => ({
    Tools: {},
    StepTypes: {},
    FileContext: {},
    ErrorTypes: {
      REFUSAL: 'refusal',
    },
  }),
  { virtual: true },
);

jest.mock(
  '@librechat/api',
  () => ({
    sendEvent: jest.fn(),
    emitEvent: jest.fn(),
    createToolExecuteHandler: jest.fn(),
    markSummarizationUsage: (usage) => usage,
  }),
  { virtual: true },
);

jest.mock('~/server/services/Files/Citations', () => ({
  processFileCitations: jest.fn(),
}));

jest.mock('~/server/services/Files/Code/process', () => ({
  processCodeOutput: jest.fn(),
  runPreviewFinalize: jest.fn(),
}));

jest.mock('~/server/services/Files/process', () => ({
  saveBase64Image: jest.fn(),
}));

const { ModelEndHandler } = require('../../controllers/agents/callbacks');
const { preserveLiteLLMUsage } = require('./preserveLiteLLMUsage');

const buildGraph = ({ endpoint } = {}) => ({
  getAgentContext: () => ({
    ...(endpoint ? { endpoint } : {}),
    provider: 'openAI',
    clientOptions: { model: 'claude-fable-5' },
  }),
});

const preserveForLiteLLM = (handler) =>
  preserveLiteLLMUsage({ on_chat_model_end: handler }, { endpoint: 'LiteLLM' });

describe('ModelEndHandler LiteLLM usage preservation', () => {
  it('preserves OpenAI-compatible response usage details omitted from usage_metadata', async () => {
    const collectedUsage = [];
    const handler = new ModelEndHandler(collectedUsage, null);
    preserveForLiteLLM(handler);

    await handler.handle(
      'on_chat_model_end',
      {
        output: {
          usage_metadata: { output_tokens: 3243 },
          response_metadata: {
            usage: {
              prompt_tokens: 263,
              completion_tokens: 3243,
              total_tokens: 3506,
              completion_tokens_details: {
                reasoning_tokens: 274,
              },
            },
          },
        },
      },
      { ls_model_name: 'claude-fable-5', user_id: 'u' },
      buildGraph(),
    );

    expect(collectedUsage[0]).toEqual(
      expect.objectContaining({
        input_tokens: 263,
        output_tokens: 3243,
        total_tokens: 3506,
        completion_tokens_details: {
          reasoning_tokens: 274,
        },
      }),
    );
  });

  it('restores positive raw token counts over zero usage_metadata placeholders', async () => {
    const collectedUsage = [];
    const handler = new ModelEndHandler(collectedUsage, null);
    preserveForLiteLLM(handler);

    await handler.handle(
      'on_chat_model_end',
      {
        output: {
          usage_metadata: {
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
          },
          response_metadata: {
            usage: {
              prompt_tokens: 168,
              completion_tokens: 96,
              total_tokens: 264,
              completion_tokens_details: {
                reasoning_tokens: 69,
              },
            },
          },
        },
      },
      { ls_model_name: 'gpt-5.5', user_id: 'u' },
      buildGraph(),
    );

    expect(collectedUsage[0]).toEqual(
      expect.objectContaining({
        input_tokens: 168,
        output_tokens: 96,
        total_tokens: 264,
      }),
    );
  });

  it('restores differing positive raw token counts over incomplete usage_metadata estimates', async () => {
    const collectedUsage = [];
    const handler = new ModelEndHandler(collectedUsage, null);
    preserveForLiteLLM(handler);

    await handler.handle(
      'on_chat_model_end',
      {
        output: {
          usage_metadata: {
            input_tokens: 168,
            output_tokens: 27,
            total_tokens: 195,
          },
          response_metadata: {
            usage: {
              prompt_tokens: 168,
              completion_tokens: 96,
              total_tokens: 264,
              completion_tokens_details: {
                reasoning_tokens: 69,
              },
            },
          },
        },
      },
      { ls_model_name: 'gpt-5.5', user_id: 'u' },
      buildGraph(),
    );

    expect(collectedUsage[0]).toEqual(
      expect.objectContaining({
        input_tokens: 168,
        output_tokens: 96,
        total_tokens: 264,
      }),
    );
  });

  it('does not rewrite non-LiteLLM usage metadata', async () => {
    const collectedUsage = [];
    const handler = new ModelEndHandler(collectedUsage, null);
    preserveLiteLLMUsage({ on_chat_model_end: handler }, { endpoint: 'openAI' });

    await handler.handle(
      'on_chat_model_end',
      {
        output: {
          usage_metadata: {
            input_tokens: 10,
            output_tokens: 20,
            total_tokens: 30,
          },
          response_metadata: {
            usage: {
              prompt_tokens: 100,
              completion_tokens: 200,
              total_tokens: 300,
            },
          },
        },
      },
      { ls_model_name: 'gpt-4o', user_id: 'u' },
      buildGraph({ endpoint: 'openAI' }),
    );

    expect(collectedUsage[0]).toEqual(
      expect.objectContaining({
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
      }),
    );
  });

  it('normalizes LiteLLM prompt cache details for billing usage', async () => {
    const collectedUsage = [];
    const handler = new ModelEndHandler(collectedUsage, null);
    preserveForLiteLLM(handler);

    await handler.handle(
      'on_chat_model_end',
      {
        output: {
          usage_metadata: {},
          response_metadata: {
            usage: {
              prompt_tokens: 100,
              completion_tokens: 10,
              total_tokens: 110,
              prompt_tokens_details: {
                cached_tokens: 30,
                cache_creation_tokens: 20,
              },
            },
          },
        },
      },
      { ls_model_name: 'gpt-cache', user_id: 'u' },
      buildGraph(),
    );

    expect(collectedUsage[0]).toEqual(
      expect.objectContaining({
        input_tokens: 100,
        input_token_details: {
          cache_read: 30,
          cache_creation: 20,
        },
      }),
    );
  });

  it('preserves LiteLLM usage when the runtime AgentContext has no endpoint fields', async () => {
    const collectedUsage = [];
    const handler = new ModelEndHandler(collectedUsage, null);
    preserveForLiteLLM(handler);

    await handler.handle(
      'on_chat_model_end',
      {
        output: {
          usage_metadata: { output_tokens: 27 },
          response_metadata: {
            usage: {
              prompt_tokens: 168,
              completion_tokens: 96,
              total_tokens: 264,
            },
          },
        },
      },
      { ls_model_name: 'gpt-5.5', user_id: 'u' },
      buildGraph(),
    );

    expect(collectedUsage[0]).toEqual(
      expect.objectContaining({
        input_tokens: 168,
        output_tokens: 96,
        total_tokens: 264,
      }),
    );
  });

  it('does not reject when getAgentContext throws, deferring to the guarded original handler', async () => {
    const collectedUsage = [];
    const handler = new ModelEndHandler(collectedUsage, null);
    preserveForLiteLLM(handler);

    const throwingGraph = {
      getAgentContext: () => {
        throw new Error('No agent context found for agent ID');
      },
    };

    await expect(
      handler.handle(
        'on_chat_model_end',
        {
          output: {
            usage_metadata: { output_tokens: 96 },
            response_metadata: {
              usage: { prompt_tokens: 168, completion_tokens: 96, total_tokens: 264 },
            },
          },
        },
        { ls_model_name: 'gpt-5.5', user_id: 'u' },
        throwingGraph,
      ),
    ).resolves.toBeUndefined();

    expect(collectedUsage).toHaveLength(0);
  });
});

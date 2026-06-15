const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const mockGetLiteLLMModelInfoMap = jest.fn().mockResolvedValue({
  'claude-fable-5': {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
  },
});

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('~/cache/getLogStores', () => jest.fn(() => ({ get: jest.fn(), set: jest.fn() })));

jest.mock('~/server/forked-code/litellm/modelInfoCache', () => ({
  getLiteLLMModelInfoMap: (...args) => mockGetLiteLLMModelInfoMap(...args),
}));

require('~/db/models');
const { getMessages } = require('~/models');
const { syncResponseUsage } = require('./syncResponseUsage');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  jest.clearAllMocks();
});

describe('syncResponseUsage (database-backed)', () => {
  it('persists the usage snapshot so it survives a fresh read from the database', async () => {
    const conversationId = '11111111-1111-4111-8111-111111111111';
    const messageId = '22222222-2222-4222-8222-222222222222';
    const userId = '33333333-3333-4333-8333-333333333333';

    const response = {
      messageId,
      conversationId,
      model: 'claude-fable-5',
      metadata: {},
    };
    const usage = {
      total_tokens: 3506,
      prompt_tokens: 263,
      completion_tokens: 3243,
      completion_tokens_details: { reasoning_tokens: 274 },
    };

    await syncResponseUsage({
      client: { getStreamUsage: () => usage, collectedUsage: [usage] },
      response,
      req: { user: { id: userId }, body: {}, config: {} },
      persist: true,
    });

    const [persisted] = await getMessages({ conversationId, user: userId });

    expect(persisted).toBeDefined();
    expect(persisted.tokenCount).toBe(3243);
    expect(persisted.metadata?.forked_litellm_usage).toEqual(
      expect.objectContaining({
        input_tokens: 263,
        output_tokens: 3243,
        reasoning_tokens: 274,
        model: 'claude-fable-5',
      }),
    );
  });
});

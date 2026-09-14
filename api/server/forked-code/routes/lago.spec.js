const express = require('express');
const request = require('supertest');
const axios = require('axios');
const { logger } = require('@librechat/data-schemas');
const { getBillingTestEnv } = require('../../../../.fork/e2e/billing');

const mockUser = { _id: 'test-user', email: 'testuser@example.com' };
jest.mock('axios');
jest.mock('../../middleware/requireJwtAuth', () => (req, res, next) => {
  if (!req.headers.authorization) {
    return res.sendStatus(401);
  }
  req.user = mockUser;
  next();
});

const app = express();
app.use('/subscription', require('./lago'));

describe('Lago subscription access', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      LAGO_API_KEY: '',
      LAGO_WHITELISTED_EMAILS: '',
      LAGO_WHITELISTED_USERS: '',
    };
    jest.clearAllMocks();
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('rejects unauthenticated requests even for an allowlisted account', async () => {
    process.env.LAGO_API_KEY = 'e2e-placeholder';
    process.env.LAGO_WHITELISTED_EMAILS = mockUser.email;
    expect((await request(app).get('/subscription/subscription')).status).toBe(401);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('returns a configuration error rather than throwing when the API key is missing', async () => {
    const response = await request(app)
      .get('/subscription/subscription')
      .set('Authorization', 'test');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Lago API key not configured' });
    expect(logger.error).toHaveBeenCalledWith('LAGO_API_KEY not found in environment variables');
  });

  it('grants the allowlisted test user access without contacting Lago', async () => {
    process.env.E2E_USER_EMAIL = mockUser.email;
    Object.assign(process.env, getBillingTestEnv());
    const response = await request(app)
      .get('/subscription/subscription')
      .set('Authorization', 'test');
    expect(response.body).toEqual({ hasSubscription: true, whitelisted: true, subscription: null });
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('limits the fixture to the selected user and clears inherited billing settings', () => {
    process.env.E2E_USER_EMAIL = 'selected@example.com';
    process.env.LAGO_WHITELISTED_USERS = 'production-user';
    const env = getBillingTestEnv();
    expect(env.LAGO_WHITELISTED_EMAILS).toBe('selected@example.com');
    expect(env.LAGO_WHITELISTED_USERS).toBe('');
    expect(env.LAGO_BASE_URL).toBe('http://127.0.0.1:1');
  });

  it('denies access on a billing outage for an account outside the allowlist', async () => {
    process.env.LAGO_API_KEY = 'e2e-placeholder';
    process.env.LAGO_WHITELISTED_EMAILS = 'another@example.com';
    axios.get.mockRejectedValue(new Error('Billing unavailable'));
    const response = await request(app)
      .get('/subscription/subscription')
      .set('Authorization', 'test');
    expect(response.body).toMatchObject({ hasSubscription: false, error: true, fallback: false });
    expect(logger.error).toHaveBeenCalledWith(
      'Error fetching Lago subscription info:',
      'Billing unavailable',
    );
  });
});

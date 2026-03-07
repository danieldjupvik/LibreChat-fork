const request = require('supertest');
const express = require('express');

const mockCreateCustomerPortalUrl = jest.fn();
const mockUser = { email: 'person@example.com' };

jest.mock('../../middleware/requireJwtAuth', () => (req, _res, next) => {
  req.user = mockUser;
  next();
});

jest.mock('../customerPortal', () => ({
  ...jest.requireActual('../customerPortal'),
  createCustomerPortalUrl: (...args) => mockCreateCustomerPortalUrl(...args),
}));

const customerPortalRoute = require('./customerPortal');

describe('GET /api/forked/customer-portal', () => {
  const app = express();

  app.use('/api/forked/customer-portal', customerPortalRoute);

  beforeEach(() => {
    mockUser.email = 'person@example.com';
    mockCreateCustomerPortalUrl.mockReset();
  });

  it('returns the generated portal URL', async () => {
    mockCreateCustomerPortalUrl.mockReturnValue('https://profile.danieldjupvik.com/?token=abc123');

    const response = await request(app).get('/api/forked/customer-portal');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      url: 'https://profile.danieldjupvik.com/?token=abc123',
    });
    expect(mockCreateCustomerPortalUrl).toHaveBeenCalledWith({
      email: 'person@example.com',
    });
  });

  it('sets Cache-Control: no-store on success', async () => {
    mockCreateCustomerPortalUrl.mockReturnValue('https://profile.danieldjupvik.com/?token=abc123');

    const response = await request(app).get('/api/forked/customer-portal');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('rejects a username that is not a valid email address', async () => {
    mockUser.email = 'testusername';
    mockCreateCustomerPortalUrl.mockImplementation(() => {
      throw new Error('Customer portal requires a valid email address');
    });

    const response = await request(app).get('/api/forked/customer-portal');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Customer portal requires a valid email address',
    });
  });

  it('returns 503 when the signing secret is not configured', async () => {
    mockCreateCustomerPortalUrl.mockImplementation(() => {
      throw new Error('CUSTOMER_PORTAL_JWT_SECRET is required');
    });

    const response = await request(app).get('/api/forked/customer-portal');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: 'Customer portal is not configured',
    });
  });

  it('returns a clear client error when the current user has no email', async () => {
    mockUser.email = '   ';
    mockCreateCustomerPortalUrl.mockImplementation(() => {
      throw new Error('Customer portal requires an email address');
    });

    const response = await request(app).get('/api/forked/customer-portal');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Customer portal requires an email address',
    });
  });
});

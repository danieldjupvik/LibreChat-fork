const jwt = require('jsonwebtoken');

const { CUSTOMER_PORTAL_URL, createCustomerPortalUrl } = require('./customerPortal');

describe('createCustomerPortalUrl', () => {
  const originalSecret = process.env.CUSTOMER_PORTAL_JWT_SECRET;

  beforeEach(() => {
    process.env.CUSTOMER_PORTAL_JWT_SECRET = 'portal-secret';
  });

  afterEach(() => {
    process.env.CUSTOMER_PORTAL_JWT_SECRET = originalSecret;
    jest.restoreAllMocks();
  });

  it('creates a portal URL with a token whose payload contains only the normalized email', () => {
    const portalUrl = createCustomerPortalUrl({ email: '  Test.User@Example.COM  ' });
    const parsed = new URL(portalUrl);
    const token = parsed.searchParams.get('token');

    expect(parsed.origin + parsed.pathname).toBe(`${new URL(CUSTOMER_PORTAL_URL).origin}/`);
    expect(parsed.searchParams.has('email')).toBe(false);
    expect(token).toEqual(expect.any(String));

    const decoded = jwt.verify(token, process.env.CUSTOMER_PORTAL_JWT_SECRET);

    expect(decoded).toEqual({
      email: 'test.user@example.com',
      exp: expect.any(Number),
      iat: expect.any(Number),
    });
    expect(Object.keys(decoded).sort()).toEqual(['email', 'exp', 'iat']);
  });

  it('sets the token lifetime to five minutes', () => {
    const portalUrl = createCustomerPortalUrl({ email: 'user@example.com' });
    const token = new URL(portalUrl).searchParams.get('token');
    const decoded = jwt.verify(token, process.env.CUSTOMER_PORTAL_JWT_SECRET);

    expect(decoded.exp - decoded.iat).toBe(300);
  });

  it('does not generate a token when email is not a valid address', () => {
    const signSpy = jest.spyOn(jwt, 'sign');

    expect(() => createCustomerPortalUrl({ email: 'testusername' })).toThrow(
      'Customer portal requires a valid email address',
    );
    expect(signSpy).not.toHaveBeenCalled();
  });

  it('does not generate a token when email is missing', () => {
    const signSpy = jest.spyOn(jwt, 'sign');

    expect(() => createCustomerPortalUrl({ email: '   ' })).toThrow(
      'Customer portal requires an email address',
    );
    expect(signSpy).not.toHaveBeenCalled();
  });
});

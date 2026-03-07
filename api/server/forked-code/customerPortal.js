const jwt = require('jsonwebtoken');

const EMAIL_REQUIRED_ERROR = 'Customer portal requires an email address';
const INVALID_EMAIL_ERROR = 'Customer portal requires a valid email address';
const PORTAL_SECRET_REQUIRED_ERROR = 'CUSTOMER_PORTAL_JWT_SECRET is required';
const CUSTOMER_PORTAL_URL = 'https://profile.danieldjupvik.com';

// Intentionally loose — just requires `local@domain` structure
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (email) => email?.trim().toLowerCase() ?? '';

const isValidEmail = (email) => EMAIL_REGEX.test(normalizeEmail(email));

const createCustomerPortalUrl = ({ email }) => {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error(EMAIL_REQUIRED_ERROR);
  }

  if (!isValidEmail(normalizedEmail)) {
    throw new Error(INVALID_EMAIL_ERROR);
  }

  if (!process.env.CUSTOMER_PORTAL_JWT_SECRET) {
    throw new Error(PORTAL_SECRET_REQUIRED_ERROR);
  }

  const token = jwt.sign({ email: normalizedEmail }, process.env.CUSTOMER_PORTAL_JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });

  const portalUrl = new URL(CUSTOMER_PORTAL_URL);
  portalUrl.searchParams.set('token', token);

  return portalUrl.toString();
};

module.exports = {
  CUSTOMER_PORTAL_URL,
  EMAIL_REQUIRED_ERROR,
  INVALID_EMAIL_ERROR,
  PORTAL_SECRET_REQUIRED_ERROR,
  createCustomerPortalUrl,
  isValidEmail,
};

import { getE2EUser } from '../../e2e/setup/user';

export function getBillingTestEnv(): Record<string, string> {
  return {
    LAGO_API_KEY: 'e2e-placeholder',
    LAGO_BASE_URL: 'http://127.0.0.1:1',
    LAGO_WHITELISTED_EMAILS: getE2EUser().email,
    LAGO_WHITELISTED_USERS: '',
  };
}

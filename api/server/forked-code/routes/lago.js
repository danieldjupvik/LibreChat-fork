const express = require('express');
const router = express.Router();
const axios = require('axios');
const { logger } = require('../../../config');
const requireJwtAuth = require('../../middleware/requireJwtAuth');

const lagoBaseURL = process.env.LAGO_BASE_URL || 'https://lago.danieldjupvik.com';

const lagoRequest = (apiKey, path, params = {}) =>
  axios.get(`${lagoBaseURL}/api/v1${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    params,
    timeout: 5000,
  });

const lagoPost = (apiKey, path) =>
  axios.post(
    `${lagoBaseURL}/api/v1${path}`,
    {},
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    },
  );

/**
 * Generates a Stripe checkout URL for a Lago customer.
 * Returns null if generation fails (non-critical).
 */
async function getCheckoutUrl(apiKey, customerExternalId) {
  try {
    const response = await lagoPost(apiKey, `/customers/${customerExternalId}/checkout_url`);
    return response.data?.customer?.checkout_url || null;
  } catch (error) {
    logger.warn('Failed to generate checkout URL:', error.message);
    return null;
  }
}

/**
 * Proxy endpoint to fetch subscription information from Lago.
 * Identity is derived from the authenticated session (req.user), not query params.
 *
 * @route GET /api/forked/lago/subscription
 */
router.get('/subscription', requireJwtAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const email = req.user.email;

    const apiKey = process.env.LAGO_API_KEY;
    if (!apiKey) {
      logger.error('LAGO_API_KEY not found in environment variables');
      return res.status(500).json({ error: 'Lago API key not configured' });
    }

    const whitelistedEmails = process.env.LAGO_WHITELISTED_EMAILS
      ? process.env.LAGO_WHITELISTED_EMAILS.split(',').map((e) => e.trim().toLowerCase())
      : [];

    const whitelistedUsers = process.env.LAGO_WHITELISTED_USERS
      ? process.env.LAGO_WHITELISTED_USERS.split(',').map((u) => u.trim())
      : [];

    if (
      (email && whitelistedEmails.includes(email.toLowerCase())) ||
      whitelistedUsers.includes(userId)
    ) {
      return res.json({
        hasSubscription: true,
        whitelisted: true,
        subscription: null,
      });
    }

    if (!email) {
      return res.json({
        hasSubscription: false,
        whitelisted: false,
        subscription: null,
        reason: 'no_account',
      });
    }

    // Step 1: Find the Lago customer by email
    const customerResponse = await lagoRequest(apiKey, '/customers', {
      search_term: email.toLowerCase(),
      per_page: 5,
    });

    const { customers = [] } = customerResponse.data;
    const customer = customers.find(
      (c) => c.email && c.email.toLowerCase() === email.toLowerCase(),
    );

    if (!customer) {
      return res.json({
        hasSubscription: false,
        whitelisted: false,
        subscription: null,
        reason: 'no_account',
      });
    }

    // Step 2: Verify billing provider is configured
    const billingConfig = customer.billing_configuration || {};
    if (!billingConfig.payment_provider || !billingConfig.provider_customer_id) {
      const checkoutUrl = billingConfig.payment_provider
        ? await getCheckoutUrl(apiKey, customer.external_id)
        : null;

      return res.json({
        hasSubscription: false,
        whitelisted: false,
        subscription: null,
        reason: 'no_payment_method',
        checkoutUrl,
      });
    }

    // Step 3: Check for active subscriptions using the customer's external_id
    const subResponse = await lagoRequest(apiKey, '/subscriptions', {
      external_customer_id: customer.external_id,
      'status[]': 'active',
    });

    const { subscriptions = [] } = subResponse.data;
    const userSubscription = subscriptions.length > 0 ? subscriptions[0] : null;

    if (userSubscription) {
      return res.json({
        hasSubscription: true,
        whitelisted: false,
        subscription: userSubscription,
      });
    }

    // No active subscription — generate checkout URL so user can add/update payment method
    const checkoutUrl = await getCheckoutUrl(apiKey, customer.external_id);

    return res.json({
      hasSubscription: false,
      whitelisted: false,
      subscription: null,
      reason: 'no_active_subscription',
      checkoutUrl,
    });
  } catch (error) {
    logger.error('Error fetching Lago subscription info:', error);
    logger.warn('Denying access due to Lago API error');

    return res.json({
      hasSubscription: false,
      error: true,
      errorMessage: 'Error connecting to subscription service',
      fallback: false,
    });
  }
});

module.exports = router;

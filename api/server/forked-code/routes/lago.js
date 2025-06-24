const express = require('express');
const router = express.Router();
const axios = require('axios');
const { logger } = require('../../../config');

// Get Lago API base URL from environment variables or use default
const lagoBaseURL = process.env.LAGO_BASE_URL || 'https://lago.danieldjupvik.com';

/**
 * Fetches all subscriptions from Lago API, handling pagination.
 *
 * @param {string} apiKey - Lago API key.
 * @param {string} baseUrl - Full endpoint URL for Lago subscriptions.
 * @returns {Array} Combined array of subscriptions.
 */
async function fetchAllSubscriptions(apiKey, baseUrl) {
  let allSubscriptions = [];
  let currentPage = 1;
  let hasMorePages = true;

  while (hasMorePages) {
    try {
      const response = await axios.get(`${baseUrl}?page=${currentPage}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000, // Optional: timeout after 5 seconds
      });

      const { subscriptions = [], meta = {} } = response.data;
      allSubscriptions = [...allSubscriptions, ...subscriptions];

      // If meta.total_pages or meta.has_more is provided by the API, you might check those as well.
      if (meta.next_page) {
        currentPage = meta.next_page;
      } else {
        hasMorePages = false;
      }
    } catch (error) {
      logger.error(`Error fetching page ${currentPage} of subscriptions:`, error);
      // If an error occurs on the first page or if nothing has been fetched, treat it as critical.
      if (currentPage === 1 || allSubscriptions.length === 0) {
        throw new Error('Error fetching subscriptions: API might be down.');
      }
      hasMorePages = false;
    }
  }

  return allSubscriptions;
}

/**
 * Proxy endpoint to fetch subscription information from Lago.
 * This keeps the API key secure on the server and avoids exposing it to clients.
 *
 * @route GET /api/forked/lago/subscription
 * @param {string} userId - The user ID to check subscription status for.
 * @param {string} email - The user email to check whitelist for.
 * @returns {object} Subscription information including status.
 */
router.get('/subscription', async (req, res) => {
  try {
    const { userId, email } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId parameter is required' });
    }

    const apiKey = process.env.LAGO_API_KEY;
    if (!apiKey) {
      logger.error('LAGO_API_KEY not found in environment variables');
      return res.status(500).json({ error: 'Lago API key not configured' });
    }

    // Whitelist of emails who can bypass subscription check
    const whitelistedEmails = process.env.LAGO_WHITELISTED_EMAILS
      ? process.env.LAGO_WHITELISTED_EMAILS.split(',')
      : [];

    // Legacy user ID whitelist (for backward compatibility)
    const whitelistedUsers = process.env.LAGO_WHITELISTED_USERS
      ? process.env.LAGO_WHITELISTED_USERS.split(',')
      : [];

    // If the email or user ID is whitelisted, grant subscription access
    if (
      email &&
      (whitelistedEmails.includes(email.toLowerCase()) ||
        whitelistedUsers.includes(userId))
    ) {
      return res.json({
        hasSubscription: true,
        whitelisted: true,
        subscription: null,
      });
    }

    // Construct the full Lago API endpoint URL for subscriptions
    const subscriptionsEndpoint = `${lagoBaseURL}/api/v1/subscriptions`;

    // Fetch all subscriptions across pages (this function may throw on errors)
    const allSubscriptions = await fetchAllSubscriptions(apiKey, subscriptionsEndpoint);

    // Find the active subscription for this user
    const normalizedUserId = userId.trim();
    const userSubscription = allSubscriptions.find(
      sub => sub.external_id.trim() === normalizedUserId && sub.status === 'active',
    );

    // Cache response for 5 minutes to reduce load on the Lago service
    res.setHeader('Cache-Control', 'public, max-age=300');

    return res.json({
      hasSubscription: !!userSubscription,
      whitelisted: false,
      subscription: userSubscription || null,
    });
  } catch (error) {
    logger.error('Error fetching Lago subscription info:', error);
    logger.warn('Denying access due to Lago API error');

    // Deny access when there is an error connecting to the subscription service
    return res.json({
      hasSubscription: false,
      error: true,
      errorMessage: 'Error connecting to subscription service',
      fallback: false,
    });
  }
});

module.exports = router;
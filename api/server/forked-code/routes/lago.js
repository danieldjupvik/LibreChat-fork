const express = require('express');
const router = express.Router();
const axios = require('axios');
const { logger } = require('../../../config');

// Get Lago API base URL from environment variables or use default
const lagoBaseURL = process.env.LAGO_BASE_URL || 'https://lago.danieldjupvik.com';

/**
 * Fetches all subscriptions from Lago API, handling pagination
 *
 * @param {string} apiKey - Lago API key
 * @param {string} baseUrl - Base URL for Lago API
 * @returns {Array} Combined array of all subscriptions across pages
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
      });

      const { subscriptions = [], meta = {} } = response.data;

      // Add subscriptions from this page
      allSubscriptions = [...allSubscriptions, ...subscriptions];

      // Check if there are more pages
      if (meta.next_page) {
        currentPage = meta.next_page;
      } else {
        hasMorePages = false;
      }
    } catch (error) {
      // Log error but don't fail - return what we have so far
      logger.error(`Error fetching page ${currentPage} of subscriptions:`, error);
      hasMorePages = false;
    }
  }

  return allSubscriptions;
}

/**
 * Proxy endpoint to fetch subscription information from Lago
 * This keeps the API key secure on the server and avoids exposing it to clients
 *
 * @route GET /api/forked/lago/subscription
 * @param {string} userId - The user ID to check subscription status for
 * @param {string} email - The user email to check whitelist for
 * @returns {object} Subscription information including status
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

    // Check both whitelist types
    if (email && whitelistedEmails.includes(email.toLowerCase()) || whitelistedUsers.includes(userId)) {
      return res.json({
        hasSubscription: true,
        whitelisted: true,
        subscription: null,
      });
    }

    // Construct the full Lago API endpoint URL
    const subscriptionsEndpoint = `${lagoBaseURL}/api/v1/subscriptions`;

    // Fetch all subscriptions across all pages
    const allSubscriptions = await fetchAllSubscriptions(apiKey, subscriptionsEndpoint);

    // Find subscription for this user
    const userSubscription = allSubscriptions.find(
      sub => sub.external_id === userId && sub.status === 'active',
    );

    // Cache header to reduce load on Lago service
    // Cache for 5 minutes (300 seconds)
    res.setHeader('Cache-Control', 'public, max-age=300');

    return res.json({
      hasSubscription: !!userSubscription,
      whitelisted: false,
      subscription: userSubscription || null,
    });
  } catch (error) {
    logger.error('Error fetching Lago subscription info:', error);

    // On error, default to allowing access
    logger.warn('Defaulting to allow access due to Lago API error');

    // Handle different types of errors
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      logger.error(`Failed to fetch Lago subscription info: ${error.response.status} ${error.response.statusText}`);

      // Return success with fallback access
      return res.json({
        hasSubscription: true,
        error: true,
        errorMessage: 'Error connecting to subscription service',
        fallback: true,
      });
    } else if (error.request) {
      // The request was made but no response was received
      logger.error('No response received from Lago API');

      // Return success with fallback access
      return res.json({
        hasSubscription: true,
        error: true,
        errorMessage: 'No response from subscription service',
        fallback: true,
      });
    }

    // Return success with fallback access
    return res.json({
      hasSubscription: true,
      error: true,
      errorMessage: error.message,
      fallback: true,
    });
  }
});

module.exports = router;
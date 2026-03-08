const express = require('express');
const requireJwtAuth = require('../../middleware/requireJwtAuth');
const {
  EMAIL_REQUIRED_ERROR,
  INVALID_EMAIL_ERROR,
  PORTAL_SECRET_REQUIRED_ERROR,
  createCustomerPortalUrl,
} = require('../customerPortal');

const router = express.Router();

router.get('/', requireJwtAuth, async (req, res) => {
  try {
    const url = createCustomerPortalUrl({
      email: req.user?.email,
    });

    res.set('Cache-Control', 'no-store');
    return res.json({ url });
  } catch (error) {
    if (error.message === EMAIL_REQUIRED_ERROR || error.message === INVALID_EMAIL_ERROR) {
      return res.status(400).json({ error: error.message });
    }

    if (error.message === PORTAL_SECRET_REQUIRED_ERROR) {
      return res.status(503).json({ error: 'Customer portal is not configured' });
    }

    return res.status(500).json({ error: 'Failed to create customer portal URL' });
  }
});

module.exports = router;

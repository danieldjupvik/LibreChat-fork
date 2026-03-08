const express = require('express');
const router = express.Router();

const litellmRoutes = require('./litellm');
const lagoRoutes = require('./lago');
const customerPortalRoutes = require('./customerPortal');

// Register all custom routes with a /forked prefix to avoid conflicts
router.use('/litellm', litellmRoutes);
router.use('/lago', lagoRoutes);
router.use('/customer-portal', customerPortalRoutes);

module.exports = router;

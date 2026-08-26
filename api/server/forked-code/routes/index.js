const express = require('express');
const router = express.Router();

const lagoRoutes = require('./lago');
const customerPortalRoutes = require('./customerPortal');

// Register all custom routes with a /forked prefix to avoid conflicts
router.use('/lago', lagoRoutes);
router.use('/customer-portal', customerPortalRoutes);

module.exports = router;

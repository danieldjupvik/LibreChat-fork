const express = require('express');
const router = express.Router();

const litellmRoutes = require('./litellm');
const lagoRoutes = require('./lago');

// Register all custom routes with a /forked prefix to avoid conflicts
router.use('/litellm', litellmRoutes);
router.use('/lago', lagoRoutes);

module.exports = router;
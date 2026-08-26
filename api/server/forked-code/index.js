const forkedRoutes = require('./routes');
const { warmLiteLLMModelCache } = require('./litellm/modelInfoCache');

/**
 * Initialize all forked code customizations
 *
 * @param {Express} app - Express application instance
 */
const initForkedCode = (app) => {
  app.use('/api/forked', forkedRoutes);
  void warmLiteLLMModelCache();
};

module.exports = {
  initForkedCode,
};

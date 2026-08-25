const { logger } = require('@librechat/data-schemas');
const { getAppConfigOptionsFromUser } = require('@librechat/api');
const { applyLiteLLMTokenConfig } = require('~/server/forked-code/litellm/tokenConfig');
const { getAppConfig: getBaseAppConfig } = require('~/server/services/Config');

// FORK-SENTINEL:litellm-token-config — inject LiteLLM pricing on every config path in this middleware
const getAppConfig = async (options) => {
  return applyLiteLLMTokenConfig(await getBaseAppConfig(options));
};

const configMiddleware = async (req, res, next) => {
  try {
    req.config = await getAppConfig(getAppConfigOptionsFromUser(req.user));

    next();
  } catch (error) {
    logger.error('Config middleware error:', {
      error: error.message,
      userRole: req.user?.role,
      path: req.path,
    });

    try {
      req.config = await getAppConfig({ tenantId: req.user?.tenantId });
      next();
    } catch (fallbackError) {
      logger.error('Fallback config middleware error:', fallbackError);
      next(fallbackError);
    }
  }
};

module.exports = configMiddleware;

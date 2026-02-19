const { logger } = require('@librechat/data-schemas');
const { saveMessage } = require('~/models');
const { getLiteLLMModelInfoMap } = require('~/server/forked-code/litellm/modelInfoCache');

const toPositiveNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const toNonNegativeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const toOptionalNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getReasoningTokens = (usage) =>
  toPositiveNumber(
    usage?.reasoning_tokens ??
      usage?.output_token_details?.reasoning_tokens ??
      usage?.completion_tokens_details?.reasoning_tokens ??
      usage?.usage?.completion_tokens_details?.reasoning_tokens,
  );

const buildUsageBreakdown = ({ streamUsage, collectedUsage }) => {
  const inputTokens = toPositiveNumber(streamUsage?.input_tokens);
  const outputTokens = toPositiveNumber(streamUsage?.output_tokens);
  const usageList = Array.isArray(collectedUsage) ? collectedUsage.filter(Boolean) : [];

  const reasoningTokens = Math.min(
    outputTokens,
    usageList.reduce((sum, usage) => sum + getReasoningTokens(usage), 0),
  );

  const effectiveOutputTokens = Math.max(0, outputTokens - reasoningTokens);

  return {
    inputTokens,
    outputTokens,
    effectiveInputTokens: inputTokens,
    effectiveOutputTokens,
    reasoningTokens,
  };
};

const buildRates = ({ modelInfo }) => {
  if (!modelInfo) {
    return null;
  }

  const inputCostPerToken = toOptionalNumber(modelInfo.input_cost_per_token);
  const outputCostPerToken = toOptionalNumber(modelInfo.output_cost_per_token);
  const outputCostPerReasoningToken =
    toOptionalNumber(modelInfo.output_cost_per_reasoning_token) ?? outputCostPerToken;

  if (
    inputCostPerToken == null &&
    outputCostPerToken == null &&
    outputCostPerReasoningToken == null
  ) {
    return null;
  }

  return {
    input_cost_per_token: inputCostPerToken,
    output_cost_per_token: outputCostPerToken,
    output_cost_per_reasoning_token: outputCostPerReasoningToken,
  };
};

const buildCosts = ({ breakdown, rates }) => {
  if (!rates) {
    return null;
  }

  const inputCost =
    breakdown.effectiveInputTokens * toNonNegativeNumber(rates.input_cost_per_token);
  const outputCost =
    breakdown.effectiveOutputTokens * toNonNegativeNumber(rates.output_cost_per_token);
  const reasoningCost =
    breakdown.reasoningTokens * toNonNegativeNumber(rates.output_cost_per_reasoning_token);

  return {
    input: inputCost,
    output: outputCost,
    reasoning: reasoningCost,
    total: inputCost + outputCost + reasoningCost,
  };
};

async function syncResponseUsage({ client, response, req, persist = false }) {
  const streamUsage = client?.getStreamUsage?.();
  if (!streamUsage || !response) {
    return response;
  }

  const breakdown = buildUsageBreakdown({
    streamUsage,
    collectedUsage: client?.collectedUsage,
  });
  const inputTokens = breakdown.inputTokens;
  const outputTokens = breakdown.outputTokens;

  if (inputTokens > 0) {
    response.promptTokens = inputTokens;
  }
  if (outputTokens > 0) {
    response.tokenCount = outputTokens;
  }

  if (!response.messageId || !response.conversationId || (inputTokens <= 0 && outputTokens <= 0)) {
    return response;
  }

  if (!persist || !req) {
    return response;
  }

  const model = response.model || response?.metadata?.model;
  let rates = null;
  if (model) {
    const modelInfoMap = await getLiteLLMModelInfoMap();
    rates = buildRates({ modelInfo: modelInfoMap[model] });
  }
  const costs = buildCosts({ breakdown, rates });

  response.metadata = {
    ...(response.metadata ?? {}),
    forked_litellm_usage: {
      version: 2,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      reasoning_tokens: breakdown.reasoningTokens,
      ...(model ? { model } : {}),
      ...(rates ? { rates } : {}),
      ...(costs ? { costs } : {}),
      currency: 'USD',
      calculated_at: new Date().toISOString(),
    },
  };

  try {
    await saveMessage(
      req,
      {
        messageId: response.messageId,
        conversationId: response.conversationId,
        metadata: response.metadata,
        ...(outputTokens > 0 ? { tokenCount: outputTokens } : {}),
      },
      { context: 'api/server/forked-code/agents/syncResponseUsage.js' },
    );
  } catch (error) {
    logger.warn('[syncResponseUsage] Failed to persist stream usage metadata', {
      messageId: response.messageId,
      conversationId: response.conversationId,
      error: error?.message,
    });
  }

  return response;
}

module.exports = {
  syncResponseUsage,
};

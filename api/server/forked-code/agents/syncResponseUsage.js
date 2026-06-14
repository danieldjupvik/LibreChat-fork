const { logger } = require('@librechat/data-schemas');
const { saveMessage } = require('~/models');
const { getLiteLLMModelInfoMap } = require('~/server/forked-code/litellm/modelInfoCache');

const SUBSET_PROVIDERS = new Set([
  'openAI',
  'azureOpenAI',
  'google',
  'vertexai',
  'xai',
  'deepseek',
  'openrouter',
  'moonshot',
]);

const toPositiveNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const toNonNegativeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const toOptionalNumber = (value) => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getInputTokens = (usage) =>
  toPositiveNumber(
    usage?.input_tokens ??
      usage?.prompt_tokens ??
      usage?.inputTokens ??
      usage?.usage?.prompt_tokens,
  );

const getOutputTokens = (usage) =>
  toPositiveNumber(
    usage?.output_tokens ??
      usage?.completion_tokens ??
      usage?.outputTokens ??
      usage?.usage?.completion_tokens,
  );

const getTotalTokens = (usage) =>
  toPositiveNumber(usage?.total_tokens ?? usage?.totalTokens ?? usage?.usage?.total_tokens);

const getReasoningTokens = (usage) =>
  toPositiveNumber(
    usage?.reasoning_tokens ??
      usage?.output_token_details?.reasoning ??
      usage?.output_token_details?.reasoning_tokens ??
      usage?.completion_tokens_details?.reasoning_tokens ??
      usage?.usage?.completion_tokens_details?.reasoning_tokens,
  );

const getCacheReadTokens = (usage) =>
  toPositiveNumber(
    usage?.input_token_details?.cache_read ??
      usage?.prompt_tokens_details?.cached_tokens ??
      usage?.cache_read_input_tokens ??
      usage?.usage?.prompt_tokens_details?.cached_tokens,
  );

const getCacheCreationTokens = (usage) =>
  toPositiveNumber(
    usage?.input_token_details?.cache_creation ??
      usage?.prompt_tokens_details?.cache_creation_tokens ??
      usage?.prompt_tokens_details?.cache_write_tokens ??
      usage?.cache_creation_input_tokens ??
      usage?.usage?.prompt_tokens_details?.cache_creation_tokens,
  );

const getUsageModel = (usage, fallbackModel) =>
  usage?.model ??
  usage?.usage?.model ??
  usage?.response_metadata?.model_name ??
  usage?.response_metadata?.model ??
  fallbackModel;

const getUsageProvider = (usage) =>
  usage?.provider ?? usage?.usage?.provider ?? usage?.response_metadata?.provider;

const inputTokensIncludeCache = (provider) => provider != null && SUBSET_PROVIDERS.has(provider);

const resolveOutputTokens = (usage) => {
  const outputTokens = getOutputTokens(usage);
  const totalTokens = getTotalTokens(usage);
  const inputTokens = getInputTokens(usage);
  const cacheTokens = getCacheReadTokens(usage) + getCacheCreationTokens(usage);
  const cacheAdjustment = inputTokensIncludeCache(getUsageProvider(usage)) ? 0 : cacheTokens;

  if (totalTokens > inputTokens + outputTokens + cacheAdjustment) {
    return totalTokens - inputTokens - cacheAdjustment;
  }

  return outputTokens;
};

const createUsageBreakdown = ({ model } = {}) => ({
  model,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  reasoningTokens: 0,
  effectiveInputTokens: 0,
});

const addUsage = (breakdown, usage) => {
  const inputTokens = getInputTokens(usage);
  const cacheReadTokens = getCacheReadTokens(usage);
  const cacheCreationTokens = getCacheCreationTokens(usage);
  const cacheTokens = cacheReadTokens + cacheCreationTokens;
  const isSubsetProvider = inputTokensIncludeCache(getUsageProvider(usage));

  breakdown.inputTokens += isSubsetProvider ? inputTokens : inputTokens + cacheTokens;
  breakdown.effectiveInputTokens += isSubsetProvider
    ? Math.max(0, inputTokens - cacheTokens)
    : inputTokens;
  breakdown.outputTokens += resolveOutputTokens(usage);
  breakdown.cacheReadTokens += cacheReadTokens;
  breakdown.cacheCreationTokens += cacheCreationTokens;
  breakdown.reasoningTokens += getReasoningTokens(usage);
  return breakdown;
};

const finalizeUsageBreakdown = (breakdown) => {
  const reasoningTokens = Math.min(breakdown.outputTokens, breakdown.reasoningTokens);
  return {
    ...breakdown,
    effectiveOutputTokens: Math.max(0, breakdown.outputTokens - reasoningTokens),
    reasoningTokens,
  };
};

const sumUsageBreakdowns = (breakdowns) =>
  breakdowns.reduce((sum, breakdown) => {
    sum.inputTokens += breakdown.inputTokens;
    sum.outputTokens += breakdown.outputTokens;
    sum.cacheReadTokens += breakdown.cacheReadTokens;
    sum.cacheCreationTokens += breakdown.cacheCreationTokens;
    sum.effectiveInputTokens += breakdown.effectiveInputTokens;
    sum.effectiveOutputTokens += breakdown.effectiveOutputTokens;
    sum.reasoningTokens += breakdown.reasoningTokens;
    return sum;
  }, finalizeUsageBreakdown(createUsageBreakdown()));

const buildUsageBreakdown = ({ streamUsage, collectedUsage, model }) => {
  const usageList = Array.isArray(collectedUsage) ? collectedUsage.filter(Boolean) : [];
  const messageUsages = usageList.filter((usage) => usage?.usage_type !== 'summarization');
  const fallbackUsages = usageList.length > 0 ? [] : [streamUsage];
  const sourceUsages = messageUsages.length > 0 ? messageUsages : fallbackUsages;
  const breakdownByModel = new Map();

  for (const usage of sourceUsages) {
    const usageModel = getUsageModel(usage, model);
    const key = usageModel || '__unknown__';
    const breakdown = breakdownByModel.get(key) ?? createUsageBreakdown({ model: usageModel });
    breakdownByModel.set(key, addUsage(breakdown, usage));
  }

  const modelBreakdowns = Array.from(breakdownByModel.values()).map(finalizeUsageBreakdown);
  const aggregateBreakdown = sumUsageBreakdowns(modelBreakdowns);

  return {
    ...aggregateBreakdown,
    modelBreakdowns,
  };
};

const buildRates = ({ modelInfo }) => {
  if (!modelInfo) {
    return null;
  }

  const inputCostPerToken = toOptionalNumber(modelInfo.input_cost_per_token);
  const cacheCreationInputTokenCost = toOptionalNumber(modelInfo.cache_creation_input_token_cost);
  const cacheReadInputTokenCost = toOptionalNumber(modelInfo.cache_read_input_token_cost);
  const outputCostPerToken = toOptionalNumber(modelInfo.output_cost_per_token);
  const outputCostPerReasoningToken =
    toOptionalNumber(modelInfo.output_cost_per_reasoning_token) ?? outputCostPerToken;

  if (
    inputCostPerToken == null &&
    cacheCreationInputTokenCost == null &&
    cacheReadInputTokenCost == null &&
    outputCostPerToken == null &&
    outputCostPerReasoningToken == null
  ) {
    return null;
  }

  return {
    input_cost_per_token: inputCostPerToken,
    cache_creation_input_token_cost: cacheCreationInputTokenCost,
    cache_read_input_token_cost: cacheReadInputTokenCost,
    output_cost_per_token: outputCostPerToken,
    output_cost_per_reasoning_token: outputCostPerReasoningToken,
  };
};

const buildCosts = ({ breakdown, rates }) => {
  if (!rates) {
    return null;
  }

  const inputRate = toNonNegativeNumber(rates.input_cost_per_token);
  const cacheCreationRate = toNonNegativeNumber(rates.cache_creation_input_token_cost ?? inputRate);
  const cacheReadRate = toNonNegativeNumber(rates.cache_read_input_token_cost ?? inputRate);
  const inputCost =
    breakdown.effectiveInputTokens * inputRate +
    breakdown.cacheCreationTokens * cacheCreationRate +
    breakdown.cacheReadTokens * cacheReadRate;
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

const buildCostSnapshot = ({ model, breakdown, modelInfoMap }) => {
  const modelCosts = [];
  const aggregateCosts = { input: 0, output: 0, reasoning: 0, total: 0 };
  const fallbackRates = buildRates({ modelInfo: modelInfoMap?.[model] });
  let singleModelRates = null;

  for (const modelBreakdown of breakdown.modelBreakdowns ?? [breakdown]) {
    const rates =
      buildRates({ modelInfo: modelInfoMap?.[modelBreakdown.model] }) ??
      (!modelBreakdown.model ? fallbackRates : null);
    const costs = buildCosts({ breakdown: modelBreakdown, rates });
    if (!costs) {
      return {
        costs: null,
        modelCosts: [],
        rates: (breakdown.modelBreakdowns ?? [breakdown]).length === 1 ? fallbackRates : null,
      };
    }

    aggregateCosts.input += costs.input;
    aggregateCosts.output += costs.output;
    aggregateCosts.reasoning += costs.reasoning;
    aggregateCosts.total += costs.total;
    singleModelRates = rates;
    modelCosts.push({
      ...(modelBreakdown.model ? { model: modelBreakdown.model } : {}),
      input_tokens: modelBreakdown.inputTokens,
      output_tokens: modelBreakdown.outputTokens,
      ...(modelBreakdown.cacheCreationTokens > 0
        ? { cache_creation_input_tokens: modelBreakdown.cacheCreationTokens }
        : {}),
      ...(modelBreakdown.cacheReadTokens > 0
        ? { cache_read_input_tokens: modelBreakdown.cacheReadTokens }
        : {}),
      ...(modelBreakdown.reasoningTokens > 0
        ? { reasoning_tokens: modelBreakdown.reasoningTokens }
        : {}),
      costs,
    });
  }

  return {
    costs: aggregateCosts,
    modelCosts,
    rates: modelCosts.length === 1 ? singleModelRates : null,
  };
};

const buildUsageSnapshot = ({ breakdown, model, rates, costs, modelCosts }) => ({
  version: 2,
  input_tokens: breakdown.inputTokens,
  output_tokens: breakdown.outputTokens,
  ...(breakdown.cacheCreationTokens > 0
    ? { cache_creation_input_tokens: breakdown.cacheCreationTokens }
    : {}),
  ...(breakdown.cacheReadTokens > 0 ? { cache_read_input_tokens: breakdown.cacheReadTokens } : {}),
  ...(breakdown.reasoningTokens > 0 ? { reasoning_tokens: breakdown.reasoningTokens } : {}),
  ...(model ? { model } : {}),
  ...(rates ? { rates } : {}),
  ...(costs ? { costs } : {}),
  ...(Array.isArray(modelCosts) && modelCosts.length > 1 ? { model_costs: modelCosts } : {}),
  currency: 'USD',
  calculated_at: new Date().toISOString(),
});

async function syncResponseUsage({ client, response, req, persist = false }) {
  const streamUsage = client?.getStreamUsage?.();
  if (!streamUsage || !response) {
    return response;
  }
  const model = response.model || response?.metadata?.model;

  const breakdown = buildUsageBreakdown({
    streamUsage,
    collectedUsage: client?.collectedUsage,
    model,
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

  response.metadata = {
    ...(response.metadata ?? {}),
    forked_litellm_usage: buildUsageSnapshot({ breakdown, model }),
  };

  if (!persist || !req) {
    return response;
  }

  let rates = null;
  let costs = null;
  let modelCosts = [];
  if (model || breakdown.modelBreakdowns.some((modelBreakdown) => modelBreakdown.model)) {
    const modelInfoMap = await getLiteLLMModelInfoMap();
    const costSnapshot = buildCostSnapshot({ model, breakdown, modelInfoMap });
    rates = costSnapshot.rates;
    costs = costSnapshot.costs;
    modelCosts = costSnapshot.modelCosts;
  }

  response.metadata = {
    ...(response.metadata ?? {}),
    forked_litellm_usage: buildUsageSnapshot({ breakdown, model, rates, costs, modelCosts }),
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

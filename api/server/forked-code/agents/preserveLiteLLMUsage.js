const { logger } = require('@librechat/data-schemas');

const hasUsageValue = (value) => value != null && Number.isFinite(Number(value));
const isPositiveUsageValue = (value) => hasUsageValue(value) && Number(value) > 0;

const getRawUsageMultiplier = (usage, rawUsage) => {
  const comparableCounts = [
    [usage?.input_tokens, rawUsage?.prompt_tokens],
    [usage?.output_tokens, rawUsage?.completion_tokens],
    [usage?.total_tokens, rawUsage?.total_tokens],
  ].filter(([currentValue, rawValue]) => {
    return isPositiveUsageValue(currentValue) && isPositiveUsageValue(rawValue);
  });

  if (comparableCounts.length < 2) {
    return 1;
  }

  const multiplier = Number(comparableCounts[0][1]) / Number(comparableCounts[0][0]);
  if (!Number.isInteger(multiplier) || multiplier < 2) {
    return 1;
  }

  return comparableCounts.every(
    ([currentValue, rawValue]) => Number(rawValue) === Number(currentValue) * multiplier,
  )
    ? multiplier
    : 1;
};

const divideNumericUsageValues = (value, divisor) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value / divisor;
  }
  if (Array.isArray(value)) {
    return value.map((nestedValue) => divideNumericUsageValues(nestedValue, divisor));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        divideNumericUsageValues(nestedValue, divisor),
      ]),
    );
  }
  return value;
};

const normalizeRawUsage = (usage, rawUsage) => {
  const multiplier = getRawUsageMultiplier(usage, rawUsage);
  if (multiplier > 1) {
    logger.debug('[preserveLiteLLMUsage] Normalized duplicated raw stream usage', {
      multiplier,
    });
  }
  return {
    multiplier,
    usage: multiplier > 1 ? divideNumericUsageValues(rawUsage, multiplier) : rawUsage,
  };
};

const isLiteLLMEndpoint = (endpoint) =>
  typeof endpoint === 'string' && endpoint.toLowerCase().includes('litellm');

const isLiteLLMContext = (agentContext, options = {}) =>
  isLiteLLMEndpoint(options.endpoint) ||
  isLiteLLMEndpoint(agentContext?.endpoint) ||
  isLiteLLMEndpoint(agentContext?.agent?.endpoint) ||
  isLiteLLMEndpoint(agentContext?.clientOptions?.endpoint);

const getRawCacheReadTokens = (rawUsage) =>
  rawUsage?.input_token_details?.cache_read ??
  rawUsage?.prompt_tokens_details?.cached_tokens ??
  rawUsage?.cache_read_input_tokens;

const getRawCacheCreationTokens = (rawUsage) =>
  rawUsage?.input_token_details?.cache_creation ??
  rawUsage?.prompt_tokens_details?.cache_creation_tokens ??
  rawUsage?.prompt_tokens_details?.cache_write_tokens ??
  rawUsage?.cache_creation_input_tokens;

const getRawReasoningTokens = (rawUsage) =>
  rawUsage?.completion_tokens_details?.reasoning_tokens ??
  rawUsage?.output_token_details?.reasoning ??
  rawUsage?.output_token_details?.reasoning_tokens;

const toUsageNumber = (value) => (hasUsageValue(value) ? Number(value) : null);

const getComparableUsageCounts = (usage, rawUsage) => ({
  current: {
    input: toUsageNumber(usage?.input_tokens),
    output: toUsageNumber(usage?.output_tokens),
    total: toUsageNumber(usage?.total_tokens),
  },
  raw: {
    input: toUsageNumber(rawUsage?.prompt_tokens),
    output: toUsageNumber(rawUsage?.completion_tokens),
    total: toUsageNumber(rawUsage?.total_tokens),
  },
});

const hasCompleteCounts = ({ input, output, total }) =>
  isPositiveUsageValue(input) &&
  isPositiveUsageValue(output) &&
  isPositiveUsageValue(total) &&
  total === input + output;

const availableRawCountsMatch = ({ current, raw }) =>
  Object.keys(raw).every((key) => {
    return !isPositiveUsageValue(raw[key]) || current[key] === raw[key];
  });

const isReasoningInclusiveRepair = (usage, rawUsage, counts) => {
  const reasoningTokens = Number(
    usage?.output_token_details?.reasoning ??
      usage?.output_token_details?.reasoning_tokens ??
      getRawReasoningTokens(rawUsage),
  );

  return (
    isPositiveUsageValue(reasoningTokens) &&
    hasCompleteCounts(counts.current) &&
    hasCompleteCounts(counts.raw) &&
    counts.current.input === counts.raw.input &&
    counts.current.output + reasoningTokens === counts.raw.output
  );
};

const shouldTrustRawUsage = (usage, rawUsage, multiplier) => {
  if (multiplier > 1) {
    return true;
  }

  const counts = getComparableUsageCounts(usage, rawUsage);
  const currentComplete = hasCompleteCounts(counts.current);

  if (!currentComplete) {
    return true;
  }
  if (availableRawCountsMatch(counts)) {
    return true;
  }
  if (isReasoningInclusiveRepair(usage, rawUsage, counts)) {
    return true;
  }

  logger.warn('[preserveLiteLLMUsage] Ignored inconsistent raw stream usage', {
    normalized: counts.current,
    raw: counts.raw,
  });
  return false;
};

const mergeRawCount = (currentValue, rawValue, trustRawUsage) => {
  if (!isPositiveUsageValue(rawValue)) {
    return currentValue;
  }
  if (!isPositiveUsageValue(currentValue) || trustRawUsage) {
    return rawValue;
  }
  return currentValue;
};

const mergeOpenAICompatibleUsage = (usage, rawUsage) => {
  if (!rawUsage || typeof rawUsage !== 'object') {
    return usage;
  }

  // LangChain adds numeric response metadata when provider and synthetic usage chunks are merged.
  const normalized = normalizeRawUsage(usage, rawUsage);
  const normalizedRawUsage = normalized.usage;
  const trustRawUsage = shouldTrustRawUsage(usage, normalizedRawUsage, normalized.multiplier);
  const merged = { ...(usage ?? {}) };
  merged.input_tokens = mergeRawCount(
    merged.input_tokens,
    normalizedRawUsage.prompt_tokens,
    trustRawUsage,
  );
  merged.output_tokens = mergeRawCount(
    merged.output_tokens,
    normalizedRawUsage.completion_tokens,
    trustRawUsage,
  );
  merged.total_tokens = mergeRawCount(
    merged.total_tokens,
    normalizedRawUsage.total_tokens,
    trustRawUsage,
  );

  if (!trustRawUsage) {
    return merged;
  }

  if (normalizedRawUsage.prompt_tokens_details != null) {
    merged.prompt_tokens_details = {
      ...normalizedRawUsage.prompt_tokens_details,
      ...(merged.prompt_tokens_details ?? {}),
    };
  }
  if (normalizedRawUsage.completion_tokens_details != null) {
    merged.completion_tokens_details = {
      ...normalizedRawUsage.completion_tokens_details,
      ...(merged.completion_tokens_details ?? {}),
    };
  }

  const cacheRead = getRawCacheReadTokens(normalizedRawUsage);
  const cacheCreation = getRawCacheCreationTokens(normalizedRawUsage);
  if (isPositiveUsageValue(cacheRead) || isPositiveUsageValue(cacheCreation)) {
    merged.input_token_details = {
      ...(merged.input_token_details ?? {}),
      ...(isPositiveUsageValue(cacheCreation) ? { cache_creation: cacheCreation } : {}),
      ...(isPositiveUsageValue(cacheRead) ? { cache_read: cacheRead } : {}),
    };
  }
  return merged;
};

const preserveLiteLLMUsage = (eventHandlers, options = {}) => {
  if (!eventHandlers || typeof eventHandlers !== 'object') {
    return;
  }

  const modelEndHandler = Object.values(eventHandlers).find(
    (handler) => handler?.constructor?.name === 'ModelEndHandler',
  );
  if (!modelEndHandler || modelEndHandler.__forkedPreservesLiteLLMUsage) {
    return;
  }

  const originalHandle = modelEndHandler.handle.bind(modelEndHandler);
  modelEndHandler.handle = async (event, data, metadata, graph) => {
    try {
      const agentContext = graph?.getAgentContext?.(metadata);
      if (
        isLiteLLMContext(agentContext, options) &&
        data?.output?.response_metadata?.usage != null
      ) {
        data.output.usage_metadata = mergeOpenAICompatibleUsage(
          data.output.usage_metadata,
          data.output.response_metadata.usage,
        );
      }
    } catch {
      // getAgentContext throws on missing metadata/node/context; defer to the
      // original handler, which performs the same lookup inside its own guard.
    }
    return originalHandle(event, data, metadata, graph);
  };
  modelEndHandler.__forkedPreservesLiteLLMUsage = true;
};

module.exports = {
  mergeOpenAICompatibleUsage,
  preserveLiteLLMUsage,
};

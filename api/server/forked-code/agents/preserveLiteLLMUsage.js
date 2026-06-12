const hasUsageValue = (value) => value != null && Number.isFinite(Number(value));
const isPositiveUsageValue = (value) => hasUsageValue(value) && Number(value) > 0;

const shouldUseRawCount = (currentValue, rawValue) =>
  isPositiveUsageValue(rawValue) &&
  (!isPositiveUsageValue(currentValue) || Number(currentValue) !== Number(rawValue));

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

const mergeOpenAICompatibleUsage = (usage, rawUsage) => {
  if (!rawUsage || typeof rawUsage !== 'object') {
    return usage;
  }

  const merged = { ...(usage ?? {}) };
  if (shouldUseRawCount(merged.input_tokens, rawUsage.prompt_tokens)) {
    merged.input_tokens = rawUsage.prompt_tokens;
  }
  if (shouldUseRawCount(merged.output_tokens, rawUsage.completion_tokens)) {
    merged.output_tokens = rawUsage.completion_tokens;
  }
  if (shouldUseRawCount(merged.total_tokens, rawUsage.total_tokens)) {
    merged.total_tokens = rawUsage.total_tokens;
  }
  if (merged.prompt_tokens_details == null && rawUsage.prompt_tokens_details != null) {
    merged.prompt_tokens_details = rawUsage.prompt_tokens_details;
  }
  if (merged.completion_tokens_details == null && rawUsage.completion_tokens_details != null) {
    merged.completion_tokens_details = rawUsage.completion_tokens_details;
  }

  const cacheRead = getRawCacheReadTokens(rawUsage);
  const cacheCreation = getRawCacheCreationTokens(rawUsage);
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

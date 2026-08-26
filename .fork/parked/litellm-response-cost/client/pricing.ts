export type LiteLLMRates = {
  input_cost_per_token?: number | null;
  cache_creation_input_token_cost?: number | null;
  cache_read_input_token_cost?: number | null;
  output_cost_per_token?: number | null;
  output_cost_per_reasoning_token?: number | null;
};

export type LiteLLMCosts = {
  input?: number;
  output?: number;
  reasoning?: number;
  total?: number;
};

export type LiteLLMUsageSnapshot = {
  version?: number;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  reasoning_tokens?: number;
  rates?: LiteLLMRates;
  costs?: LiteLLMCosts;
  currency?: string;
  calculated_at?: string;
};

export type CostBreakdown = {
  model?: string;
  currency: string;
  lockedRates: boolean;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  effectiveInputTokens: number;
  effectiveOutputTokens: number;
  inputCost: number;
  outputCost: number;
  reasoningCost: number;
  totalCost: number;
  inputRatePerMillion: number;
  outputRatePerMillion: number;
};

export const toPositiveNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const toNonNegativeNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

export const buildBreakdownFromRates = ({
  model,
  inputTokens,
  outputTokens,
  cacheCreationTokens = 0,
  cacheReadTokens = 0,
  reasoningTokens,
  rates,
  lockedRates,
}: {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  reasoningTokens: number | null;
  rates: LiteLLMRates;
  lockedRates: boolean;
}): CostBreakdown => {
  const cappedReasoningTokens =
    reasoningTokens != null ? Math.min(outputTokens, reasoningTokens) : null;
  const effectiveOutputTokens = Math.max(0, outputTokens - (cappedReasoningTokens ?? 0));

  const inputRate = toNonNegativeNumber(rates.input_cost_per_token);
  const cacheCreationRate = toNonNegativeNumber(rates.cache_creation_input_token_cost ?? inputRate);
  const cacheReadRate = toNonNegativeNumber(rates.cache_read_input_token_cost ?? inputRate);
  const outputRate = toNonNegativeNumber(rates.output_cost_per_token);
  const reasoningRate = toNonNegativeNumber(rates.output_cost_per_reasoning_token ?? outputRate);

  const nonCachedInputTokens = Math.max(0, inputTokens - cacheCreationTokens - cacheReadTokens);
  const inputCost =
    nonCachedInputTokens * inputRate +
    cacheCreationTokens * cacheCreationRate +
    cacheReadTokens * cacheReadRate;
  const outputCost = effectiveOutputTokens * outputRate;
  const reasoningCost = (cappedReasoningTokens ?? 0) * reasoningRate;
  const totalCost = inputCost + outputCost + reasoningCost;

  return {
    model,
    currency: 'USD',
    lockedRates,
    inputTokens,
    outputTokens,
    reasoningTokens: cappedReasoningTokens,
    effectiveInputTokens: inputTokens,
    effectiveOutputTokens,
    inputCost,
    outputCost,
    reasoningCost,
    totalCost,
    inputRatePerMillion: inputTokens > 0 ? (inputCost / inputTokens) * 1_000_000 : 0,
    outputRatePerMillion: outputRate * 1_000_000,
  };
};

export const buildBreakdownFromModelInfo = ({
  model,
  inputTokens,
  outputTokens,
  cacheCreationTokens,
  cacheReadTokens,
  reasoningTokens,
  modelInfo,
  lockedRates,
}: {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  reasoningTokens: number | null;
  modelInfo: {
    input_cost_per_token?: number | null;
    cache_creation_input_token_cost?: number | null;
    cache_read_input_token_cost?: number | null;
    output_cost_per_token?: number | null;
    output_cost_per_reasoning_token?: number | null;
  };
  lockedRates: boolean;
}): CostBreakdown =>
  buildBreakdownFromRates({
    model,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    reasoningTokens,
    rates: {
      input_cost_per_token: modelInfo.input_cost_per_token ?? 0,
      cache_creation_input_token_cost: modelInfo.cache_creation_input_token_cost,
      cache_read_input_token_cost: modelInfo.cache_read_input_token_cost,
      output_cost_per_token: modelInfo.output_cost_per_token ?? 0,
      output_cost_per_reasoning_token:
        modelInfo.output_cost_per_reasoning_token ?? modelInfo.output_cost_per_token,
    },
    lockedRates,
  });

export const buildBreakdownFromSnapshot = ({
  model,
  usage,
}: {
  model?: string;
  usage: LiteLLMUsageSnapshot;
}): CostBreakdown | null => {
  const inputTokens = toPositiveNumber(usage.input_tokens);
  const outputTokens = toPositiveNumber(usage.output_tokens);
  const cacheCreationTokens = toPositiveNumber(usage.cache_creation_input_tokens);
  const cacheReadTokens = toPositiveNumber(usage.cache_read_input_tokens);
  const reasoningTokens =
    usage.reasoning_tokens != null ? toNonNegativeNumber(usage.reasoning_tokens) : null;

  const costs = usage.costs ?? null;
  if (costs && typeof costs.total === 'number') {
    const cappedReasoningTokens =
      reasoningTokens != null ? Math.min(outputTokens, reasoningTokens) : null;
    const effectiveOutputTokens = Math.max(0, outputTokens - (cappedReasoningTokens ?? 0));
    const inputCostVal = toNonNegativeNumber(costs.input);
    const outputCostVal = toNonNegativeNumber(costs.output);

    return {
      model: usage.model || model,
      currency: usage.currency || 'USD',
      lockedRates: true,
      inputTokens,
      outputTokens,
      reasoningTokens: cappedReasoningTokens,
      effectiveInputTokens: inputTokens,
      effectiveOutputTokens,
      inputCost: inputCostVal,
      outputCost: outputCostVal,
      reasoningCost: toNonNegativeNumber(costs.reasoning),
      totalCost: toNonNegativeNumber(costs.total),
      inputRatePerMillion: inputTokens > 0 ? (inputCostVal / inputTokens) * 1_000_000 : 0,
      outputRatePerMillion:
        effectiveOutputTokens > 0 ? (outputCostVal / effectiveOutputTokens) * 1_000_000 : 0,
    };
  }

  const rates = usage.rates ?? null;
  if (rates) {
    return buildBreakdownFromRates({
      model: usage.model || model,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      reasoningTokens,
      rates,
      lockedRates: true,
    });
  }

  return null;
};

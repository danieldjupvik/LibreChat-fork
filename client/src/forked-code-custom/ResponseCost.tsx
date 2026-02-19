import { memo, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import type { TMessage, TConversation } from 'librechat-data-provider';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import {
  OGDialog,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
  Dropdown,
  Clipboard,
  CheckMark,
  TooltipAnchor,
} from '@librechat/client';
import { DollarSign } from 'lucide-react';
import copy from 'copy-to-clipboard';
import { fetchUsdToNokRate } from './currencyAdapter';
import { fetchLiteLLMModelInfo, fetchCostMargin } from './litellmInfoAdapter';
import { useGetStartupConfig } from '~/data-provider';
import { cn } from '../utils';

type LiteLLMRates = {
  input_cost_per_token?: number | null;
  output_cost_per_token?: number | null;
  output_cost_per_reasoning_token?: number | null;
};

type LiteLLMCosts = {
  input?: number;
  output?: number;
  reasoning?: number;
  total?: number;
};

type LiteLLMUsageSnapshot = {
  version?: number;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  rates?: LiteLLMRates;
  costs?: LiteLLMCosts;
  currency?: string;
  calculated_at?: string;
};

interface MessageWithTokens extends TMessage {
  tokenCount?: number;
  promptTokens?: number;
  metadata?: {
    model?: string;
    forked_litellm_usage?: LiteLLMUsageSnapshot;
  };
}

type CostBreakdown = {
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

type ResponseCostProps = {
  message: TMessage;
  conversation: TConversation | null;
  isLast: boolean;
};

type SupportedCurrency = 'USD' | 'NOK';

const DISPLAY_CURRENCY_OPTIONS: SupportedCurrency[] = ['NOK', 'USD'];

const UI_TEXT = {
  dialogTitle: 'Cost breakdown',
  model: 'Model',
  currency: 'Currency',
  rates: 'Rates',
  lockedRates: 'Exact cost',
  liveRates: 'Estimated cost',
  fallbackCurrency: 'Live NOK rate unavailable. Showing USD values.',
  unknownModel: 'Unknown model',
  total: 'Total',
  input: 'Input',
  output: 'Output',
  reasoning: 'Reasoning',
  tokens: 'tokens',
  perMillionTokens: '/ 1M tokens',
  totalTokens: 'Total tokens',
  inputTokens: 'Input tokens',
  outputTokens: 'Output tokens',
  messagesPerUnit: 'messages like this per',
  claudeComparisonPrefix: 'Same message on',
  claudeComparisonMiddle: 'would cost',
  claudeComparisonSuffix: 'x more',
  costSection: 'Cost details',
};

const toPositiveNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const toNonNegativeNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const formatCompactCost = (value: number) => {
  if (value < 0.01) return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (value < 0.1) return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
};

const formatPreciseCost = (value: number) => value.toFixed(8);

const formatTokens = (count: number) => {
  if (count < 10_000) return count.toLocaleString();
  if (count < 1_000_000) {
    const k = count / 1_000;
    return k % 1 === 0 ? `${k}K` : `${k.toFixed(1).replace(/\.0$/, '')}K`;
  }
  const m = count / 1_000_000;
  return m % 1 === 0 ? `${m}M` : `${m.toFixed(1).replace(/\.0$/, '')}M`;
};

const normalizeCurrency = (currency?: string): SupportedCurrency =>
  currency?.toUpperCase() === 'NOK' ? 'NOK' : 'USD';

const convertCurrency = ({
  amount,
  from,
  to,
  usdToNokRate,
}: {
  amount: number;
  from: SupportedCurrency;
  to: SupportedCurrency;
  usdToNokRate: number | null;
}) => {
  if (from === to) {
    return amount;
  }

  if (usdToNokRate == null || usdToNokRate <= 0) {
    return amount;
  }

  if (from === 'USD' && to === 'NOK') {
    return amount * usdToNokRate;
  }

  if (from === 'NOK' && to === 'USD') {
    return amount / usdToNokRate;
  }

  return amount;
};

const formatCurrencyValue = (value: number, currency: SupportedCurrency, precise = false) => {
  const prefix = currency === 'NOK' ? 'NOK ' : '$';
  const formatted = precise ? formatPreciseCost(value) : formatCompactCost(value);
  return `${prefix}${formatted}`;
};

const formatRate = (perMillion: number, currency: SupportedCurrency) => {
  const prefix = currency === 'NOK' ? 'NOK ' : '$';
  if (perMillion === 0) return `${prefix}0`;
  if (perMillion < 0.01) return `${prefix}${perMillion.toFixed(4)}`;
  if (perMillion < 1) {
    return `${prefix}${perMillion.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`;
  }
  return `${prefix}${perMillion.toFixed(2)}`;
};

const CLAUDE_COMPARISON = {
  label: 'Claude Opus 4.6',
  keys: ['claude-opus-4-6', 'anthropic/claude-opus-4-6'],
  fallbackInputPerToken: 5 / 1_000_000,
  fallbackOutputPerToken: 25 / 1_000_000,
};

type ComparisonRates = {
  inputPerToken: number;
  outputPerToken: number;
} | null;

const findClaudeRates = (
  modelInfoMap: Record<string, { input_cost_per_token?: number; output_cost_per_token?: number }>,
): ComparisonRates => {
  for (const key of CLAUDE_COMPARISON.keys) {
    const info = modelInfoMap[key];
    if (info?.input_cost_per_token != null && info?.output_cost_per_token != null) {
      return {
        inputPerToken: info.input_cost_per_token,
        outputPerToken: info.output_cost_per_token,
      };
    }
  }

  const opusEntry = Object.entries(modelInfoMap).find(([k]) =>
    k.toLowerCase().includes('claude-opus-4'),
  );
  if (opusEntry?.[1]?.input_cost_per_token != null && opusEntry[1]?.output_cost_per_token != null) {
    return {
      inputPerToken: opusEntry[1].input_cost_per_token,
      outputPerToken: opusEntry[1].output_cost_per_token,
    };
  }

  return {
    inputPerToken: CLAUDE_COMPARISON.fallbackInputPerToken,
    outputPerToken: CLAUDE_COMPARISON.fallbackOutputPerToken,
  };
};

const buildBreakdownFromRates = ({
  model,
  inputTokens,
  outputTokens,
  reasoningTokens,
  rates,
  lockedRates,
}: {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  rates: LiteLLMRates;
  lockedRates: boolean;
}): CostBreakdown => {
  const cappedReasoningTokens =
    reasoningTokens != null ? Math.min(outputTokens, reasoningTokens) : null;
  const effectiveOutputTokens = Math.max(0, outputTokens - (cappedReasoningTokens ?? 0));

  const inputRate = toNonNegativeNumber(rates.input_cost_per_token);
  const outputRate = toNonNegativeNumber(rates.output_cost_per_token);
  const reasoningRate = toNonNegativeNumber(rates.output_cost_per_reasoning_token || outputRate);

  const inputCost = inputTokens * inputRate;
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
    inputRatePerMillion: inputRate * 1_000_000,
    outputRatePerMillion: outputRate * 1_000_000,
  };
};

const buildBreakdownFromSnapshot = ({
  model,
  usage,
}: {
  model?: string;
  usage: LiteLLMUsageSnapshot;
}): CostBreakdown | null => {
  const inputTokens = toPositiveNumber(usage.input_tokens);
  const outputTokens = toPositiveNumber(usage.output_tokens);
  const reasoningTokens =
    usage.reasoning_tokens != null ? toNonNegativeNumber(usage.reasoning_tokens) : null;

  const rates = usage.rates ?? null;
  if (rates) {
    return buildBreakdownFromRates({
      model: usage.model || model,
      inputTokens,
      outputTokens,
      reasoningTokens,
      rates,
      lockedRates: true,
    });
  }

  const costs = usage.costs ?? null;
  if (!costs || typeof costs.total !== 'number') {
    return null;
  }

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
};

const ResponseCost = ({ message, conversation, isLast }: ResponseCostProps) => {
  const [breakdown, setBreakdown] = useState<CostBreakdown | null>(null);
  const [claudeRates, setClaudeRates] = useState<ComparisonRates>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [displayCurrencyPreference, setDisplayCurrencyPreference] =
    useState<SupportedCurrency>('USD');
  const [usdToNokRate, setUsdToNokRate] = useState<number | null>(null);
  const [costMargin, setCostMargin] = useState(0);
  const calculationComplete = useRef(false);
  const { data: startupConfig } = useGetStartupConfig();
  const queryClient = useQueryClient();

  const threadInfo = useMemo(() => {
    const convoId = conversation?.conversationId;
    if (!convoId) return null;
    const messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, convoId]);
    if (!messages?.length) return null;

    const byId = new Map(messages.map((m) => [m.messageId, m]));
    const visited = new Set<string>();
    let aiPosition = 0;
    let current: TMessage | undefined = byId.get(message.messageId);
    while (current && !visited.has(current.messageId)) {
      visited.add(current.messageId);
      if (!current.isCreatedByUser) {
        aiPosition++;
      }
      current = current.parentMessageId ? byId.get(current.parentMessageId) : undefined;
    }

    const totalAiMessages = messages.filter((m) => !m.isCreatedByUser).length;

    return { position: aiPosition, totalAi: totalAiMessages, total: messages.length };
  }, [conversation?.conversationId, message.messageId, queryClient]);

  useEffect(() => {
    let isMounted = true;

    const getCurrencyRate = async () => {
      const rate = await fetchUsdToNokRate();
      if (isMounted) {
        setUsdToNokRate(rate);
      }
    };

    const getMargin = async () => {
      const margin = await fetchCostMargin();
      if (isMounted) {
        setCostMargin(margin);
      }
    };

    getCurrencyRate();
    getMargin();

    return () => {
      isMounted = false;
    };
  }, []);

  const getTokenUsage = useCallback((msg: MessageWithTokens) => {
    const metadataUsage = msg.metadata?.forked_litellm_usage;
    const promptTokens =
      typeof msg.promptTokens === 'number' && msg.promptTokens > 0 ? msg.promptTokens : 0;
    const completionTokens =
      typeof msg.tokenCount === 'number' && msg.tokenCount > 0 ? msg.tokenCount : 0;
    const reasoningTokens =
      metadataUsage?.reasoning_tokens != null
        ? toNonNegativeNumber(metadataUsage.reasoning_tokens)
        : null;

    const metadataPromptTokens = toPositiveNumber(metadataUsage?.input_tokens);
    const metadataCompletionTokens = toPositiveNumber(metadataUsage?.output_tokens);

    return {
      promptTokens: metadataPromptTokens || promptTokens,
      completionTokens: metadataCompletionTokens || completionTokens,
      reasoningTokens,
      snapshot: metadataUsage,
    };
  }, []);

  const shouldShowCost = useCallback(() => {
    if (message.isCreatedByUser) {
      return false;
    }
    const msg = message as MessageWithTokens;
    const usage = getTokenUsage(msg);
    return usage.promptTokens > 0 || usage.completionTokens > 0;
  }, [message, getTokenUsage]);

  const getMessageModel = useCallback((msg: TMessage): string | undefined => {
    if (msg.model) {
      return msg.model;
    }
    if ((msg as { model_name?: string }).model_name) {
      return (msg as { model_name?: string }).model_name;
    }
    const msgAny = msg as MessageWithTokens;
    if (msgAny.metadata?.model) {
      return msgAny.metadata.model;
    }
    return undefined;
  }, []);

  const getFriendlyModelName = useCallback(
    (model?: string) => {
      if (!model) {
        return undefined;
      }

      const modelSpecs = startupConfig?.modelSpecs?.list ?? [];
      const normalizedModel = model.toLowerCase();
      const modelWithoutProvider = normalizedModel.includes('/')
        ? normalizedModel.split('/').slice(-1)[0]
        : normalizedModel;

      const getNormalizedValues = (spec: {
        name?: string;
        preset?: {
          model?: string | null;
        };
      }) => {
        return [spec.name, spec.preset?.model]
          .filter((v): v is string => typeof v === 'string' && v.length > 0)
          .map((v) => v.toLowerCase());
      };

      const exact = modelSpecs.find((spec) => {
        const values = getNormalizedValues(spec);
        return values.includes(normalizedModel);
      });

      if (exact?.label) {
        return exact.label;
      }

      const suffixMatch = modelSpecs.find((spec) => {
        const values = getNormalizedValues(spec);
        return values.some((value) => {
          const suffix = value.includes('/') ? value.split('/').slice(-1)[0] : value;
          return suffix === modelWithoutProvider;
        });
      });

      if (suffixMatch?.label) {
        return suffixMatch.label;
      }

      if (conversation?.model === model && conversation?.modelLabel) {
        return conversation.modelLabel;
      }

      return undefined;
    },
    [startupConfig?.modelSpecs?.list, conversation?.model, conversation?.modelLabel],
  );

  useEffect(() => {
    calculationComplete.current = false;
    setBreakdown(null);
  }, [message.messageId, message.model]);

  useEffect(() => {
    if (!shouldShowCost() || !conversation?.endpoint) {
      return;
    }
    if (calculationComplete.current) {
      return;
    }

    let isMounted = true;

    const calculateCost = async () => {
      try {
        const msg = message as MessageWithTokens;
        const messageModel = getMessageModel(message);
        const usage = getTokenUsage(msg);

        if (usage.promptTokens <= 0 && usage.completionTokens <= 0) {
          if (isMounted) {
            calculationComplete.current = true;
          }
          return;
        }

        const modelInfoMap = await fetchLiteLLMModelInfo();

        if (isMounted) {
          setClaudeRates(findClaudeRates(modelInfoMap));
        }

        if (usage.snapshot) {
          const snapshotBreakdown = buildBreakdownFromSnapshot({
            model: messageModel,
            usage: usage.snapshot,
          });
          if (snapshotBreakdown && isMounted) {
            setBreakdown(snapshotBreakdown);
            calculationComplete.current = true;
            return;
          }
        }

        if (!messageModel) {
          if (isMounted) {
            calculationComplete.current = true;
          }
          return;
        }

        const modelInfo = modelInfoMap[messageModel];

        if (!modelInfo) {
          if (isMounted) {
            calculationComplete.current = true;
          }
          return;
        }

        const fallbackBreakdown = buildBreakdownFromRates({
          model: messageModel,
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
          reasoningTokens: usage.reasoningTokens,
          rates: {
            input_cost_per_token: modelInfo.input_cost_per_token ?? 0,
            output_cost_per_token: modelInfo.output_cost_per_token ?? 0,
            output_cost_per_reasoning_token:
              (modelInfo as { output_cost_per_reasoning_token?: number })
                .output_cost_per_reasoning_token ?? modelInfo.output_cost_per_token,
          },
          lockedRates: false,
        });

        if (isMounted && fallbackBreakdown.totalCost > 0) {
          setBreakdown(fallbackBreakdown);
        }
      } catch (error) {
        console.error('Error calculating response cost:', error);
      } finally {
        if (isMounted) {
          calculationComplete.current = true;
        }
      }
    };

    calculateCost();

    return () => {
      isMounted = false;
    };
  }, [
    message.messageId,
    message.model,
    conversation?.endpoint,
    message,
    shouldShowCost,
    getMessageModel,
    getTokenUsage,
  ]);

  const modelLabel = useMemo(
    () => getFriendlyModelName(breakdown?.model),
    [breakdown?.model, getFriendlyModelName],
  );

  const rows = useMemo(() => {
    if (!breakdown) {
      return [];
    }

    const data: Array<{ id: string; label: string; tokens: number; cost: number }> = [];

    if (breakdown.effectiveInputTokens > 0) {
      data.push({
        id: 'input',
        label: 'Input',
        tokens: breakdown.effectiveInputTokens,
        cost: breakdown.inputCost,
      });
    }

    if (breakdown.effectiveOutputTokens > 0) {
      data.push({
        id: 'output',
        label: 'Output',
        tokens: breakdown.effectiveOutputTokens,
        cost: breakdown.outputCost,
      });
    }

    if (breakdown.reasoningTokens != null && breakdown.reasoningTokens > 0) {
      data.push({
        id: 'reasoning',
        label: 'Reasoning',
        tokens: breakdown.reasoningTokens,
        cost: breakdown.reasoningCost,
      });
    }

    return data;
  }, [breakdown]);

  const formatTokenCount = useCallback((tokens: number) => {
    return `${formatTokens(tokens)} ${UI_TEXT.tokens}`;
  }, []);

  const baseCurrency = useMemo(() => normalizeCurrency(breakdown?.currency), [breakdown?.currency]);

  const displayCurrency = useMemo<SupportedCurrency>(() => {
    if (!breakdown) {
      return displayCurrencyPreference;
    }

    if (displayCurrencyPreference === baseCurrency) {
      return displayCurrencyPreference;
    }

    if (usdToNokRate != null && usdToNokRate > 0) {
      return displayCurrencyPreference;
    }

    return baseCurrency;
  }, [breakdown, baseCurrency, displayCurrencyPreference, usdToNokRate]);

  const convertForDisplay = useCallback(
    (value: number, fromCurrency = baseCurrency) =>
      convertCurrency({
        amount: value,
        from: fromCurrency,
        to: displayCurrency,
        usdToNokRate,
      }),
    [baseCurrency, displayCurrency, usdToNokRate],
  );

  const marginMultiplier = 1 + costMargin;

  const displayedTotalCost = useMemo(() => {
    if (!breakdown) {
      return 0;
    }
    return convertForDisplay(breakdown.totalCost * marginMultiplier, baseCurrency);
  }, [breakdown, baseCurrency, convertForDisplay, marginMultiplier]);

  const handleCurrencyPreferenceChange = useCallback((value: string) => {
    setDisplayCurrencyPreference(value === 'NOK' ? 'NOK' : 'USD');
  }, []);

  const handleCopyTotal = useCallback(() => {
    if (!breakdown) return;
    copy(formatCurrencyValue(displayedTotalCost, displayCurrency, true), {
      format: 'text/plain',
    });
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 3000);
  }, [breakdown, displayCurrency, displayedTotalCost]);

  const breakdownTotalInUsd = useMemo(() => {
    if (!breakdown) {
      return null;
    }
    return convertCurrency({
      amount: breakdown.totalCost * marginMultiplier,
      from: baseCurrency,
      to: 'USD',
      usdToNokRate,
    });
  }, [breakdown, baseCurrency, usdToNokRate, marginMultiplier]);

  const claudeCost = useMemo(() => {
    if (!breakdown || !claudeRates || breakdownTotalInUsd == null) return null;
    const cost =
      breakdown.inputTokens * claudeRates.inputPerToken +
      breakdown.outputTokens * claudeRates.outputPerToken;
    if (cost <= 0 || cost <= breakdownTotalInUsd) return null;
    return cost;
  }, [breakdown, claudeRates, breakdownTotalInUsd]);

  const displayedClaudeCost = useMemo(() => {
    if (claudeCost == null) {
      return null;
    }
    return convertCurrency({
      amount: claudeCost,
      from: 'USD',
      to: displayCurrency,
      usdToNokRate,
    });
  }, [claudeCost, displayCurrency, usdToNokRate]);

  const messagesPerUnit = useMemo(() => {
    if (!breakdown || breakdown.totalCost <= 0 || displayedTotalCost <= 0) return null;
    const count = Math.min(Math.floor(1 / displayedTotalCost), 1_000_000);
    return count >= 2 ? count : null;
  }, [breakdown, displayedTotalCost]);

  if (!shouldShowCost() || breakdown == null || breakdown.totalCost <= 0) {
    return null;
  }

  const compactCostDisplay = formatCurrencyValue(
    breakdown.totalCost * marginMultiplier,
    baseCurrency,
  );
  const unitLabel = displayCurrency === 'USD' ? '$1' : '1 NOK';
  const showingFallbackCurrency =
    displayCurrencyPreference === 'NOK' &&
    displayCurrency === 'USD' &&
    baseCurrency === 'USD' &&
    (usdToNokRate == null || usdToNokRate <= 0);
  const totalTokens = breakdown.inputTokens + breakdown.outputTokens;
  const hasReasoningTokens = breakdown.reasoningTokens != null && breakdown.reasoningTokens > 0;
  const tooltipText = `${compactCostDisplay} · ${formatTokens(totalTokens)} tokens (${formatTokens(breakdown.inputTokens)} in / ${formatTokens(breakdown.outputTokens)} out)`;

  return (
    <>
      <TooltipAnchor description={tooltipText} side="top">
        <button
          className={cn(
            'ml-0 flex items-center gap-1.5 rounded-md p-1 text-sm hover:bg-gray-100 hover:text-gray-500 focus:opacity-100 dark:text-gray-400/70 dark:hover:bg-gray-700 dark:hover:text-gray-200 disabled:dark:hover:text-gray-400 md:group-hover:visible md:group-[.final-completion]:visible',
            !isLast ? 'md:opacity-0 md:group-hover:opacity-100' : '',
          )}
          type="button"
          aria-label={tooltipText}
          onClick={() => setIsDialogOpen(true)}
        >
          <DollarSign size={15} className="hover:text-gray-500 dark:hover:text-gray-200" />
          <span>{compactCostDisplay}</span>
        </button>
      </TooltipAnchor>

      <OGDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <OGDialogContent
          className="w-11/12 max-w-lg gap-6"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <OGDialogHeader>
            <div className="flex items-baseline justify-between pr-6">
              <OGDialogTitle>{UI_TEXT.dialogTitle}</OGDialogTitle>
              {threadInfo != null && (
                <span className="text-xs font-normal text-text-secondary">
                  {isLast
                    ? `${threadInfo.totalAi} responses in thread`
                    : `Response ${threadInfo.position} of ${threadInfo.totalAi}`}
                </span>
              )}
            </div>
          </OGDialogHeader>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-text-primary">
              {modelLabel || breakdown.model || UI_TEXT.unknownModel}
            </span>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-border-light bg-surface-secondary px-2.5 py-1 text-xs text-text-secondary">
                {breakdown.lockedRates ? UI_TEXT.lockedRates : UI_TEXT.liveRates}
              </span>
              <Dropdown
                value={displayCurrencyPreference}
                onChange={handleCurrencyPreferenceChange}
                options={[...DISPLAY_CURRENCY_OPTIONS]}
                sizeClasses="min-w-[80px]"
                className="text-xs"
                portal={false}
              />
            </div>
          </div>

          {showingFallbackCurrency && (
            <div className="text-xs text-text-secondary">{UI_TEXT.fallbackCurrency}</div>
          )}

          {(breakdown.inputRatePerMillion > 0 || breakdown.outputRatePerMillion > 0) && (
            <div className="flex gap-3 text-xs text-text-secondary">
              {breakdown.inputRatePerMillion > 0 && (
                <span>
                  {`${UI_TEXT.input}: ${formatRate(convertForDisplay(breakdown.inputRatePerMillion, baseCurrency), displayCurrency)}`}
                  <span className="ml-0.5 opacity-60">{UI_TEXT.perMillionTokens}</span>
                </span>
              )}
              {breakdown.outputRatePerMillion > 0 && (
                <span>
                  {`${UI_TEXT.output}: ${formatRate(convertForDisplay(breakdown.outputRatePerMillion, baseCurrency), displayCurrency)}`}
                  <span className="ml-0.5 opacity-60">{UI_TEXT.perMillionTokens}</span>
                </span>
              )}
            </div>
          )}

          <div
            className={cn(
              'grid gap-3',
              hasReasoningTokens ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3',
            )}
          >
            <div className="rounded-lg border border-border-light bg-surface-secondary px-3 py-2.5">
              <div className="mb-1 text-xs text-text-secondary">{UI_TEXT.totalTokens}</div>
              <div className="font-mono text-sm">
                {formatTokens(breakdown.inputTokens + breakdown.outputTokens)}
              </div>
            </div>
            <div className="rounded-lg border border-border-light bg-surface-secondary px-3 py-2.5">
              <div className="mb-1 text-xs text-text-secondary">{UI_TEXT.inputTokens}</div>
              <div className="font-mono text-sm">{formatTokens(breakdown.inputTokens)}</div>
            </div>
            <div className="rounded-lg border border-border-light bg-surface-secondary px-3 py-2.5">
              <div className="mb-1 text-xs text-text-secondary">{UI_TEXT.outputTokens}</div>
              <div className="font-mono text-sm">
                {formatTokens(
                  hasReasoningTokens ? breakdown.effectiveOutputTokens : breakdown.outputTokens,
                )}
              </div>
            </div>
            {hasReasoningTokens && (
              <div className="rounded-lg border border-border-light bg-surface-secondary px-3 py-2.5">
                <div className="mb-1 text-xs text-text-secondary">{UI_TEXT.reasoning}</div>
                <div className="font-mono text-sm">
                  {formatTokens(breakdown.reasoningTokens ?? 0)}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between rounded-lg border border-border-light bg-surface-secondary px-4 py-3"
              >
                <div>
                  <span className="text-sm">{row.label}</span>
                  <span className="ml-2 font-mono text-xs text-text-secondary">
                    {formatTokenCount(row.tokens)}
                  </span>
                </div>
                <span className="font-mono text-sm">
                  {formatCurrencyValue(
                    convertForDisplay(row.cost * marginMultiplier, baseCurrency),
                    displayCurrency,
                    true,
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className="border-t border-border-light pt-4">
            {messagesPerUnit != null && (
              <div className="mb-3 text-xs text-text-secondary">
                {`~${messagesPerUnit.toLocaleString()} ${UI_TEXT.messagesPerUnit} ${unitLabel}`}
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-base font-semibold">{UI_TEXT.total}</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-semibold">
                  {formatCurrencyValue(displayedTotalCost, displayCurrency, true)}
                </span>
                <button
                  type="button"
                  className="rounded-md p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                  onClick={handleCopyTotal}
                  title={isCopied ? 'Copied' : 'Copy total'}
                >
                  {isCopied ? (
                    <CheckMark className="h-3.5 w-3.5" />
                  ) : (
                    <Clipboard className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {claudeCost != null &&
            displayedClaudeCost != null &&
            breakdownTotalInUsd != null &&
            breakdownTotalInUsd > 0 &&
            Math.round(claudeCost / breakdownTotalInUsd) >= 2 && (
              <div className="text-center text-xs italic text-text-secondary opacity-60">
                {`${UI_TEXT.claudeComparisonPrefix} ${CLAUDE_COMPARISON.label} ${UI_TEXT.claudeComparisonMiddle} ${formatCurrencyValue(displayedClaudeCost, displayCurrency)} (${Math.round(claudeCost / breakdownTotalInUsd)}${UI_TEXT.claudeComparisonSuffix})`}
              </div>
            )}
        </OGDialogContent>
      </OGDialog>
    </>
  );
};

export default memo(ResponseCost);

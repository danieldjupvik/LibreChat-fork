import { memo, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import type { TMessage, TConversation, TModelSpec } from 'librechat-data-provider';
import { TooltipAnchor } from '../components/ui/Tooltip';
import { DollarSign } from 'lucide-react';
import { findBestModelMatch, fetchPricingData } from './modelBadges';
import { cn } from '../utils';
import { useGetStartupConfig } from '../data-provider';

// Extend TMessage type to include token properties
interface MessageWithTokens extends TMessage {
  tokenCount?: number;
  promptTokens?: number;
}

type ResponseCostProps = {
  message: TMessage;
  conversation: TConversation | null;
  isLast: boolean;
};

// Cache for model pricing calculations to ensure consistent pricing display
const modelPricingCache = new Map<string, { cost: number | null; isFree: boolean }>();

const ResponseCost = ({ message, conversation, isLast }: ResponseCostProps) => {
  const [cost, setCost] = useState<number | null>(null);
  const [tokenInfo, setTokenInfo] = useState<{ totalTokens: number | null }>({ totalTokens: null });

  // Track if calculation is already complete
  const calculationComplete = useRef(false);

  // Get model specs from startup config
  const { data: startupConfig } = useGetStartupConfig();
  const modelSpecs = useMemo(() => startupConfig?.modelSpecs?.list || [], [startupConfig]);

  // Check if message should display cost (assistant message with token data)
  const shouldShowCost = useCallback(() => {
    if (message.isCreatedByUser) {
      return false;
    }

    const msgWithTokens = message as MessageWithTokens;
    return (
      (typeof msgWithTokens.promptTokens === 'number' && msgWithTokens.promptTokens > 0) ||
      (typeof msgWithTokens.tokenCount === 'number' && msgWithTokens.tokenCount > 0)
    );
  }, [message]);

  // Find model spec by name or spec identifier
  const findModelSpec = useCallback((modelName: string, specName?: string): TModelSpec | null => {
    if (!modelSpecs?.length) {
      return null;
    }

    // Try spec name first
    if (specName) {
      const bySpec = modelSpecs.find((spec) => spec.name === specName);
      if (bySpec) {
        return bySpec;
      }
    }

    // Then try model name
    return (
      modelSpecs.find((spec) => spec.preset?.model === modelName || spec.label === modelName) ||
      null
    );
  }, [modelSpecs]);

  // Get pricing from model spec
  const getPricingFromSpec = useCallback((modelName: string, specName?: string) => {
    const spec = findModelSpec(modelName, specName);

    if (!spec?.badges) {
      return {
        inputCostPerToken: null,
        outputCostPerToken: null,
        isFree: false,
      };
    }

    const { inputPrice, outputPrice, isFree = false } = spec.badges;

    // If explicitly marked as free
    if (isFree) {
      return {
        inputCostPerToken: 0,
        outputCostPerToken: 0,
        isFree: true,
      };
    }

    // Convert from per million tokens to per token
    const inputCostPerToken =
      inputPrice !== undefined && inputPrice !== null ? inputPrice / 1000000 : null;

    const outputCostPerToken =
      outputPrice !== undefined && outputPrice !== null ? outputPrice / 1000000 : null;

    // Check if zero/null prices (free)
    const isFreePricing =
      (inputCostPerToken === 0 || inputCostPerToken === null) &&
      (outputCostPerToken === 0 || outputCostPerToken === null);

    return {
      inputCostPerToken,
      outputCostPerToken,
      isFree: isFreePricing,
    };
  }, [findModelSpec]);

  // Calculate message cost
  useEffect(() => {
    // Skip calculations if not needed
    if (!shouldShowCost() || !conversation?.endpoint) {
      return;
    }
    if (calculationComplete.current) {
      return;
    }

    let isMounted = true;

    const calculateCost = async () => {
      try {
        // CRITICAL: Always use the message's original model
        const messageModel = message.model;

        // If this message doesn't have model information, we can't calculate cost
        if (!messageModel) {
          return;
        }

        // Create a unique key using message ID to ensure per-message cache
        const messageId = message.messageId;
        const cacheKey = messageId;

        // Check cache for existing calculation
        if (modelPricingCache.has(cacheKey)) {
          const cachedResult = modelPricingCache.get(cacheKey);
          if (cachedResult && isMounted) {
            setCost(cachedResult.cost);
            calculationComplete.current = true;
            return;
          }
        }

        // Get token count FROM THIS SPECIFIC MESSAGE
        const msgWithTokens = message as MessageWithTokens;
        const totalTokens = msgWithTokens.promptTokens || msgWithTokens.tokenCount || 0;

        // No tokens found for this message
        if (totalTokens <= 0) {
          modelPricingCache.set(cacheKey, { cost: null, isFree: true });

          if (isMounted) {
            calculationComplete.current = true;
          }
          return;
        }

        // Update token info for this message
        setTokenInfo({ totalTokens });

        // Get pricing info for THIS MESSAGE'S MODEL
        const specName = conversation.spec !== null ? conversation.spec : undefined;
        const { inputCostPerToken, outputCostPerToken, isFree } = getPricingFromSpec(
          messageModel,
          specName,
        );

        // Model is marked as free
        if (isFree) {
          modelPricingCache.set(cacheKey, { cost: 0, isFree: true });

          if (isMounted) {
            setCost(0);
            calculationComplete.current = true;
          }
          return;
        }

        // Use output cost from specs if available
        if (outputCostPerToken !== null) {
          const totalCost = totalTokens * outputCostPerToken;

          if (isMounted) {
            if (totalCost === 0) {
              modelPricingCache.set(cacheKey, { cost: 0, isFree: true });
              setCost(0);
            } else {
              modelPricingCache.set(cacheKey, { cost: totalCost, isFree: false });
              setCost(totalCost);
            }
            calculationComplete.current = true;
          }
          return;
        }

        // Fallback to LiteLLM pricing data for THIS MESSAGE'S MODEL
        const pricingData = await fetchPricingData();
        const modelMatch = findBestModelMatch(messageModel, pricingData);

        if (!modelMatch) {
          modelPricingCache.set(cacheKey, { cost: null, isFree: true });

          if (isMounted) {
            calculationComplete.current = true;
          }
          return;
        }

        // Calculate cost using LiteLLM data
        const costPerToken = modelMatch.data.output_cost_per_token || 0;

        // Zero cost model (free)
        if (costPerToken === 0) {
          modelPricingCache.set(cacheKey, { cost: 0, isFree: true });

          if (isMounted) {
            setCost(0);
            calculationComplete.current = true;
          }
          return;
        }

        // Calculate total cost FOR THIS SPECIFIC MESSAGE
        // using THIS MESSAGE'S token count and THIS MESSAGE'S model price
        const totalCost = totalTokens * costPerToken;

        if (isMounted) {
          if (totalCost > 0) {
            modelPricingCache.set(cacheKey, { cost: totalCost, isFree: false });
            setCost(totalCost);
          } else {
            modelPricingCache.set(cacheKey, { cost: 0, isFree: true });
            setCost(0);
          }
          calculationComplete.current = true;
        }
      } catch (error) {
        console.error('Error calculating response cost:', error);
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
    conversation?.spec,
    conversation?.endpoint,
    getPricingFromSpec,
    message,
    shouldShowCost,
  ]);

  // Don't render anything for free or missing cost
  if (!shouldShowCost() || cost === null || cost <= 0) {
    return null;
  }

  // Format the cost with appropriate decimal places
  const formattedCost =
    cost < 0.01
      ? cost.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
      : cost < 0.1
        ? cost.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
        : cost.toFixed(2);

  // Create tooltip text
  const tooltipText = tokenInfo.totalTokens
    ? `Cost: $${formattedCost} (${tokenInfo.totalTokens} tokens)`
    : `Cost: $${formattedCost}`;

  return (
    <button
      className={cn(
        'ml-0 flex items-center gap-1.5 rounded-md p-1 text-sm hover:bg-gray-100 hover:text-gray-500 focus:opacity-100 dark:text-gray-400/70 dark:hover:bg-gray-700 dark:hover:text-gray-200 disabled:dark:hover:text-gray-400 md:group-hover:visible md:group-[.final-completion]:visible',
        !isLast ? 'md:opacity-0 md:group-hover:opacity-100' : '',
      )}
      type="button"
      title={tooltipText}
    >
      <TooltipAnchor
        description={tooltipText}
        side="top"
        className="flex cursor-pointer items-center"
      >
        <DollarSign size={15} className="hover:text-gray-500 dark:hover:text-gray-200" />
        <span>{formattedCost}</span>
      </TooltipAnchor>
    </button>
  );
};

export default memo(ResponseCost);

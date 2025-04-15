import { useEffect, useState, memo, useMemo } from 'react';
import React from 'react';
import type { TModelSpec } from 'librechat-data-provider';
import { User, Server, Gift, Target } from 'lucide-react';
import { TooltipAnchor } from '../components/ui/Tooltip';
import { fetchModelInfo, LiteLLMModelInfo } from './litellmInfoAdapter';
import { useNewModelCheck } from './openRouterAdapter';

/**
 * Pricing data cache from LiteLLM
 */
let modelInfoCache: Record<string, LiteLLMModelInfo> | null = null;
let lastFetchTime = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Format price value for display (per million tokens)
 */
export const formatPrice = (value: number): string => {
  if (value === 0) {return '0.00';}

  // Convert to per million tokens
  const perMillion = value * 1000000;

  if (perMillion >= 100) {
    return perMillion.toFixed(0);
  } else if (perMillion >= 10) {
    return perMillion.toFixed(1);
  } else {
    return perMillion.toFixed(2);
  }
};

/**
 * Format token count for display (e.g. 128000 → 128K)
 */
export const formatTokenCount = (count: number): string => {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(count >= 10000000 ? 0 : 1)}M`;
  } else if (count >= 1000) {
    return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}K`;
  }
  return count.toString();
};

/**
 * Fetch model information from LiteLLM API
 */
export const fetchModelData = async (): Promise<Record<string, LiteLLMModelInfo>> => {
  const now = Date.now();

  // Use cached data if available and fresh
  if (modelInfoCache && now - lastFetchTime < CACHE_DURATION) {
    return modelInfoCache;
  }

  try {
    const data = await fetchModelInfo();

    if (Object.keys(data).length > 0) {
      modelInfoCache = data;
      lastFetchTime = now;
      return data;
    }

    return {};
  } catch (error) {
    console.error('Error fetching model data:', error);
    return {};
  }
};

/**
 * Price badge component for displaying input and output prices
 * Memoized to prevent unnecessary re-renders
 */
export const PriceBadge = memo(({
  type,
  price,
}: {
  type: 'input' | 'output';
  price: number;
}) => {
  const isInput = type === 'input';

  // Display the price value directly without further conversion
  // since it's already per million tokens
  const formattedPrice = price.toFixed(price >= 100 ? 0 : price >= 10 ? 1 : 2);
  const tooltipText = `$${formattedPrice} per 1 million tokens`;

  // Extract the content into a variable to avoid literal string ESLint error
  const priceText = `$${formattedPrice}/1M`;

  return (
    <TooltipAnchor
      description={tooltipText}
      side="top"
      className="cursor-pointer"
    >
      <div
        className="flex items-center justify-center gap-1 px-2 py-0.5 rounded-full bg-surface-chat border border-border-medium"
        style={{ minWidth: '76px' }}
      >
        {isInput ? (
          <User size={12} className="text-text-primary" strokeWidth={1.5} />
        ) : (
          <Server size={12} className="text-text-primary" strokeWidth={1.5} />
        )}
        <span className="text-[10px] text-text-primary">
          {priceText}
        </span>
      </div>
    </TooltipAnchor>
  );
});

/**
 * Free badge component for free models
 * Memoized to prevent unnecessary re-renders
 */
export const FreeBadge = memo(() => {
  // Extract the content into a variable to avoid literal string ESLint error
  const freeText = 'Currently free';

  return (
    <div
      className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-chat border border-border-medium"
      style={{ minWidth: '76px' }}
    >
      <Gift size={14} className="text-orange-400" strokeWidth={1.5} />
      <span className="text-[10px] text-text-primary">
        {freeText}
      </span>
    </div>
  );
});

/**
 * New badge component for new models
 * Memoized to prevent unnecessary re-renders
 */
export const NewBadge = memo(({
  createdAt,
}: {
  createdAt?: number | null;
}) => {
  const newText = 'NEW';

  // Generate tooltip text with creation date if available
  let tooltipText = 'Recently added model';

  if (createdAt) {
    // Convert Unix timestamp to Date object (multiply by 1000 as OpenRouter uses seconds)
    const creationDate = new Date(createdAt * 1000);

    // Format date to local string
    const formattedDate = creationDate.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    // Calculate days since creation
    const daysSince = Math.floor((Date.now() - creationDate.getTime()) / (1000 * 60 * 60 * 24));

    // Create tooltip text
    tooltipText = `Released ${daysSince} ${daysSince === 1 ? 'day' : 'days'} ago on ${formattedDate}`;
  }

  return (
    <TooltipAnchor
      description={tooltipText}
      side="top"
      className="cursor-pointer"
    >
      <div className="flex items-center justify-center gap-1 px-2 py-0.5 rounded-full bg-sidebar/20 border-[0.5px] border-[#ffb525f7] shadow-[0px_1px_4px_#ffae1082,inset_0px_-2px_10px_#ffb52575] dark:bg-[hsl(320,20%,2.9%)] dark:border-amber-200/80 dark:shadow-[0px_1px_4px_rgba(186,130,21,0.32),inset_0px_-2px_10px_rgba(186,130,21,0.43)] transition-all duration-300">
        <span className="text-[10px] font-semibold text-color-heading">{newText}</span>
      </div>
    </TooltipAnchor>
  );
});

/**
 * Context window badge component for displaying max tokens
 * Memoized to prevent unnecessary re-renders
 */
export const ContextBadge = memo(({
  tokens,
}: {
  tokens: number;
}) => {
  const formattedTokens = formatTokenCount(tokens);
  const tooltipText = 'Max Context Tokens';

  return (
    <TooltipAnchor
      description={tooltipText}
      side="top"
      className="cursor-pointer"
    >
      <div
        className="flex items-center justify-center gap-1 px-2 py-0.5 rounded-full bg-surface-chat border border-border-medium"
        style={{ minWidth: '61px' }}
      >
        <Target size={12} className="text-text-primary" strokeWidth={1.5} />
        <span className="text-[10px] text-text-primary">
          {formattedTokens}
        </span>
      </div>
    </TooltipAnchor>
  );
});

/**
 * Pre-memoized badges component to keep ModelSpecItem clean
 */
export const ModelBadges = memo(({
  spec,
  inputPrice: passedInputPrice,
  outputPrice: passedOutputPrice,
  showPricing: passedShowPricing,
  isFree: passedIsFree,
  maxTokens: passedMaxTokens,
  disabled: passedDisabled,
}: {
  spec?: TModelSpec;
  inputPrice?: number | null;
  outputPrice?: number | null;
  showPricing?: boolean;
  isFree?: boolean;
  maxTokens?: number | null;
  disabled?: boolean;
}) => {
  // Always call the hook, never conditionally
  const hookData = useModelBadges(spec ?? {} as TModelSpec);
  const modelName = spec?.preset?.model || '';

  // Get provider information from the model's endpoint
  const endpoint = spec?.preset?.endpoint || '';

  // Check if model is new using OpenRouter data
  const { isNew, createdAt } = useNewModelCheck(modelName, endpoint);

  // Use passed props if available, otherwise use hook data
  const inputPrice = passedInputPrice ?? hookData?.inputPrice ?? null;
  const outputPrice = passedOutputPrice ?? hookData?.outputPrice ?? null;
  const showPricing = passedShowPricing ?? hookData?.showPricing ?? true;
  const isFree = passedIsFree ?? hookData?.isFree ?? false;
  const maxTokens = passedMaxTokens ?? hookData?.maxTokens ?? null;
  const disabled = passedDisabled ?? hookData?.disabled ?? false;

  // If badges are explicitly disabled, show nothing
  if (disabled) {
    return null;
  }

  // Don't show anything if no pricing info and no token info
  if (!showPricing && !maxTokens && !isFree) {
    return null;
  }

  // Check if both input and output prices are 0 (free model)
  const isZeroPriced = inputPrice === 0 && outputPrice === 0;
  const shouldShowFree = isFree || isZeroPriced;

  return (
    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 mt-1">
      {isNew && <NewBadge createdAt={createdAt} />}
      {/* <span className="text-[10px] font-semibold px-1.5 py-0.25 rounded-md text-color-heading bg-sidebar/20 border-[0.5px] border-[#ffb525f7] shadow-[0px_1px_4px_#ffae1082,inset_0px_-2px_10px_#ffb52575] dark:bg-[hsl(320,20%,2.9%)] dark:border-amber-200/80 dark:shadow-[0px_1px_4px_rgba(186,130,21,0.32),inset_0px_-2px_10px_rgba(186,130,21,0.43)] transition-all duration-300 group-hover:bg-sidebar/30 dark:group-hover:bg-[hsl(320,20%,4%)] group-hover:shadow-[0px_2px_6px_#ffae10a0,inset_0px_-2px_12px_#ffb525a0] dark:group-hover:shadow-[0px_2px_6px_rgba(186,130,21,0.45),inset_0px_-2px_12px_rgba(186,130,21,0.6)]">NEW</span> */}

      {shouldShowFree && (
        <FreeBadge />
      )}
      {showPricing && !shouldShowFree && inputPrice !== null && (
        <PriceBadge type="input" price={inputPrice} />
      )}
      {showPricing && !shouldShowFree && outputPrice !== null && (
        <PriceBadge type="output" price={outputPrice} />
      )}
      {maxTokens !== null && maxTokens !== undefined && (
        <ContextBadge tokens={maxTokens} />
      )}
    </div>
  );
});

// Singleton instance for global model info
let globalModelData: Record<string, LiteLLMModelInfo> | null = null;
let globalModelDataPromise: Promise<Record<string, LiteLLMModelInfo>> | null = null;

/**
 * Initialize model data once at the application level
 * Returns a promise that resolves when data is loaded
 */
export const initModelData = async (): Promise<Record<string, LiteLLMModelInfo>> => {
  if (!globalModelDataPromise) {
    globalModelDataPromise = fetchModelData().then(data => {
      globalModelData = data;
      return data;
    });
  }
  return globalModelDataPromise;
};

/**
 * Hook to get model badges data
 * Uses badges configuration or falls back to LiteLLM data
 */
export const useModelBadges = (spec: TModelSpec) => {
  const [badges, setBadges] = useState<{
    inputPrice: number | null;
    outputPrice: number | null;
    showPricing: boolean;
    isFree: boolean;
    maxTokens: number | null;
    disabled: boolean;
  }>({
    inputPrice: null,
    outputPrice: null,
    showPricing: true,
    isFree: false,
    maxTokens: null,
    disabled: false,
  });

  // If spec is invalid or empty, return default values
  const modelName = spec?.preset?.model || '';

  useEffect(() => {
    // If spec is invalid, return early
    if (!spec || !spec?.name) {
      return;
    }

    let isMounted = true;

    const getBadges = async () => {
      // Initialize with default values
      let badgeData = {
        inputPrice: null as number | null,
        outputPrice: null as number | null,
        showPricing: true,
        isFree: false,
        maxTokens: null as number | null,
        disabled: false,
      };

      // Check for badges configuration and apply available properties
      if (spec.badges) {
        const {
          inputPrice,
          outputPrice,
          showPricing = true,
          isFree = false,
          maxContextToken,
          disabled = false,
        } = spec.badges;

        badgeData = {
          ...badgeData,
          inputPrice: inputPrice ?? badgeData.inputPrice,
          outputPrice: outputPrice ?? badgeData.outputPrice,
          showPricing,
          isFree,
          maxTokens: maxContextToken ?? badgeData.maxTokens,
          disabled,
        };
      }

      // If we have missing data and model name is provided, try to get from LiteLLM
      const needsMoreData = !badgeData.disabled &&
        modelName &&
        (badgeData.maxTokens === null || badgeData.inputPrice === null || badgeData.outputPrice === null);

      if (needsMoreData) {
        try {
          // Use already fetched data if available, otherwise initialize
          const modelData = globalModelData || await initModelData();

          // Directly look up the model by name without complex matching
          const modelInfo = modelData[modelName];

          if (modelInfo && isMounted) {
            // Only override values that weren't explicitly set in the badges config
            if (badgeData.inputPrice === null && modelInfo.input_cost_per_token !== undefined) {
              badgeData.inputPrice = modelInfo.input_cost_per_token * 1000000;
            }

            if (badgeData.outputPrice === null && modelInfo.output_cost_per_token !== undefined) {
              badgeData.outputPrice = modelInfo.output_cost_per_token * 1000000;
            }

            // Get max tokens if not already specified
            if (badgeData.maxTokens === null) {
              // Try max_input_tokens first, then max_tokens as fallback
              badgeData.maxTokens = modelInfo.max_input_tokens || modelInfo.max_tokens || null;
            }

            // Check if both input and output costs are 0 (free model)
            // Only update isFree if it wasn't explicitly set
            if (!spec.badges?.isFree &&
                modelInfo.input_cost_per_token === 0 &&
                modelInfo.output_cost_per_token === 0) {
              badgeData.isFree = true;
            }
          }
        } catch (error) {
          console.error('Error fetching model badges:', error);
        }
      }

      if (isMounted) {
        setBadges(badgeData);
      }
    };

    getBadges();
    return () => { isMounted = false; };
  }, [spec, modelName]);

  // Memoize the returned object to prevent unnecessary re-renders
  return useMemo(() => badges, [badges]);
};
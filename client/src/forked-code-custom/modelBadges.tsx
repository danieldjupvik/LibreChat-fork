import React from 'react';
import { memo } from 'react';
import { TooltipAnchor } from '@librechat/client';
import { User, Server, Gift, Target } from 'lucide-react';
import type { TModelSpec } from 'librechat-data-provider';
import { useNewModelCheck } from './openRouterAdapter';
import { useModelPricingInfo } from './modelPricing';

/**
 * Format token count for display (e.g. 128000 → 128K)
 */
const formatTokenCount = (count: number): string => {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(count >= 10000000 ? 0 : 1)}M`;
  } else if (count >= 1000) {
    return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}K`;
  }
  return count.toString();
};

/**
 * Price badge component for displaying input and output prices
 * Memoized to prevent unnecessary re-renders
 */
const PriceBadge = memo(({ type, price }: { type: 'input' | 'output'; price: number }) => {
  const isInput = type === 'input';

  // Display the price value directly without further conversion
  // since it's already per million tokens
  const getDecimalPlaces = (value: number) => {
    if (value >= 100) return 0;
    if (value >= 10) return 1;
    return 2;
  };
  const formattedPrice = price.toFixed(getDecimalPlaces(price));
  const tooltipText = `$${formattedPrice} per 1 million tokens`;

  // Extract the content into a variable to avoid literal string ESLint error
  const priceText = `$${formattedPrice}/1M`;

  return (
    <TooltipAnchor description={tooltipText} side="top" className="cursor-pointer">
      <div
        className="flex items-center justify-center gap-1 rounded-full border border-border-medium bg-surface-chat px-2 py-0.5"
        style={{ minWidth: '76px' }}
      >
        {isInput ? (
          <User size={12} className="text-text-primary" strokeWidth={1.5} />
        ) : (
          <Server size={12} className="text-text-primary" strokeWidth={1.5} />
        )}
        <span className="text-[10px] text-text-primary">{priceText}</span>
      </div>
    </TooltipAnchor>
  );
});

/**
 * Free badge component for free models
 * Memoized to prevent unnecessary re-renders
 */
const FreeBadge = memo(() => {
  // Extract the content into a variable to avoid literal string ESLint error
  const freeText = 'Currently free';

  return (
    <div
      className="flex items-center gap-1 rounded-full border border-border-medium bg-surface-chat px-2 py-0.5"
      style={{ minWidth: '76px' }}
    >
      <Gift size={14} className="text-orange-400" strokeWidth={1.5} />
      <span className="text-[10px] text-text-primary">{freeText}</span>
    </div>
  );
});

/**
 * New badge component for new models
 * Memoized to prevent unnecessary re-renders
 */
const NewBadge = memo(({ createdAt }: { createdAt?: number | null }) => {
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
    <TooltipAnchor description={tooltipText} side="top" className="cursor-pointer">
      <div className="bg-sidebar/20 flex items-center justify-center gap-1 rounded-full border-[0.5px] border-[#ffb525f7] px-2 py-0.5 shadow-[0px_1px_4px_#ffae1082,inset_0px_-2px_10px_#ffb52575] transition-all duration-300 dark:border-amber-200/80 dark:bg-[hsl(320,20%,2.9%)] dark:shadow-[0px_1px_4px_rgba(186,130,21,0.32),inset_0px_-2px_10px_rgba(186,130,21,0.43)]">
        <span className="text-color-heading text-[10px] font-semibold">{newText}</span>
      </div>
    </TooltipAnchor>
  );
});

/**
 * Context window badge component for displaying max tokens
 * Memoized to prevent unnecessary re-renders
 */
const ContextBadge = memo(({ tokens }: { tokens: number }) => {
  const formattedTokens = formatTokenCount(tokens);
  const tooltipText = 'Max Context Tokens';

  return (
    <TooltipAnchor description={tooltipText} side="top" className="cursor-pointer">
      <div
        className="flex items-center justify-center gap-1 rounded-full border border-border-medium bg-surface-chat px-2 py-0.5"
        style={{ minWidth: '61px' }}
      >
        <Target size={12} className="text-text-primary" strokeWidth={1.5} />
        <span className="text-[10px] text-text-primary">{formattedTokens}</span>
      </div>
    </TooltipAnchor>
  );
});

/**
 * Pre-memoized badges component to keep ModelSpecItem clean.
 *
 * Everything is derived from the spec: `useModelPricingInfo` resolves the
 * server's token config and lets an explicit `spec.badges` entry in
 * `librechat.yaml` override any field. That yaml block is the single override
 * surface — deliberately not mirrored as component props, so free/priced is
 * decided in exactly one place.
 */
export const ModelBadges = memo(({ spec }: { spec?: TModelSpec }): React.ReactElement | null => {
  const { inputPrice, outputPrice, showPricing, isFree, maxTokens, disabled } =
    useModelPricingInfo(spec);
  const modelName = spec?.preset?.model || '';
  const endpoint = spec?.preset?.endpoint || '';
  const { isNew, createdAt } = useNewModelCheck(modelName, endpoint);

  if (disabled) {
    return null;
  }

  if (!showPricing && !maxTokens && !isFree) {
    return null;
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 sm:flex-nowrap">
      {isNew && <NewBadge createdAt={createdAt} />}

      {isFree && <FreeBadge />}
      {showPricing && !isFree && inputPrice !== null && (
        <PriceBadge type="input" price={inputPrice} />
      )}
      {showPricing && !isFree && outputPrice !== null && (
        <PriceBadge type="output" price={outputPrice} />
      )}
      {maxTokens !== null && <ContextBadge tokens={maxTokens} />}
    </div>
  );
});

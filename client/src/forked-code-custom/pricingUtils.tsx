import { useEffect, useState, memo, useMemo } from 'react';
import React from 'react';
import type { TModelSpec } from 'librechat-data-provider';

/**
 * Pricing data cache from LiteLLM
 */
let pricingData: Record<string, { input_cost_per_token?: number; output_cost_per_token?: number }> | null = null;
let lastFetchTime = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Cache of model matches to avoid redundant matching operations
const modelMatchCache: Record<string, { model: string; data: any } | null> = {};

/**
 * Format price value for display (per million tokens)
 */
export const formatPrice = (value: number): string => {
  if (value === 0) return '0.00';
  
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
 * Find matching model in pricing data with simplified approach
 * Preserves provider information for accurate pricing
 */
export const findBestModelMatch = (
  modelName: string, 
  pricingData: Record<string, any>
): { model: string; data: any } | null => {
  if (!modelName || !pricingData) return null;
  
  // Check cache first
  if (modelMatchCache[modelName] !== undefined) {
    return modelMatchCache[modelName];
  }
  
  // Step 1: Try exact match first (highest priority)
  if (pricingData[modelName]) {
    console.log(`Model exact match: '${modelName}'`);
    const result = { model: modelName, data: pricingData[modelName] };
    modelMatchCache[modelName] = result;
    return result;
  }
  
  // Step 2: Try case-insensitive exact match
  const lowercaseModelName = modelName.toLowerCase();
  for (const key in pricingData) {
    if (key.toLowerCase() === lowercaseModelName) {
      console.log(`Model case-insensitive match: '${modelName}' → '${key}'`);
      const result = { model: key, data: pricingData[key] };
      modelMatchCache[modelName] = result;
      return result;
    }
  }
  
  // No match found
  console.log(`No match found for model: '${modelName}'`);
  modelMatchCache[modelName] = null;
  return null;
};

/**
 * Fetch pricing data from LiteLLM
 */
export const fetchPricingData = async (): Promise<Record<string, any>> => {
  const now = Date.now();
  
  // Use cached data if available and fresh
  if (pricingData && now - lastFetchTime < CACHE_DURATION) {
    return pricingData;
  }
  
  try {
    const response = await fetch(
      'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
    );
    
    if (!response.ok) {
      throw new Error(`Failed to fetch pricing data: ${response.status}`);
    }
    
    const data = await response.json();
    pricingData = data;
    lastFetchTime = now;
    
    // Reset the model match cache when we get new pricing data
    Object.keys(modelMatchCache).forEach(key => delete modelMatchCache[key]);
    
    return data;
  } catch (error) {
    console.error('Error fetching pricing data:', error);
    // Return empty object if fetch fails
    return {};
  }
};

/**
 * Price badge component for displaying input and output prices
 * Memoized to prevent unnecessary re-renders
 */
export const PriceBadge = memo(({ 
  type, 
  price 
}: { 
  type: 'input' | 'output';
  price: number;
}) => {
  const isInput = type === 'input';
  const bgGradient = isInput 
    ? 'bg-gradient-to-r from-blue-900/30 to-blue-800/20' 
    : 'bg-gradient-to-r from-purple-900/30 to-purple-800/20';
  const borderColor = isInput ? 'rgb(147, 197, 253)' : 'rgb(216, 180, 254)';
  const textColor = isInput ? 'rgb(147, 197, 253)' : 'rgb(216, 180, 254)';
  const label = isInput ? 'IN' : 'OUT';
  
  const formattedPrice = price.toFixed(price >= 100 ? 0 : price >= 10 ? 1 : 2);
  
  return (
    <div 
      className="flex items-center gap-1 px-2.5 py-0.75 rounded-full" 
      style={{ 
        border: `0.5px solid ${borderColor}`,
        background: bgGradient
      }}
    >
      <span 
        className="text-[10px] font-semibold" 
        style={{ color: textColor }}
      >
        {label} ${formattedPrice}/1M
      </span>
    </div>
  );
});

/**
 * Pre-memoized pricing badges component to keep ModelSpecItem clean
 */
export const PricingBadges = memo(({ 
  inputPrice, 
  outputPrice, 
  showPricing
}: { 
  inputPrice: number | null; 
  outputPrice: number | null; 
  showPricing: boolean;
}) => {
  if (!showPricing || (inputPrice === null && outputPrice === null)) {
    return null;
  }
  
  return (
    <div className="flex items-center gap-2 mt-1">
      {inputPrice !== null && (
        <PriceBadge type="input" price={inputPrice} />
      )}
      {outputPrice !== null && (
        <PriceBadge type="output" price={outputPrice} />
      )}
    </div>
  );
});

// Singleton instance for global pricing data
let globalPricingData: Record<string, any> | null = null;
let globalPricingDataPromise: Promise<Record<string, any>> | null = null;

/**
 * Initialize pricing data once at the application level
 * Returns a promise that resolves when data is loaded
 */
export const initPricingData = async (): Promise<Record<string, any>> => {
  if (!globalPricingDataPromise) {
    globalPricingDataPromise = fetchPricingData().then(data => {
      globalPricingData = data;
      return data;
    });
  }
  return globalPricingDataPromise;
};

/**
 * Hook to get model pricing data
 * First tries to use manual configuration, then falls back to LiteLLM data
 */
export const useModelPricing = (spec: TModelSpec) => {
  const [prices, setPrices] = useState<{ 
    inputPrice: number | null; 
    outputPrice: number | null;
    showPricing: boolean;
  }>({
    inputPrice: null,
    outputPrice: null,
    showPricing: false
  });
  
  const modelName = spec.preset?.model || '';
  
  useEffect(() => {
    let isMounted = true;
    
    const getPricing = async () => {
      // First check for manual pricing configuration
      if (spec.pricing) {
        const { inputPrice, outputPrice, showPricing = true } = spec.pricing;
        if (isMounted) {
          setPrices({
            inputPrice: inputPrice ?? null,
            outputPrice: outputPrice ?? null,
            showPricing
          });
          return;
        }
      }
      
      // If no manual pricing, try to get from LiteLLM
      if (modelName) {
        try {
          // Use already fetched data if available, otherwise initialize
          const data = globalPricingData || await initPricingData();
          
          // Use the simplified model matching function
          const modelMatch = findBestModelMatch(modelName, data);
          
          if (modelMatch && isMounted) {
            const modelData = modelMatch.data;
            
            // Calculate prices once
            const inputCost = modelData.input_cost_per_token 
              ? modelData.input_cost_per_token * 1000000 
              : null;
              
            const outputCost = modelData.output_cost_per_token 
              ? modelData.output_cost_per_token * 1000000 
              : null;
            
            setPrices({
              inputPrice: inputCost,
              outputPrice: outputCost,
              showPricing: true
            });
          }
        } catch (error) {
          console.error('Error fetching model pricing:', error);
        }
      }
    };
    
    getPricing();
    return () => { isMounted = false; };
  }, [spec, modelName]);
  
  // Memoize the returned object to prevent unnecessary re-renders
  return useMemo(() => prices, [prices.inputPrice, prices.outputPrice, prices.showPricing]);
}; 
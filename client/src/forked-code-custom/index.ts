import { initPricingData, useModelBadges, ModelBadges } from './modelBadges';
export { default as PromptSuggestions } from './PromptSuggestions';
export { CapabilityIcons } from './CapabilityIcons';
export { useModelBadges, ModelBadges } from './modelBadges';

/**
 * Initialize forked custom features
 * - Loads pricing data on app startup to avoid delays on first model selection
 */
export const initialize = () => {
  // Pre-fetch pricing data in the background
  initPricingData().catch((err) => {
    console.error('Failed to initialize pricing data:', err);
  });
};

export default {
  initialize,
};

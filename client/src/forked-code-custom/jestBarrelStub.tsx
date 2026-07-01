import React from 'react';

/**
 * Jest stub for the fork-only `~/forked-code-custom` barrel.
 *
 * The barrel is wired into several upstream components (Landing, HoverButtons,
 * ModelSpecItem, SearchResults, routes). Its real implementation eagerly loads
 * `~/store`, which throws under the stripped-down `librechat-data-provider`
 * mocks that upstream tests use. Mapping the barrel index to this stub lets any
 * upstream test render those components without pulling in the fork runtime.
 *
 * Wired via `moduleNameMapper` in jest.config.cjs (see the jest-forked-barrel-stub
 * sentinel there).
 */

const noop = () => undefined;

export const PromptSuggestions = () => null;
export const ResponseCost = () => null;
export const ShortcutsHelp = () => null;
export const ForkedCustomizations = () => null;
export const ModelBadges = () => null;
export const CapabilityIcons = () => null;
export const RouteGuard = ({ children }: { children?: React.ReactNode }) => <>{children}</>;

export const initialize = noop;
export const cleanup = noop;
export const initLiteLLMModelData = noop;
export const useModelPricingInfo = () => ({});

export default {
  ForkedCustomizations,
};

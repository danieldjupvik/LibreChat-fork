import { initialize, cleanup } from './KeyboardShortcuts';
import ForkedCustomizations from './ForkedCustomizations';
import { useModelPricingInfo } from './modelPricing';
import { CapabilityIcons } from './CapabilityIcons';
import ShortcutsHelp from './ShortcutsHelp';
import { ModelBadges } from './modelBadges';
import RouteGuard from './RouteGuard';

/**
 * Exports for forked customizations
 *
 * The initialization is now handled by the ForkedCustomizations component
 * which mounts in the React tree. This avoids duplicate initialization.
 */

export {
  ShortcutsHelp,
  ForkedCustomizations,
  initialize,
  cleanup,
  ModelBadges,
  useModelPricingInfo,
  CapabilityIcons,
  RouteGuard,
};

export default {
  ForkedCustomizations,
};

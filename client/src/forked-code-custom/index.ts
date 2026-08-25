import { useModelPricingInfo } from './modelPricing';
import { initialize, cleanup } from './KeyboardShortcuts';
import ShortcutsHelp from './ShortcutsHelp';
import ForkedCustomizations from './ForkedCustomizations';
import { ModelBadges } from './modelBadges';
import { CapabilityIcons } from './CapabilityIcons';
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

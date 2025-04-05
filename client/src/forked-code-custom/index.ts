import { initModelData } from './modelBadges';
import ResponseCost from './ResponseCost';
import KeyboardShortcuts from './KeyboardShortcuts';

/**
 * Initialize forked custom features
 * - Loads model data on app startup to avoid delays on first model selection
 * - Initializes keyboard shortcuts (⌘+Shift+O / Ctrl+Shift+O for new chat)
 */
export const initialize = () => {
  // Pre-fetch model data in the background
  initModelData().catch(err => {
    console.error('Failed to initialize model data:', err);
  });

  // Initialize keyboard shortcuts
  KeyboardShortcuts.initialize();
};

export { ResponseCost };

export default {
  initialize,
};

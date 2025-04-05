/**
 * Utility functions for forked customizations
 */

/**
 * Check if the user is on a macOS device
 * Uses userAgent instead of deprecated platform API
 */
export const isMacOS = (): boolean => {
  const userAgent = navigator.userAgent.toLowerCase();
  return userAgent.includes('mac');
};

/**
 * Get the appropriate command key symbol based on OS
 */
export const getCmdKey = (): string => {
  return isMacOS() ? '⌘' : 'Ctrl';
};
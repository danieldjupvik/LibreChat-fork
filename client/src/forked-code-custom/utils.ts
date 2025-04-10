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

// Add global type for window.lastThemeChange
declare global {
  interface Window {
    lastThemeChange?: number;
  }
}

/**
 * Properly toggle between light and dark themes using the same methods as the ThemeContext
 * This implements the core theme switching logic matching the app's implementation
 *
 * @returns {string} The new theme value ('light' or 'dark')
 */
export const toggleTheme = (): string => {
  // Read the current theme from localStorage
  const storedTheme = localStorage.getItem('color-theme');

  // Determine the next theme: dark -> light -> dark
  let newTheme: string;

  if (storedTheme === 'dark') {
    newTheme = 'light';
  } else {
    // Either 'light', 'system', or null/undefined - always convert to dark
    newTheme = 'dark';
  }

  // Apply the theme (in the same way ThemeContext does)
  const root = document.documentElement;
  const isDarkMode = newTheme === 'dark';

  root.classList.remove(isDarkMode ? 'light' : 'dark');
  root.classList.add(isDarkMode ? 'dark' : 'light');

  // Store the theme setting in localStorage
  localStorage.setItem('color-theme', newTheme);

  // If the app reacts to storage events, dispatch one
  window.dispatchEvent(new Event('storage'));

  // Track the last theme change time (used by the theme selector component)
  window.lastThemeChange = Date.now();

  return newTheme;
};

/**
 * Fetches subscription status from Lago through our proxy endpoint
 * @param userId - The user ID to check subscription for
 * @param email - The user email to check against whitelist
 * @returns Object with subscription status information
 */
export const fetchSubscriptionStatus = async (userId: string, email?: string) => {
  // Skip fetch if no userId is provided
  if (!userId) {
    console.error('fetchSubscriptionStatus called without userId');
    return {
      hasSubscription: false,
      error: true,
      errorMessage: 'No user ID provided',
      fallback: false,
    };
  }

  // Check localStorage cache first
  const cachedData = localStorage.getItem('subscription');

  if (cachedData) {
    try {
      const parsed = JSON.parse(cachedData);
      const cacheTime = parsed.timestamp || 0;
      const cachedUserId = parsed.userId;

      // Only use cache if it's the same user and the cache is fresh
      if (cachedUserId === userId && Date.now() - cacheTime < 3600000) {
        return parsed.data;
      } else if (cachedUserId !== userId) {
        // If user changed, clear the cache
        localStorage.removeItem('subscription');
      }
    } catch (error) {
      console.error('Error parsing cached subscription data:', error);
      // Delete invalid cache
      localStorage.removeItem('subscription');
    }
  }

  try {
    const url = new URL('/api/forked/lago/subscription', window.location.origin);
    url.searchParams.append('userId', userId);
    if (email) {
      url.searchParams.append('email', email);
    }

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Error fetching subscription status: ${response.status}`);
    }

    const data = await response.json();

    // Cache successful responses, including the whitelisted status
    if (data && !data.error) {
      localStorage.setItem('subscription', JSON.stringify({
        // Store the relevant data fields directly
        data: {
          hasSubscription: data.hasSubscription,
          whitelisted: data.whitelisted, // Ensure whitelisted is included
          fallback: data.fallback, // Include fallback status as well
          error: data.error, // Include error status
          errorMessage: data.errorMessage, // Include error message
        },
        timestamp: Date.now(),
        userId: userId,
      }));
    }

    return data;
  } catch (error) {
    console.error('Error checking subscription status:', error);
    // Default to denying access on errors for safety
    return {
      hasSubscription: false,
      error: true,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      fallback: false,
    };
  }
};
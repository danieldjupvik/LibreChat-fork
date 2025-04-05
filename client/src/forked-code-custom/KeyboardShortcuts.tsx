/**
 * Keyboard shortcuts for LibreChat
 * Forked implementation to add custom keyboard shortcuts without modifying upstream files
 */

// Store reference to event listeners for cleanup
let keydownListener: ((e: KeyboardEvent) => void) | null = null;

/**
 * Initialize keyboard shortcuts
 */
export const initialize = () => {
  if (keydownListener) {
    // Already initialized
    return;
  }

  // Log available shortcuts
  console.log('🔑 Keyboard shortcuts initialized:');
  console.log('- New Chat: ⌘+Shift+O (macOS) / Ctrl+Shift+O (Windows/Linux)');
  console.log('- Stop Generation: Escape');
  console.log('- Toggle Sidebar: ⌘+B (macOS) / Ctrl+B (Windows/Linux)');

  // Define the keyboard event handler
  keydownListener = (e: KeyboardEvent) => {
    // CMD+SHIFT+O for new chat (Mac) or CTRL+SHIFT+O (Windows/Linux)
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      handleNewChat();
      return;
    }

    // CMD+B (Mac) or CTRL+B (Windows/Linux) to toggle sidebar
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      handleToggleSidebar();
      return;
    }

    // ESC to stop generation
    if (e.key === 'Escape') {
      handleStopGeneration();
      return;
    }
  };

  // Add event listener
  window.addEventListener('keydown', keydownListener);
};

/**
 * Clean up keyboard shortcuts
 */
export const cleanup = () => {
  if (keydownListener) {
    window.removeEventListener('keydown', keydownListener);
    keydownListener = null;
  }
};

/**
 * Handler for the new chat shortcut
 *
 * This implementation clicks the new chat button in the sidebar
 */
const handleNewChat = () => {
  console.log('⌨️ Keyboard shortcut activated: New Chat (⌘+Shift+O)');

  try {
    // Find the new chat button and click it programmatically
    const newChatButton = document.querySelector('[data-testid="nav-new-chat-button"]') as HTMLElement;

    if (newChatButton) {
      // Simulate a click on the new chat button
      newChatButton.click();
      console.log('New chat created via shortcut');
    } else {
      console.warn('New chat button not found in the DOM');
    }
  } catch (error) {
    console.error('Error creating new chat:', error);
  }
};

/**
 * Handler to toggle sidebar visibility
 */
const handleToggleSidebar = () => {
  console.log('⌨️ Keyboard shortcut activated: Toggle Sidebar (⌘+B)');

  try {
    // Try multiple possible selectors for the sidebar toggle button
    const sidebarToggle =
      document.querySelector('[aria-label="Toggle sidebar"]') ||
      document.querySelector('.sidebar-button') ||
      document.querySelector('[aria-label="Open sidebar"]') ||
      document.querySelector('[aria-label="Close sidebar"]') ||
      document.querySelector('button[title*="sidebar" i]') ||
      document.querySelector('button.mobile-nav-button');

    if (sidebarToggle instanceof HTMLElement) {
      sidebarToggle.click();
      console.log('Sidebar toggled via shortcut');
    } else {
      // Try to find the menu icon buttons often used on mobile/responsive designs
      const mobileMenuBurger =
        document.querySelector('.mobile-nav-button') ||
        document.querySelector('[aria-label*="menu" i]') ||
        document.querySelector('.menu-icon') ||
        document.querySelector('.hamburger-menu');

      if (mobileMenuBurger instanceof HTMLElement) {
        mobileMenuBurger.click();
        console.log('Mobile menu toggled via shortcut');
      } else {
        console.warn('Sidebar toggle button not found in the DOM');
      }
    }
  } catch (error) {
    console.error('Error toggling sidebar:', error);
  }
};

/**
 * Handler to stop AI generation
 */
const handleStopGeneration = () => {
  console.log('⌨️ Keyboard shortcut activated: Stop Generation (Escape)');

  try {
    // Find the stop generation button and click it if it exists
    const stopButton = document.querySelector('[aria-label="Stop generating"]') as HTMLElement;

    if (stopButton) {
      stopButton.click();
      console.log('Generation stopped via shortcut');
    } else {
      // If no stop button is found, it means nothing is being generated
      // We can silently ignore this case
    }
  } catch (error) {
    console.error('Error stopping generation:', error);
  }
};

export default {
  initialize,
  cleanup,
};
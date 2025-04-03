import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { useRecoilState } from 'recoil';
import { cn } from '~/utils';
import store from '~/store';
import { useChatContext } from '~/Providers';
import { mainTextareaId } from '~/common';

interface PromptSuggestion {
  text: string;
}

interface PromptSuggestionsProps {
  prompts?: PromptSuggestion[];
}

/**
 * Hook for managing prompt suggestions
 * Returns an array of suggested prompts to show to the user
 *
 * Currently uses hardcoded values, but designed to be extensible
 * to fetch from configuration or API in the future
 */
export const usePromptSuggestions = () => {
  // Default hardcoded prompts
  const defaultPrompts: PromptSuggestion[] = useMemo(
    () => [
      { text: 'How does AI work?' },
      { text: 'Are black holes real?' },
      { text: 'How many Rs are in the word "strawberry"?' },
      { text: 'List of good questions to ask an AI chat bot' },
    ],
    [],
  );

  // In the future, this could fetch from API or config
  // For now, just return the default prompts
  return {
    prompts: defaultPrompts,
    isLoading: false,
    error: null,
  };
};

/**
 * Component for displaying prompt suggestions below the chat input
 * Styled to match the application theme using existing classes
 */
export const PromptSuggestions = ({ prompts: externalPrompts }: PromptSuggestionsProps) => {
  const { index } = useChatContext();
  const [, setActivePrompt] = useRecoilState(store.activePromptByIndex(index));
  const { prompts: defaultPrompts } = usePromptSuggestions();

  // Animation states
  const [isVisible, setIsVisible] = useState(false);
  const [animatedItems, setAnimatedItems] = useState<number[]>([]);

  // Use externally provided prompts if available, otherwise use the defaults
  const prompts = externalPrompts && externalPrompts.length > 0 ? externalPrompts : defaultPrompts;

  // Limit to max 4 prompts
  const displayPrompts = useMemo(() => prompts.slice(0, 4), [prompts]);

  // Animation timing configuration
  const initialDelay = 600; // Wait for SplitText to animate
  const staggerDelay = 150; // Delay between each item

  useEffect(() => {
    // Start overall component visibility animation after initial delay
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, initialDelay);

    return () => clearTimeout(timer);
  }, []);

  // Staggered animation for individual items
  useEffect(() => {
    if (!isVisible) return;

    // Animate items one by one from bottom to top
    const reversedIndices = [...displayPrompts.keys()].reverse();

    reversedIndices.forEach((index, i) => {
      const timer = setTimeout(() => {
        setAnimatedItems((prev) => [...prev, index]);
      }, staggerDelay * i);

      return () => clearTimeout(timer);
    });
  }, [isVisible, displayPrompts.length]);

  const handleSelectPrompt = useCallback(
    (text: string) => {
      // Clear any existing text in the textarea first
      const textarea = document.getElementById(mainTextareaId) as HTMLTextAreaElement;
      if (textarea) {
        textarea.value = '';
        // Force a native input event to ensure all listeners catch the change
        const inputEvent = new Event('input', { bubbles: true });
        textarea.dispatchEvent(inputEvent);
      }

      // Set the active prompt after clearing
      setActivePrompt(text);
    },
    [setActivePrompt],
  );

  if (!prompts.length) {
    return null;
  }

  return (
    <div
      className={cn(
        'mt-6 w-full px-4 transition-opacity duration-500 sm:px-0',
        isVisible ? 'opacity-100' : 'opacity-0',
      )}
    >
      <div className="mb-12 flex flex-col text-foreground">
        {displayPrompts.map((prompt, i) => (
          <div
            key={i}
            className={cn(
              'flex items-start gap-2 border-t border-border-light py-1 transition-all duration-500 first:border-none',
              animatedItems.includes(i)
                ? 'translate-y-0 transform opacity-100'
                : 'translate-y-4 transform opacity-0',
            )}
          >
            <button
              className="w-full rounded-md py-2 text-left text-text-primary hover:bg-surface-tertiary sm:px-3"
              onClick={() => handleSelectPrompt(prompt.text)}
              aria-label={`Use prompt: ${prompt.text}`}
              tabIndex={animatedItems.includes(i) ? 0 : -1}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSelectPrompt(prompt.text);
                }
              }}
            >
              <span className="line-clamp-2">{prompt.text}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Default export for the component
 * Used when importing from this file
 */
export default PromptSuggestions;

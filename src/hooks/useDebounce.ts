import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Custom hook that returns a debounced version of the provided value.
 * Updates only after the specified delay has passed without any new value changes.
 *
 * @param value The value to debounce (e.g. search string, filter object)
 * @param delay Delay in milliseconds (default: 350ms)
 * @returns Debounced value
 */
export function useDebounce<T>(value: T, delay: number = 350): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Custom hook that returns a debounced callback function.
 * Ensures the callback is only executed after the specified delay has elapsed
 * since the last invocation.
 *
 * @param callback Function to debounce
 * @param delay Delay in milliseconds (default: 350ms)
 * @returns Debounced callback function with a cancel method
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number = 350
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
  const callbackRef = useRef<T>(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep reference updated to latest callback to avoid stale closures
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const debounced = useCallback(
    (...args: Parameters<T>) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    },
    [delay]
  );

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return Object.assign(debounced, { cancel });
}

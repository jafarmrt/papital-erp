import { useState, useEffect } from 'react';

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

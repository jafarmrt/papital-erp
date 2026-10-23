/**
 * The app's read defaults (`lib/queryClient`). Tests build their clients from them (10.3), so a screen that must read again
 * on each opening shows it there; kept apart from the client so a test can import them without its toasts.
 */
export const QUERY_DEFAULTS = {
  staleTime: 5 * 60 * 1000, // 5 minutes cache fresh time
  gcTime: 30 * 60 * 1000, // 30 minutes garbage collection time
  refetchOnWindowFocus: true,
} as const;

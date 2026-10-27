import { QueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { SUBMISSION_REPLAYED_EVENT } from './idempotentReplay';
import { QUERY_DEFAULTS } from './queryDefaults';
import { shouldRetryQuery } from './queryRetry';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      ...QUERY_DEFAULTS,
      retry: shouldRetryQuery,
    },
    mutations: {
      onError: (error: any) => {
        const message = error?.message || 'خطایی در پردازش عملیات رخ داد';
        // 10.3: the «already registered» notice is no failure; the record exists
        if (error?.code === 'IDEMPOTENT_REPLAY') toast(message, { icon: 'ℹ️' });
        else toast.error(message);
      },
    },
  },
});

// 10.3 (ARCH review finding 1): a write answered with the «already registered» notice: the open lists read the record
if (typeof window !== 'undefined') {
  window.addEventListener(SUBMISSION_REPLAYED_EVENT, () => { void queryClient.invalidateQueries(); });
}

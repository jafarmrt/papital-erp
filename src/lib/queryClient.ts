import { QueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes cache fresh time
      gcTime: 30 * 60 * 1000, // 30 minutes garbage collection time
      refetchOnWindowFocus: true,
      retry: (failureCount, error: any) => {
        // Do not retry 401 or 403 authorization / authentication errors
        const status = error?.status || error?.statusCode;
        if (
          status === 401 ||
          status === 403 ||
          error?.code === 'UNAUTHORIZED' ||
          error?.code === 'FORBIDDEN' ||
          error?.message?.includes('401') ||
          error?.message?.includes('403') ||
          error?.message?.includes('غیرمجاز')
        ) {
          return false;
        }
        return failureCount < 3;
      },
    },
    mutations: {
      onError: (error: any) => {
        const message = error?.message || 'خطایی در پردازش عملیات رخ داد';
        toast.error(message);
      },
    },
  },
});

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { toast } from 'react-hot-toast';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { invalidatePreset, invalidateDomain } from '../../lib/queryInvalidation';

export interface DocumentFilters {
  type?: string;
  status?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export function useDocumentsQuery(filters: DocumentFilters) {
  return useQuery({
    queryKey: QUERY_KEYS.documents.list(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.type && filters.type !== 'all') params.set('type', filters.type);
      if (filters.status && filters.status !== 'all') params.set('status', filters.status);
      if (filters.search?.trim()) params.set('search', filters.search.trim());
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      if (filters.page) params.set('page', String(filters.page));
      if (filters.limit) params.set('limit', String(filters.limit));

      const res = await fetchJson(`/documents${params.toString() ? `?${params.toString()}` : ''}`);
      return res ?? null;
    },
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useFinalizeDocumentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ docId, user }: { docId: number; user?: string }) => {
      return fetchJson(`/documents/${docId}/finalize`, {
        method: 'POST',
        body: JSON.stringify({ user })
      });
    },
    onSuccess: async () => {
      await invalidateDomain(queryClient, 'documents');
      await invalidatePreset(queryClient, 'inventoryChange');
      toast.success('سند با موفقیت نهایی و تایید شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در نهایی‌سازی سند');
    },
  });
}

export function useDeleteDocumentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (docId: number) => {
      return fetchJson(`/documents/${docId}`, { method: 'DELETE' });
    },
    onSuccess: async () => {
      await invalidateDomain(queryClient, 'documents');
      await invalidatePreset(queryClient, 'inventoryChange');
      toast.success('سند / پیش‌فاکتور با موفقیت ابطال و حذف گردید.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در ابطال سند');
    },
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { toast } from 'react-hot-toast';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { invalidatePreset } from '../../lib/queryInvalidation';

export interface LinkedProduct {
  id: number;
  name: string;
  code: string;
  type: string;
  category: string;
  unit: string;
  currentStock: number;
  image?: string;
  thumbnail?: string;
  weightedAverageCost?: number;
  color?: string;
  material?: string;
}

export interface TransferItem {
  id: number | null;
  code: string;
  title: string;
  image: string;
  thumbnail: string;
  notes: string;
  createdAt: string | null;
  updatedAt: string | null;
  productCount: number;
  products: LinkedProduct[];
}

export function useTransfersQuery() {
  return useQuery<TransferItem[]>({
    queryKey: QUERY_KEYS.transfers.list(),
    queryFn: async () => {
      const res = await fetchJson('/transfers');
      return Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
    },
    staleTime: 1000 * 30,
  });
}

export function useSaveTransferMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ code, payload }: { code?: string; payload: any }) => {
      const body = { ...payload };
      if (code && !body.code) {
        body.code = code;
      }
      return fetchJson('/transfers', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      invalidatePreset(queryClient, 'transferChange');
      toast.success('اطلاعات ترنسفر با موفقیت ذخیره گردید');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در ذخیره ترنسفر');
    },
  });
}

export function useDeleteTransferMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (code: string) => {
      return fetchJson(`/transfers/${code}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      invalidatePreset(queryClient, 'transferChange');
      toast.success('طرح ترنسفر با موفقیت حذف گردید');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در حذف ترنسفر');
    },
  });
}

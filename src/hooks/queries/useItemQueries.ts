import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { Item } from '../../types';
import { toast } from 'react-hot-toast';
import { QUERY_KEYS, itemKeys } from '../../lib/queryKeys';
import { invalidateDomain, invalidatePreset } from '../../lib/queryInvalidation';

export { itemKeys };

export interface ItemsResponse {
  data: Item[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * Hook to query items (products / raw materials) with pagination and search
 */
export function useItemsQuery(type: 'product' | 'raw_material', page: number = 1, limit: number = 50, search?: string) {
  return useQuery<ItemsResponse>({
    queryKey: QUERY_KEYS.items.list({ type, page, limit, search: search?.trim() || '' }),
    queryFn: async () => {
      const query = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        type,
      });
      if (search && search.trim()) {
        query.append('search', search.trim());
      }
      const res = await fetchJson(`/items?${query.toString()}`);
      if (res && Array.isArray(res.data)) {
        return {
          data: res.data,
          total: res.total || 0,
          page: res.page || page,
          totalPages: res.totalPages || 1,
        };
      }
      if (Array.isArray(res)) {
        return {
          data: res,
          total: res.length,
          page: 1,
          totalPages: Math.ceil(res.length / limit) || 1,
        };
      }
      return { data: [], total: 0, page: 1, totalPages: 1 };
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to create or update an inventory item
 */
export function useSaveItemMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, payload }: { id?: number | null; payload: any }) => {
      const url = id ? `/items/${id}` : '/items';
      const method = id ? 'PUT' : 'POST';
      return fetchJson(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (_, variables) => {
      invalidatePreset(queryClient, 'inventoryChange');
      toast.success(variables.id ? 'اطلاعات کالا با موفقیت به‌روزرسانی شد' : 'کالای جدید با موفقیت ثبت شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در ذخیره اطلاعات کالا');
    },
  });
}

/**
 * Hook to archive (soft delete) an inventory item
 */
export function useArchiveItemMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      return fetchJson(`/items/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      invalidatePreset(queryClient, 'inventoryChange');
      toast.success('کالا با موفقیت بایگانی گردید');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در بایگانی کالا');
    },
  });
}

/**
 * Hook to sync an item stock with WooCommerce
 */
export function useSyncItemMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (itemId: number) => {
      return fetchJson('/woocommerce/sync-item', {
        method: 'POST',
        body: JSON.stringify({ itemId }),
      });
    },
    onSuccess: (res: any) => {
      invalidateDomain(queryClient, 'items');
      toast.success(res?.message || 'موجودی با موفقیت با ووکامرس همگام‌سازی شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در همگام‌سازی کالا با ووکامرس');
    },
  });
}

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { Item } from '../../types';
import { toast } from 'react-hot-toast';
import { QUERY_KEYS, itemKeys } from '../../lib/queryKeys';
import { invalidateDomain, invalidatePreset } from '../../lib/queryInvalidation';
import type { ItemListSort, ItemListStats } from '../../lib/items/itemListSort';
import { galleryItemsUrl, type GalleryQuery } from '../../lib/gallery/galleryItems';
import { READ_ON_EVERY_OPENING } from './readOnEveryOpening';

export { itemKeys };

export interface ItemsResponse {
  data: Item[];
  total: number;
  page: number;
  totalPages: number;
  /** v10.0.218 (OBS-R1-74): آمار روی همه کالاهای پالایش */
  stats: ItemListStats;
}

export function useAllItemsQuery(type?: 'product' | 'raw_material') {
  return useQuery<Item[]>({
    queryKey: QUERY_KEYS.items.list({ type: type || 'all', all: true }),
    queryFn: async () => {
      const url = type ? `/items?type=${type}&limit=0` : '/items?limit=0';
      const res = await fetchJson(url);
      return Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
    },
    staleTime: 60 * 1000,
  });
}

/**
 * Hook to query items (products / raw materials) with pagination and search
 */
export function useItemsQuery(
  type: 'product' | 'raw_material' = 'product', page: number = 1, limit: number = 50, search?: string, sort: ItemListSort | null = null,
) {
  return useQuery<ItemsResponse>({
    queryKey: QUERY_KEYS.items.list({ type, page, limit, search: search?.trim() || '', sort: sort ? `${sort.key}:${sort.direction}` : '' }),
    queryFn: async ({ signal }) => {
      const query = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        type,
      });
      if (search && search.trim()) {
        query.append('search', search.trim());
      }
      // v10.0.218 (OBS-R1-74): مرتب‌سازی در سرور روی همه کالاها
      if (sort) {
        query.append('sort', sort.key);
        query.append('direction', sort.direction);
      }
      const res = await fetchJson(`/items?${query.toString()}`, { signal });
      const lowStock = Number(res?.stats?.lowStock) || 0;
      if (res && Array.isArray(res.data)) {
        return {
          data: res.data,
          total: res.total || 0,
          page: res.page || page,
          totalPages: res.totalPages || 1,
          stats: { lowStock },
        };
      }
      return { data: [], total: 0, page: 1, totalPages: 1, stats: { lowStock } };
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
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
      void invalidatePreset(queryClient, 'inventoryChange');
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
      void invalidateDomain(queryClient, 'items');
      toast.success(res?.message || 'موجودی با موفقیت با ووکامرس همگام‌سازی شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در همگام‌سازی کالا با ووکامرس');
    },
  });
}

/** v10.0.204 (OBS-R1-75): پس از ذخیره کالا یا ورود اکسل همه کش‌های کالا و قیمت باطل می‌شوند، نه فقط صفحه جاری */
export function useItemChangeRefresh(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => { void invalidatePreset(queryClient, 'itemChange'); }, [queryClient]);
}

/** one page of the gallery: its items with a picture, and the server's page count */
export interface GalleryItemsPage { rows: Item[]; totalPages: number }

/**
 * 10.3 (ARCH review finding 3, part 16): a gallery page, read again on each visit and for each filter and page; under the
 * items key, so an item save or a stock change refreshes the page on screen
 */
export function useGalleryItemsQuery(q: GalleryQuery) {
  return useQuery<GalleryItemsPage>({
    queryKey: [...QUERY_KEYS.items.all, 'gallery', q] as const,
    queryFn: async ({ signal }) => {
      const res = await fetchJson<unknown>(galleryItemsUrl(q), { signal });
      const page = res as { data?: unknown; totalPages?: unknown } | null;
      const rows = Array.isArray(page?.data) ? page.data : Array.isArray(res) ? res : [];
      return { rows: rows as Item[], totalPages: Math.max(1, Number(page?.totalPages) || 1) };
    },
    ...READ_ON_EVERY_OPENING,
  });
}

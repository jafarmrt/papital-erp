import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { WcCatalogReport } from '../../lib/woocommerce/wcCatalog';
import { READ_ON_EVERY_OPENING } from './readOnEveryOpening';

/** 10.3 (ARCH review finding 3, part 13): every read of the WooCommerce tab, which a shop write refreshes together */
export const WC_KEY = ['woocommerce'] as const;
/** 10.2 package 6 (D-04 part A): the online shop catalog links of the WooCommerce tab */
export const WC_CATALOG_KEY = [...WC_KEY, 'catalog'] as const;
export const WC_ORDERS_KEY = [...WC_KEY, 'orders'] as const;

export function useWcCatalogQuery() {
  return useQuery<WcCatalogReport>({
    queryKey: WC_CATALOG_KEY,
    queryFn: async () => (await fetchJson('/woocommerce/catalog')) as WcCatalogReport,
    staleTime: 0,
  });
}

export interface WcRefreshResult {
  success?: boolean;
  message?: string;
  error?: string;
}

export function useRefreshWcCatalogMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    // v11 phase 6.5 (#322 review note 2): sent again with the number of closings the user confirmed
    mutationFn: async (confirmClose?: number) => (await fetchJson('/woocommerce/refresh-products', confirmClose !== undefined
      ? { method: 'POST', body: JSON.stringify({ confirmClose }) } : { method: 'POST' })) as WcRefreshResult,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: WC_CATALOG_KEY }); },
  });
}

/** part B: «ارسال خودکار موجودی» on or off; the server takes the target state, never a toggle */
export function useSetWcAutoPushMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => (await fetchJson('/woocommerce/auto-push', {
      method: 'POST', body: JSON.stringify({ enabled }),
    })) as WcRefreshResult,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: WC_CATALOG_KEY }); },
  });
}

/** part C: the price list whose prices go to the shop ('' stops the price push) */
export function useSetWcPriceListMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (priceList: string) => (await fetchJson('/woocommerce/price-list', {
      method: 'POST', body: JSON.stringify({ priceList }),
    })) as WcRefreshResult,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: WC_CATALOG_KEY }); },
  });
}

/** part C: «تغییر خودکار کد در سایت» on or off, the target state */
export function useSetWcSkuRenameMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => (await fetchJson('/woocommerce/sku-rename', {
      method: 'POST', body: JSON.stringify({ enabled }),
    })) as WcRefreshResult,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: WC_CATALOG_KEY }); },
  });
}

/** v11 phase 6.5 (part D): «ارسال تصویر شاخص» on or off, with the program's public address to turn it on */
export function useSetWcImagePushMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { enabled: boolean; mediaBaseUrl?: string }) => (await fetchJson('/woocommerce/image-push', {
      method: 'POST', body: JSON.stringify(body),
    })) as WcRefreshResult,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: WC_CATALOG_KEY }); },
  });
}

/** part D: «ارسال کالکشن‌ها» on or off, the target state */
export function useSetWcCollectionPushMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => (await fetchJson('/woocommerce/collection-push', {
      method: 'POST', body: JSON.stringify({ enabled }),
    })) as WcRefreshResult,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: WC_CATALOG_KEY }); },
  });
}

/**
 * 10.3 (ARCH review finding 3, part 13): the invoices made from shop orders and the order log, read again on each opening
 * of the WooCommerce tab (v10.0.227, OBS-PR-17: only that tab reads them) and refreshed by an order fetched by hand
 */
function useWcOrderListQuery(list: 'synced' | 'logs', url: string) {
  return useQuery({
    queryKey: [...WC_ORDERS_KEY, list],
    queryFn: async ({ signal }) => {
      const res: unknown = await fetchJson(url, { signal });
      return Array.isArray(res) ? (res as unknown[]) : [];
    },
    ...READ_ON_EVERY_OPENING,
  });
}

export const useWcSyncedOrdersQuery = () => useWcOrderListQuery('synced', '/woocommerce/synced-orders');
export const useWcOrderLogsQuery = () => useWcOrderListQuery('logs', '/woocommerce/order-logs');

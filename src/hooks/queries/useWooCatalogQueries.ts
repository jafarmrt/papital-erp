import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { WcCatalogReport } from '../../lib/woocommerce/wcCatalog';

/** 10.2 package 6 (D-04 part A): the online shop catalog links of the WooCommerce tab */
export const WC_CATALOG_KEY = ['woocommerce', 'catalog'] as const;

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
    mutationFn: async () => (await fetchJson('/woocommerce/refresh-products', { method: 'POST' })) as WcRefreshResult,
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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { StorefrontShopInfoInput, StorefrontShopInfoView } from '../../lib/storefront/storefrontShopInfoContracts';
import { STOREFRONT_KEY } from './useStorefrontQueries';

/** v12 phase 10a: «اطلاعات فروشگاه» of «کالاها و تنظیمات سایت» */
export const STOREFRONT_SHOP_INFO_KEY = [...STOREFRONT_KEY, 'shop-info'] as const;

export function useStorefrontShopInfoQuery() {
  return useQuery<StorefrontShopInfoView>({
    queryKey: STOREFRONT_SHOP_INFO_KEY,
    queryFn: async () => ((await fetchJson('/storefront/shop-info')) as { data: StorefrontShopInfoView }).data,
    staleTime: 0,
  });
}

export function useSaveStorefrontShopInfoMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StorefrontShopInfoInput) => ((await fetchJson('/storefront/shop-info', {
      method: 'PUT', body: JSON.stringify(input),
    })) as { data: StorefrontShopInfoView }).data,
    onSuccess: (view) => { queryClient.setQueryData(STOREFRONT_SHOP_INFO_KEY, view); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: STOREFRONT_SHOP_INFO_KEY }); },
  });
}

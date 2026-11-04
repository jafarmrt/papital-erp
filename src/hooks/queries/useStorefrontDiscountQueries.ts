import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { DiscountCodeInput, DiscountCodeRow, DiscountCodesView } from '../../lib/storefront/storefrontDiscountContracts';
import { STOREFRONT_KEY } from './useStorefrontQueries';

/** v11 phase 8.2c: the «کدهای تخفیف» section of the «فروشگاه سایت» tab */
export const DISCOUNT_CODES_KEY = [...STOREFRONT_KEY, 'discounts'] as const;

export function useDiscountCodesQuery() {
  return useQuery<DiscountCodesView>({
    queryKey: DISCOUNT_CODES_KEY,
    queryFn: async () => ((await fetchJson('/storefront/discounts')) as { data: DiscountCodesView }).data,
    staleTime: 0,
  });
}

export function useSaveDiscountCodeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version, input }: { id: number | null; version: number; input: DiscountCodeInput }) => (
      (await fetchJson(id === null ? '/storefront/discounts' : `/storefront/discounts/${id}`, {
        method: id === null ? 'POST' : 'PUT',
        body: JSON.stringify(id === null ? input : { ...input, version }),
      })) as { data: DiscountCodeRow }).data,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: DISCOUNT_CODES_KEY }); },
  });
}

export function useDeleteDiscountCodeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version }: { id: number; version: number }) => fetchJson(`/storefront/discounts/${id}?version=${version}`, { method: 'DELETE' }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: DISCOUNT_CODES_KEY }); },
  });
}

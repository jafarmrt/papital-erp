import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { CollectionTextList, CollectionTextRow, CollectionTextSaveInput } from '../../lib/storefront/storefrontCollectionContracts';
import { STOREFRONT_KEY } from './useStorefrontQueries';

/** v12 phase 10e: «کالکشن‌های سایت» of the sidebar's «فروشگاه سایت» */
export const COLLECTIONS_KEY = [...STOREFRONT_KEY, 'collections'] as const;

export function useCollectionTextsQuery() {
  return useQuery<CollectionTextList>({
    queryKey: COLLECTIONS_KEY,
    queryFn: async () => (await fetchJson('/storefront/collections')) as CollectionTextList,
    staleTime: 0,
  });
}

/** The words of one collection, saved under the version the screen read */
export function useSaveCollectionTextMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CollectionTextSaveInput) => ((await fetchJson('/storefront/collections', { method: 'PUT', body: JSON.stringify(input) })) as { data: CollectionTextRow }).data,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: COLLECTIONS_KEY }); },
  });
}

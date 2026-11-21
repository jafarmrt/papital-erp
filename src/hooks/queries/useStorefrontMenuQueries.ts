import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { MenuLinkOptions, MenuSaveInput, MenuView, MenusView } from '../../lib/storefront/storefrontMenuContracts';
import type { MenuLocation } from '../../lib/storefront/storefrontMenuRules';
import { STOREFRONT_KEY } from './useStorefrontQueries';

/** v12 phase 9b: «منوهای سایت», the site's menu builder */
export const MENUS_KEY = [...STOREFRONT_KEY, 'menus'] as const;

export function useMenusQuery() {
  return useQuery<MenusView>({
    queryKey: MENUS_KEY,
    queryFn: async ({ signal }) => ((await fetchJson('/storefront/menus', { signal })) as { data: MenusView }).data,
    staleTime: 0,
  });
}

export function useMenuLinkOptionsQuery() {
  return useQuery<MenuLinkOptions>({
    queryKey: [...MENUS_KEY, 'link-options'],
    queryFn: async ({ signal }) => ((await fetchJson('/storefront/menus/link-options', { signal })) as { data: MenuLinkOptions }).data,
    staleTime: 30_000,
  });
}

export function useSaveMenuMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ location, input }: { location: MenuLocation; input: MenuSaveInput }) => (
      (await fetchJson(`/storefront/menus/${location}`, { method: 'PUT', body: JSON.stringify(input) })) as { data: MenuView }).data,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: MENUS_KEY }); },
  });
}

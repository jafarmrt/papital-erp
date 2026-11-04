import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { CampaignHeroOptionPage, CampaignInput, CampaignRow, CampaignsView } from '../../lib/storefront/storefrontCampaignContracts';
import { STOREFRONT_KEY } from './useStorefrontQueries';

/** v11 phase 8.5b: the «صفحه‌های ویژه» section of the «فروشگاه سایت» tab */
export const CAMPAIGNS_KEY = [...STOREFRONT_KEY, 'campaigns'] as const;
export const HERO_OPTIONS_PAGE_SIZE = 24;

export function useCampaignsQuery() {
  return useQuery<CampaignsView>({
    queryKey: CAMPAIGNS_KEY,
    queryFn: async () => ((await fetchJson('/storefront/campaigns')) as { data: CampaignsView }).data,
    staleTime: 0,
  });
}

export function useCampaignHeroOptionsQuery(q: string, page: number, enabled: boolean) {
  return useQuery<CampaignHeroOptionPage>({
    queryKey: [...CAMPAIGNS_KEY, 'hero-images', q, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(HERO_OPTIONS_PAGE_SIZE) });
      if (q.trim()) params.set('q', q.trim());
      return (await fetchJson(`/storefront/campaigns/hero-images?${params.toString()}`)) as CampaignHeroOptionPage;
    },
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useSaveCampaignMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version, input }: { id: number | null; version: number; input: CampaignInput }) => (
      (await fetchJson(id === null ? '/storefront/campaigns' : `/storefront/campaigns/${id}`, {
        method: id === null ? 'POST' : 'PUT',
        body: JSON.stringify(id === null ? input : { ...input, version }),
      })) as { data: CampaignRow }).data,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: CAMPAIGNS_KEY }); },
  });
}

export function useDeleteCampaignMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version }: { id: number; version: number }) => fetchJson(`/storefront/campaigns/${id}?version=${version}`, { method: 'DELETE' }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: CAMPAIGNS_KEY }); },
  });
}

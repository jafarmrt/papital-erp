import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { RedirectSource } from '../../lib/storefront/storefrontSeoRules';
import type {
  StorefrontRedirectImportResult, StorefrontRedirectInput, StorefrontRedirectPage, StorefrontRedirectRow, StorefrontSeoSettingsInput,
  StorefrontSeoSettingsView,
} from '../../lib/storefront/storefrontSeoContracts';
import { STOREFRONT_KEY } from './useStorefrontQueries';

/** v11 phase 8.5: the search and statistics settings and the old-address redirects of the «فروشگاه سایت» tab */
export const STOREFRONT_SEO_KEY = [...STOREFRONT_KEY, 'seo'] as const;
export const STOREFRONT_REDIRECTS_KEY = [...STOREFRONT_KEY, 'redirects'] as const;
export const STOREFRONT_REDIRECTS_PAGE_SIZE = 50;

export function useStorefrontSeoQuery() {
  return useQuery<StorefrontSeoSettingsView>({
    queryKey: STOREFRONT_SEO_KEY,
    queryFn: async () => ((await fetchJson('/storefront/seo')) as { data: StorefrontSeoSettingsView }).data,
    staleTime: 0,
  });
}

export function useSaveStorefrontSeoMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StorefrontSeoSettingsInput) => ((await fetchJson('/storefront/seo', {
      method: 'PUT', body: JSON.stringify(input),
    })) as { data: StorefrontSeoSettingsView }).data,
    onSuccess: (view) => { queryClient.setQueryData(STOREFRONT_SEO_KEY, view); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: STOREFRONT_SEO_KEY }); },
  });
}

export interface StorefrontRedirectFilter {
  page: number;
  q: string;
  source: RedirectSource | '';
}

export function useStorefrontRedirectsQuery(filter: StorefrontRedirectFilter) {
  return useQuery<StorefrontRedirectPage>({
    queryKey: [...STOREFRONT_REDIRECTS_KEY, filter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(filter.page), limit: String(STOREFRONT_REDIRECTS_PAGE_SIZE) });
      if (filter.q.trim()) params.set('q', filter.q.trim());
      if (filter.source) params.set('source', filter.source);
      return (await fetchJson(`/storefront/redirects?${params.toString()}`)) as StorefrontRedirectPage;
    },
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
}

export function useSaveStorefrontRedirectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version, input }: { id: number | null; version: number; input: StorefrontRedirectInput }) => (
      (await fetchJson(id === null ? '/storefront/redirects' : `/storefront/redirects/${id}`, {
        method: id === null ? 'POST' : 'PUT',
        body: JSON.stringify(id === null ? input : { ...input, version }),
      })) as { data: StorefrontRedirectRow }).data,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: STOREFRONT_REDIRECTS_KEY }); },
  });
}

export function useToggleStorefrontRedirectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active, version }: { id: number; active: boolean; version: number }) => ((await fetchJson(`/storefront/redirects/${id}/active`, {
      method: 'PUT', body: JSON.stringify({ active, version }),
    })) as { data: StorefrontRedirectRow }).data,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: STOREFRONT_REDIRECTS_KEY }); },
  });
}

export function useDeleteStorefrontRedirectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version }: { id: number; version: number }) => fetchJson(`/storefront/redirects/${id}?version=${version}`, { method: 'DELETE' }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: STOREFRONT_REDIRECTS_KEY }); },
  });
}

export function useImportStorefrontRedirectsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => ((await fetchJson('/storefront/redirects/import', { method: 'POST', body: JSON.stringify({}) })) as {
      data: StorefrontRedirectImportResult;
    }).data,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: STOREFRONT_REDIRECTS_KEY }); },
  });
}

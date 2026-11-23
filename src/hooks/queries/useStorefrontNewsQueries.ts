import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { NewsCreateInput, NewsDetail, NewsList, NewsSaveInput } from '../../lib/storefront/storefrontNewsContracts';
import { STOREFRONT_KEY } from './useStorefrontQueries';

/** v12 phase 10d: «خبرهای سایت» of the sidebar's «فروشگاه سایت» */
export const NEWS_KEY = [...STOREFRONT_KEY, 'news'] as const;

export function useNewsListQuery(page: number) {
  return useQuery<NewsList>({
    queryKey: [...NEWS_KEY, 'list', page],
    queryFn: async () => (await fetchJson(`/storefront/news?page=${page}`)) as NewsList,
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
}

export function useNewsQuery(id: number | null) {
  return useQuery<NewsDetail>({
    queryKey: [...NEWS_KEY, 'detail', id],
    queryFn: async () => ((await fetchJson(`/storefront/news/${id}`)) as { data: NewsDetail }).data,
    enabled: id !== null,
    staleTime: 0,
  });
}

export function useCreateNewsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewsCreateInput) => ((await fetchJson('/storefront/news', { method: 'POST', body: JSON.stringify(input) })) as { data: NewsDetail }).data,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: NEWS_KEY }); },
  });
}

export function useSaveNewsMutation(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewsSaveInput) => ((await fetchJson(`/storefront/news/${id}`, { method: 'PUT', body: JSON.stringify(input) })) as { data: NewsDetail }).data,
    onSuccess: (detail) => { queryClient.setQueryData([...NEWS_KEY, 'detail', id], detail); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: NEWS_KEY }); },
  });
}

/** «خبرها روی سایت بیایند»: the switch is sent the state it should take */
export function useNewsOnSiteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => ((await fetchJson('/storefront/news/site', { method: 'PUT', body: JSON.stringify({ enabled }) })) as { data: { enabled: boolean } }).data,
    // the lists on the screen show the new state at once, before they are read again
    onSuccess: (now) => {
      queryClient.setQueriesData<NewsList>({ queryKey: [...NEWS_KEY, 'list'] }, old => (old ? { ...old, siteEnabled: now.enabled } : old));
    },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: [...NEWS_KEY, 'list'] }); },
  });
}

export type NewsAction = 'publish' | 'revert' | 'unpublish';

/** «انتشار», «برگرداندن به نسخهٔ روی سایت» and «برداشتن از سایت», each under the item's version */
export function useNewsActionMutation(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, version }: { action: NewsAction; version: number }) => (
      (await fetchJson(`/storefront/news/${id}/${action}`, { method: 'POST', body: JSON.stringify({ version }) })) as { data: NewsDetail }).data,
    onSuccess: (detail) => { queryClient.setQueryData([...NEWS_KEY, 'detail', id], detail); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: NEWS_KEY }); },
  });
}

export function useDeleteNewsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version }: { id: number; version: number }) => fetchJson(`/storefront/news/${id}?version=${version}`, { method: 'DELETE' }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: NEWS_KEY }); },
  });
}

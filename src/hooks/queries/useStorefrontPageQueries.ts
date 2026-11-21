import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { CampaignHeroOptionPage } from '../../lib/storefront/storefrontCampaignContracts';
import type { PageCreateInput, PageDetail, PageListRow, PageSaveInput } from '../../lib/storefront/storefrontPageContracts';
import { STOREFRONT_KEY } from './useStorefrontQueries';

/** v12 phase 10b: «صفحه‌های سایت», the page builder of the sidebar's «فروشگاه سایت» */
export const PAGES_KEY = [...STOREFRONT_KEY, 'pages'] as const;
export const PAGE_IMAGE_OPTIONS_PAGE_SIZE = 24;

export function usePagesQuery() {
  return useQuery<PageListRow[]>({
    queryKey: [...PAGES_KEY, 'list'],
    queryFn: async () => ((await fetchJson('/storefront/pages')) as { data: PageListRow[] }).data,
    staleTime: 0,
  });
}

export function usePageQuery(id: number | null) {
  return useQuery<PageDetail>({
    queryKey: [...PAGES_KEY, 'detail', id],
    queryFn: async () => ((await fetchJson(`/storefront/pages/${id}`)) as { data: PageDetail }).data,
    enabled: id !== null,
    staleTime: 0,
  });
}

/** The images of the media library a page may name; read only while the picker is open (it needs «مشاهده کتابخانه تصاویر») */
export function usePageImageOptionsQuery(q: string, page: number, enabled: boolean) {
  return useQuery<CampaignHeroOptionPage>({
    queryKey: [...PAGES_KEY, 'image-options', q, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_IMAGE_OPTIONS_PAGE_SIZE) });
      if (q.trim()) params.set('q', q.trim());
      return (await fetchJson(`/storefront/pages/image-options?${params.toString()}`)) as CampaignHeroOptionPage;
    },
    enabled,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}

export function useCreatePageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PageCreateInput) => ((await fetchJson('/storefront/pages', { method: 'POST', body: JSON.stringify(input) })) as { data: PageDetail }).data,
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: PAGES_KEY }); },
  });
}

export function useSavePageMutation(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PageSaveInput) => ((await fetchJson(`/storefront/pages/${id}`, { method: 'PUT', body: JSON.stringify(input) })) as { data: PageDetail }).data,
    onSuccess: (detail) => { queryClient.setQueryData([...PAGES_KEY, 'detail', id], detail); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: PAGES_KEY }); },
  });
}

export type PageAction = 'publish' | 'revert' | 'unpublish';

/** «انتشار», «برگرداندن به نسخهٔ روی سایت» and «برداشتن از سایت», each under the page's version */
export function usePageActionMutation(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, version }: { action: PageAction; version: number }) => (
      (await fetchJson(`/storefront/pages/${id}/${action}`, { method: 'POST', body: JSON.stringify({ version }) })) as { data: PageDetail }).data,
    onSuccess: (detail) => { queryClient.setQueryData([...PAGES_KEY, 'detail', id], detail); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: PAGES_KEY }); },
  });
}

export function useDeletePageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version }: { id: number; version: number }) => fetchJson(`/storefront/pages/${id}?version=${version}`, { method: 'DELETE' }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: PAGES_KEY }); },
  });
}

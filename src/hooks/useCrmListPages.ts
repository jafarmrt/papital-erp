import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../api';
import { normalizeLeadStage } from './useCRMFilters';
import type { CRMActivity, CRMLead } from '../types';
import {
  CRM_ACTIVITY_PAGE_QUERY_KEY,
  CRM_LEAD_PAGE_QUERY_KEY,
  activityPageUrl,
  leadPageUrl,
  toCrmPage,
  type ActivityPage,
  type ActivityPageQuery,
  type LeadPage,
} from '../lib/crm/crmListPages';

interface PageState {
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

/**
 * v10.2 package 7 (OBS-R2-28): one page of the sales file table from the server. `useCRMData` invalidates
 * `CRM_LEAD_PAGE_QUERY_KEY` after every change, like the follow-up list.
 */
export function useCrmLeadPage(filters: URLSearchParams, page: number, limit: number, enabled = true): LeadPage & PageState {
  const url = leadPageUrl(filters, page, limit);
  const result = useQuery({
    queryKey: [...CRM_LEAD_PAGE_QUERY_KEY, url],
    queryFn: async ({ signal }) => {
      const res = toCrmPage<CRMLead>(await fetchJson(url, { signal }), page, limit);
      return { ...res, data: res.data.map((l) => ({ ...l, stage: normalizeLeadStage(l.stage) })) };
    },
    enabled,
    staleTime: 30 * 1000,
    placeholderData: (previous) => previous,
  });
  const empty: LeadPage = { data: [], total: 0, page, limit, totalPages: 1 };
  return {
    ...(result.data ?? empty),
    loading: result.isFetching,
    error: result.isError ? errorText(result.error, 'فهرست پرونده‌های فروش دریافت نشد.') : null,
    refetch: () => void result.refetch(),
  };
}

/** v10.2 package 7 (OBS-R2-28): one page of the activity book (or of one party's activities) from the server */
export function useCrmActivityPage(query: ActivityPageQuery, enabled = true): ActivityPage & PageState {
  const url = activityPageUrl(query);
  const result = useQuery({
    queryKey: [...CRM_ACTIVITY_PAGE_QUERY_KEY, url],
    queryFn: async ({ signal }) => toCrmPage<CRMActivity>(await fetchJson(url, { signal }), query.page, query.limit),
    enabled,
    staleTime: 30 * 1000,
    placeholderData: (previous) => previous,
  });
  const empty: ActivityPage = { data: [], total: 0, page: query.page, limit: query.limit, totalPages: 1 };
  return {
    ...(result.data ?? empty),
    loading: result.isFetching,
    error: result.isError ? errorText(result.error, 'فهرست اقدام‌ها دریافت نشد.') : null,
    refetch: () => void result.refetch(),
  };
}

/**
 * v10.2 package 7 review (N-4): the page of a server-paged list, back to 1 in the same render its conditions change, so
 * the request of the new conditions never asks the old page; `filterKey` is every condition joined. 10.3 package 7: the
 * reset is kept (React's "state from the previous render" pattern), so going back to earlier conditions starts on page 1
 * too, never on the page those conditions showed before.
 */
export function useFilterPage(filterKey: string): [number, (page: number) => void] {
  const [state, setState] = useState({ key: filterKey, page: 1 });
  if (state.key !== filterKey) setState({ key: filterKey, page: 1 });
  const page = state.key === filterKey ? state.page : 1;
  const setPage = useCallback((next: number) => setState({ key: filterKey, page: Math.max(1, next) }), [filterKey]);
  return [page, setPage];
}

/** v10.2 package 7 review (N-4): after a removal leaves fewer pages, the list moves to its new last page */
export function useClampPage(page: number, list: { totalPages: number; loading: boolean; error: string | null }, setPage: (page: number) => void): void {
  const { totalPages, loading, error } = list;
  useEffect(() => {
    if (!loading && !error && totalPages >= 1 && page > totalPages) setPage(totalPages);
  }, [page, totalPages, loading, error, setPage]);
}

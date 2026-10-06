import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../api';
import { CRM_FOLLOWUPS_QUERY_KEY, followupsUrl, toFollowupPage, type FollowupPage, type FollowupQuery } from '../lib/crm/crmFollowupsQuery';

const EMPTY: Omit<FollowupPage, 'page' | 'limit'> = { data: [], total: 0, totalPages: 1, dueCount: 0, openCount: 0 };

/**
 * v9.0.14 (TD-428): پیگیری‌ها از `GET /crm/followups`؛ پس از هر ثبت یا تکمیل اقدام، `useCRMData` کلید
 * `CRM_FOLLOWUPS_QUERY_KEY` را باطل می‌کند.
 */
export function useCrmFollowups(query: FollowupQuery, enabled = true): FollowupPage & { loading: boolean } {
  const url = followupsUrl(query);
  const result = useQuery({
    queryKey: [...CRM_FOLLOWUPS_QUERY_KEY, url],
    queryFn: async ({ signal }) => toFollowupPage(await fetchJson(url, { signal }), query),
    enabled,
    staleTime: 60 * 1000,
    placeholderData: (previous) => previous,
  });
  return { ...(result.data ?? { ...EMPTY, page: query.page, limit: query.limit }), loading: result.isFetching };
}

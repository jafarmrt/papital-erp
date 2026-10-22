import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { DailyWorkLog } from '../../types';
import { EMPTY_DAILY_LOG_STATS, type DailyLogStats } from '../../lib/dailyLogs/dailyLogStats';
import { QUERY_KEYS } from '../../lib/queryKeys';

/**
 * v10.2 package 11 part 5b (TD-1360, OBS-R2-102): the daily log page reads through React Query. Its list, statistics
 * and management summary live under `daily-logs` with the dashboard's daily logs, so a save, delete or review on the
 * page refreshes both; the project pick list is `useProjectPickQuery`, the cache of the other forms; each request is
 * cancelled when its screen closes.
 */

export interface DailyLogListParams {
  filterType: 'all' | 'mine' | 'mentioned';
  page: number;
  limit: number;
  workMode: string;
  date: string;
  search: string;
}

export interface DailyLogListPage { rows: DailyWorkLog[]; total: number }

export interface DailyLogSummaryParams { mode: 'daily' | 'monthly'; date: string; yearMonth: string; userId: string }

export function dailyLogListUrl(p: DailyLogListParams): string {
  let url = `/daily-logs?filter_type=${p.filterType}&page=${p.page}&limit=${p.limit}`;
  if (p.workMode) url += `&work_mode=${p.workMode}`;
  if (p.date) url += `&date=${encodeURIComponent(p.date)}`;
  if (p.search) url += `&search=${encodeURIComponent(p.search)}`;
  return url;
}

export function dailyLogSummaryUrl(p: DailyLogSummaryParams): string {
  let url = `/daily-logs/summary-report?report_type=${p.mode}`;
  url += p.mode === 'daily' ? `&date=${encodeURIComponent(p.date)}` : `&year_month=${encodeURIComponent(p.yearMonth)}`;
  if (p.userId && p.userId !== '0') url += `&user_id=${p.userId}`;
  return url;
}

export function useDailyLogListQuery(params: DailyLogListParams, enabled: boolean) {
  return useQuery<DailyLogListPage>({
    queryKey: QUERY_KEYS.dailyLogs.list(params),
    queryFn: async ({ signal }) => {
      const res = await fetchJson(dailyLogListUrl(params), { signal }) as { data?: unknown; total?: unknown } | unknown[] | null;
      const rows = (Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : [])) as DailyWorkLog[];
      const total = !Array.isArray(res) && typeof res?.total === 'number' ? res.total : rows.length;
      return { rows, total };
    },
    // the list keeps the logs it shows while the next page or search conditions load
    placeholderData: keepPreviousData,
    // opening the page reads again what other users wrote, as it did before; the cached logs show meanwhile
    refetchOnMount: 'always',
    enabled,
  });
}

export function useDailyLogStatsQuery() {
  return useQuery<DailyLogStats>({
    queryKey: QUERY_KEYS.dailyLogs.stats(),
    queryFn: async ({ signal }) => ({ ...EMPTY_DAILY_LOG_STATS, ...((await fetchJson('/daily-logs/stats', { signal })) as Partial<DailyLogStats> | null) }),
    refetchOnMount: 'always',
  });
}

export function useDailyLogSummaryQuery<T>(params: DailyLogSummaryParams, enabled: boolean) {
  return useQuery<T | null>({
    queryKey: QUERY_KEYS.dailyLogs.summary(params),
    queryFn: async ({ signal }) => ((await fetchJson(dailyLogSummaryUrl(params), { signal })) ?? null) as T | null,
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
    enabled,
  });
}

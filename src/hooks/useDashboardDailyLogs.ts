import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../api';
import type { DailyWorkLog } from '../types';
import { EMPTY_DAILY_LOG_STATS, type DailyLogStats } from '../lib/dailyLogs/dailyLogStats';

const DASHBOARD_DAILY_LOGS_KEY = ['dailyLogs', 'dashboard'] as const;

const listData = (res: unknown): DailyWorkLog[] => {
  const data = (res as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data : (Array.isArray(res) ? res : []);
};

/**
 * v9.0.250 (TD-639, finding B13-14): the dashboard reads daily logs only for a holder of `daily_logs.view` (`enabled`),
 * with just the requests it shows: the latest visible logs for the calendar, the logs that mention the user for the
 * widget, and the statistics. It never loads the users and projects of the log form and shows no error toast; a user
 * without the permission sends no request at all.
 */
export function useDashboardDailyLogs(enabled: boolean): {
  logs: DailyWorkLog[]; mentionedLogs: DailyWorkLog[]; stats: DailyLogStats; loading: boolean;
} {
  const query = <T,>(name: string, url: string, read: (res: unknown) => T) => ({
    queryKey: [...DASHBOARD_DAILY_LOGS_KEY, name],
    queryFn: async ({ signal }: { signal: AbortSignal }) => read(await fetchJson(url, { signal })),
    enabled,
    staleTime: 60 * 1000,
  });
  const logs = useQuery(query('latest', '/daily-logs?filter_type=all&page=1&limit=50', listData));
  const mentioned = useQuery(query('mentioned', '/daily-logs?filter_type=mentioned&page=1&limit=30', listData));
  const stats = useQuery(query('stats', '/daily-logs/stats', (res) => ({ ...EMPTY_DAILY_LOG_STATS, ...(res as Partial<DailyLogStats>) })));
  return {
    logs: logs.data ?? [],
    mentionedLogs: mentioned.data ?? [],
    stats: stats.data ?? EMPTY_DAILY_LOG_STATS,
    loading: enabled && (logs.isLoading || mentioned.isLoading || stats.isLoading),
  };
}

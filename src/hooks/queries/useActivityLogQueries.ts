import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';

export interface ActivityLogFilters {
  page?: number;
  limit?: number;
  search?: string;
  user?: string;
  action?: string;
  entity?: string;
  category?: string;
  startDate?: string;
  endDate?: string;
}

export interface ActivityLogItem {
  id: number;
  username: string;
  userFullName?: string;
  action: string;
  entity: string;
  entityId?: number | string | null;
  description: string;
  details?: any;
  ipAddress?: string;
  createdAt?: string;
  timestamp?: string;
}

export function useActivityLogsQuery(filters: ActivityLogFilters) {
  return useQuery({
    queryKey: QUERY_KEYS.activityLogs.list(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(filters.page ?? 1));
      params.set('limit', String(filters.limit ?? 30));
      if (filters.search?.trim()) params.set('search', filters.search.trim());
      if (filters.user) params.set('user', filters.user);
      if (filters.action) params.set('action', filters.action);
      if (filters.entity) params.set('entity', filters.entity);
      if (filters.category) params.set('category', filters.category);
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);

      const res = await fetchJson(`/activity-logs?${params.toString()}`);
      // V9: گارد استاندارد آرایه — پاسخ صفحه‌بندی‌شده یا آرایه خام
      const rawData = Array.isArray(res?.data)
        ? res.data
        : (Array.isArray(res) ? res : []);
      return {
        logs: rawData as ActivityLogItem[],
        total: res?.total || 0,
        totalPages: res?.totalPages || 1,
      };
    },
    staleTime: 30 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (prev: any) => prev,
  });
}

export function useActivityLogFilterOptionsQuery() {
  return useQuery({
    queryKey: QUERY_KEYS.activityLogs.filters(),
    queryFn: async () => {
      const res = await fetchJson('/activity-logs/filters');
      return {
        users: Array.isArray(res?.users) ? res.users : [],
        actions: Array.isArray(res?.actions) ? res.actions : [],
        entities: Array.isArray(res?.entities) ? res.entities : [],
      };
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export interface AuditLogIntegrityReport {
  healthy: boolean;
  totalLogs: number;
  criticalLogsCount: number;
  earliestTimestamp: string | null;
  latestTimestamp: string | null;
  minRetentionDays: number;
}

export function useAuditLogIntegrityQuery() {
  return useQuery<AuditLogIntegrityReport>({
    queryKey: ['activity-logs', 'integrity'],
    queryFn: async () => {
      return await fetchJson('/activity-logs/integrity');
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/** دسترسی imperative به invalidation لاگ‌ها برای فراخوانی پس از ثبت ممیزی یا تنظیمات */
export function useInvalidateActivityLogs() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.activityLogs.all });
    queryClient.invalidateQueries({ queryKey: ['activity-logs', 'integrity'] });
  };
}

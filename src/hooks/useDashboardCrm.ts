import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../api';
import type { CRMActivity, CRMLead } from '../types';
import { getPastJalaliDate, getTodayJalaliDate } from '../utils';
import { buildActivityQueryParams, normalizeLeadStage } from './useCRMFilters';
import { CRM_FOLLOWUPS_QUERY_KEY } from '../lib/crm/crmFollowupsQuery';

/** کلید داده ارتباط با مشتریِ پیشخوان */
export const DASHBOARD_CRM_QUERY_KEY = ['crm', 'dashboard'] as const;

/**
 * v9.0.290 (TD-674، B16-10): پیشخوان فقط پرونده‌های فروش و اقدام‌های ۳۰ روز اخیر را می‌خواند، و فقط برای دارنده `crm.view`.
 * پیش‌تر `useCRMData` کامل صفحه ارتباط با مشتری برای هر کاربری اجرا می‌شد: آمار، طرف حساب‌ها، پرسنل و کاربران که پیشخوان
 * نشان نمی‌دهد، و برای کاربر بی مجوز دو پیام خطا در هر بار باز شدن.
 */
export function useDashboardCrm(enabled: boolean): {
  leads: CRMLead[];
  activities: CRMActivity[];
  loading: boolean;
  refresh: () => void;
} {
  const queryClient = useQueryClient();
  const leadsQuery = useQuery({
    queryKey: [...DASHBOARD_CRM_QUERY_KEY, 'leads'],
    queryFn: async ({ signal }) => {
      const res = await fetchJson('/crm/leads', { signal });
      const raw: CRMLead[] = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
      return raw.map(l => ({ ...l, stage: normalizeLeadStage(l.stage) }));
    },
    enabled,
    staleTime: 60 * 1000,
  });
  const activitiesQuery = useQuery({
    queryKey: [...DASHBOARD_CRM_QUERY_KEY, 'activities'],
    queryFn: async ({ signal }) => {
      const params = buildActivityQueryParams(getPastJalaliDate(30), getTodayJalaliDate());
      const res = await fetchJson(`/crm/activities?${params.toString()}`, { signal });
      return (Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : [])) as CRMActivity[];
    },
    enabled,
    staleTime: 60 * 1000,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: DASHBOARD_CRM_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: CRM_FOLLOWUPS_QUERY_KEY });
  }, [queryClient]);

  return {
    leads: enabled ? leadsQuery.data ?? [] : [],
    activities: enabled ? activitiesQuery.data ?? [] : [],
    loading: enabled && (leadsQuery.isFetching || activitiesQuery.isFetching),
    refresh,
  };
}

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { DashboardSummary, SalesChartParams, SalesChartSeries } from '../../lib/reports/reportCharts';
import { salesReportSearch } from '../../lib/reports/salesReport';

/**
 * v10.1.15 (D-03 بخش ۴، ت۱۴ و ت۱۶): داده نمودارهای زبانه فروش (`GET /reports/sales/charts`) و ابزارک فروش پیشخوان
 * (`GET /reports/dashboard-summary`). نمودار فقط با بازه، ارز و پالایه‌ها دوباره خوانده می‌شود، نه با تفکیک و صفحه جدول.
 */

const REPORT_CHART_STALE_MS = 30_000;

export function salesChartsUrl(params: SalesChartParams): string {
  const query = salesReportSearch(params);
  return query ? `/reports/sales/charts?${query}` : '/reports/sales/charts';
}

export function useSalesCharts(params: SalesChartParams) {
  return useQuery<SalesChartSeries>({
    queryKey: QUERY_KEYS.reports.salesCharts(params),
    queryFn: ({ signal }) => fetchJson<SalesChartSeries>(salesChartsUrl(params), { signal }),
    placeholderData: keepPreviousData,
    staleTime: REPORT_CHART_STALE_MS,
    retry: false,
  });
}

export function useDashboardSummary(enabled: boolean) {
  return useQuery<DashboardSummary>({
    queryKey: QUERY_KEYS.reports.dashboardSummary,
    queryFn: ({ signal }) => fetchJson<DashboardSummary>('/reports/dashboard-summary', { signal }),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

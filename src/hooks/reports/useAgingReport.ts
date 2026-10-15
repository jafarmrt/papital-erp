import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { agingReportSearch, type AgingReport, type AgingReportParams } from '../../lib/reports/agingReport';

/**
 * v10.1.10 (D-03): زبانه «سن مطالبات و بدهی‌ها» صفحه «گزارش‌های مدیریتی» (`GET /reports/aging`). مانده‌ها، بازه‌ها و
 * صفحه‌بندی در کارساز است؛ با تغییر پالایه صفحه قبلی تا رسیدن پاسخ تازه می‌ماند و پس از نیم دقیقه کهنه شمرده می‌شود.
 */

const AGING_REPORT_STALE_MS = 30_000;

export function agingReportUrl(params: Partial<AgingReportParams> & { export?: boolean }): string {
  const query = agingReportSearch(params);
  return query ? `/reports/aging?${query}` : '/reports/aging';
}

export function useAgingReport(params: AgingReportParams) {
  return useQuery<AgingReport>({
    queryKey: QUERY_KEYS.reports.aging(params),
    queryFn: ({ signal }) => fetchJson<AgingReport>(agingReportUrl(params), { signal }),
    placeholderData: keepPreviousData,
    staleTime: AGING_REPORT_STALE_MS,
    retry: false,
  });
}

/** همه ردیف‌های گزارش (تا سقف خروجی) برای اکسل */
export function fetchAgingReportExport(params: AgingReportParams): Promise<AgingReport> {
  const rest: Partial<AgingReportParams> = { ...params };
  delete rest.page;
  delete rest.limit;
  return fetchJson<AgingReport>(agingReportUrl({ ...rest, export: true }));
}

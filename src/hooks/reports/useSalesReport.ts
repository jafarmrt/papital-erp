import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { salesReportSearch, type SalesReport, type SalesReportParams } from '../../lib/reports/salesReport';

/**
 * v10.1.7 (D-03): گزارش فروش زبانه «فروش» صفحه «گزارش‌های مدیریتی» (`GET /reports/sales`). جمع‌ها و صفحه‌بندی در
 * کارساز است؛ با تغییر پالایه صفحه قبلی تا رسیدن پاسخ تازه می‌ماند. گزارش پس از نیم دقیقه کهنه شمرده می‌شود تا با
 * بازگشت به زبانه فاکتورهای تازه را نشان دهد.
 */

const SALES_REPORT_STALE_MS = 30_000;

export function salesReportUrl(params: Partial<SalesReportParams> & { export?: boolean }): string {
  const query = salesReportSearch(params);
  return query ? `/reports/sales?${query}` : '/reports/sales';
}

export function useSalesReport(params: SalesReportParams) {
  return useQuery<SalesReport>({
    queryKey: QUERY_KEYS.reports.sales(params),
    queryFn: ({ signal }) => fetchJson<SalesReport>(salesReportUrl(params), { signal }),
    placeholderData: keepPreviousData,
    staleTime: SALES_REPORT_STALE_MS,
    retry: false,
  });
}

/** همه ردیف‌های گزارش (تا سقف خروجی) برای اکسل */
export function fetchSalesReportExport(params: SalesReportParams): Promise<SalesReport> {
  const rest: Partial<SalesReportParams> = { ...params };
  delete rest.page;
  delete rest.limit;
  return fetchJson<SalesReport>(salesReportUrl({ ...rest, export: true }));
}

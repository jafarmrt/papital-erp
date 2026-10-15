import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { purchaseReportSearch, type PurchaseReport, type PurchaseReportParams } from '../../lib/reports/purchaseReport';

/**
 * v10.1.15 (D-03 بخش ۴، ت۱۵): زبانه «خرید» صفحه «گزارش‌های مدیریتی» (`GET /reports/purchases`). جمع‌ها و صفحه‌بندی در
 * کارساز است؛ با تغییر پالایه صفحه قبلی تا رسیدن پاسخ تازه می‌ماند و پس از نیم دقیقه کهنه شمرده می‌شود.
 */

const PURCHASE_REPORT_STALE_MS = 30_000;

export function purchaseReportUrl(params: Partial<PurchaseReportParams> & { export?: boolean }): string {
  const query = purchaseReportSearch(params);
  return query ? `/reports/purchases?${query}` : '/reports/purchases';
}

export function usePurchaseReport(params: PurchaseReportParams) {
  return useQuery<PurchaseReport>({
    queryKey: QUERY_KEYS.reports.purchases(params),
    queryFn: ({ signal }) => fetchJson<PurchaseReport>(purchaseReportUrl(params), { signal }),
    placeholderData: keepPreviousData,
    staleTime: PURCHASE_REPORT_STALE_MS,
    retry: false,
  });
}

/** همه ردیف‌های گزارش (تا سقف خروجی) برای اکسل */
export function fetchPurchaseReportExport(params: PurchaseReportParams): Promise<PurchaseReport> {
  const rest: Partial<PurchaseReportParams> = { ...params };
  delete rest.page;
  delete rest.limit;
  return fetchJson<PurchaseReport>(purchaseReportUrl({ ...rest, export: true }));
}

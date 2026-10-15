import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { vatReportSearch, type VatReport, type VatReportParams } from '../../lib/reports/vatReport';

/**
 * v10.1.11 (D-03): زبانه «مالیات بر ارزش افزوده» صفحه «گزارش‌های مدیریتی» (`GET /reports/vat`). جمع‌ها، هم‌خوانی و
 * صفحه‌بندی در کارساز است؛ با تغییر پالایه صفحه قبلی تا رسیدن پاسخ تازه می‌ماند و پس از نیم دقیقه کهنه شمرده می‌شود.
 */

const VAT_REPORT_STALE_MS = 30_000;

export function vatReportUrl(params: Partial<VatReportParams> & { export?: boolean }): string {
  const query = vatReportSearch(params);
  return query ? `/reports/vat?${query}` : '/reports/vat';
}

export function useVatReport(params: VatReportParams) {
  return useQuery<VatReport>({
    queryKey: QUERY_KEYS.reports.vat(params),
    queryFn: ({ signal }) => fetchJson<VatReport>(vatReportUrl(params), { signal }),
    placeholderData: keepPreviousData,
    staleTime: VAT_REPORT_STALE_MS,
    retry: false,
  });
}

/** همه سندها و همه تفاوت‌ها (تا سقف خروجی) برای اکسل */
export function fetchVatReportExport(params: VatReportParams): Promise<VatReport> {
  return fetchJson<VatReport>(vatReportUrl({ from: params.from, to: params.to, list: params.list, export: true }));
}

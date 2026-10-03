import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { FiscalYearClosingPreview, FiscalYearClosingResult } from '../../types';
import { silentMutationError } from './accountingQueryConfig';
import { invalidateAfterVoucherChange } from './accountingInvalidation';
import { useOnDemandReport, type OnDemandReportSpec } from './useOnDemandReport';

/**
 * تب «بستن سال مالی»: پیش‌نمایش (سال، تاریخ اختتامیه و افتتاحیه بخشی از کلید) و اجرای بستن با useMutation.
 * بستن سال اسناد اختتامیه/افتتاحیه صادر می‌کند، پس کلیدهای تغییر سند (فهرست اسناد، مانده‌ها، گزارش‌ها، ...)
 * باطل می‌شوند؛ پیش‌نمایش نمایش‌داده‌شده مثل قبل دست نمی‌خورد (کلید آن زیر fiscal-closing است، نه reports).
 */

export interface FiscalClosingPreviewParams {
  year: string;
  closingDate: string;
  openingDateNewYear: string;
}

export interface FiscalClosingExecuteVariables extends FiscalClosingPreviewParams {
  createOpeningVoucher: boolean;
}

const FISCAL_CLOSING_PREVIEW: OnDemandReportSpec<FiscalClosingPreviewParams, FiscalYearClosingPreview> = {
  key: (p) => QUERY_KEYS.accounting.fiscalClosingPreview(p),
  idleKey: QUERY_KEYS.accounting.fiscalClosingPreview({ idle: true }),
  url: ({ year, closingDate, openingDateNewYear }) =>
    `/accounting/fiscal-closing/preview?year=${year}&closingDate=${closingDate}&openingDateNewYear=${openingDateNewYear}`,
  parse: (res) => res as FiscalYearClosingPreview,
  errorText: 'خطا در محاسبه پیش‌نمایش بستن سال مالی',
};

export function useFiscalClosingPreview() {
  return useOnDemandReport(FISCAL_CLOSING_PREVIEW);
}

export function useExecuteFiscalClosing() {
  const queryClient = useQueryClient();

  return useMutation<FiscalYearClosingResult, unknown, FiscalClosingExecuteVariables>({
    mutationFn: (variables) => fetchJson<FiscalYearClosingResult>('/accounting/fiscal-closing/execute', {
      method: 'POST',
      body: JSON.stringify({
        year: variables.year,
        closingDate: variables.closingDate,
        openingDateNewYear: variables.openingDateNewYear,
        createOpeningVoucher: variables.createOpeningVoucher,
      }),
    }),
    onSuccess: () => { void invalidateAfterVoucherChange(queryClient); },
    // خطا مثل قبل در خود تب با پیام فارسی اعلام می‌شود
    onError: silentMutationError,
  });
}

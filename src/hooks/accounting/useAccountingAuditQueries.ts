import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { FinancialHealthReport } from '../../types';
import type { AutomationRow, AutomationSummary } from '../../lib/accounting/automationStatus';
import { ACCOUNTING_REPORT_QUERY_OPTIONS, silentMutationError } from './accountingQueryConfig';
import { invalidateAfterVoucherChange } from './accountingInvalidation';

/**
 * زیرتب‌های «بازرس سلامت مالی» و «وضعیت اتوماسیون اسناد» با React Query: هر بار باز شدن زیرتب از سرور خوانده
 * می‌شود و با بسته شدن آن لغو می‌شود. صدور خودکار اسناد جاافتاده (quick-fix) با useMutation کلیدهای تغییر سند را
 * باطل می‌کند — از جمله همین گزارش سلامت (زیر accounting/reports) که مثل قبل دوباره خوانده می‌شود.
 */

const REPORT_OPTIONS = { ...ACCOUNTING_REPORT_QUERY_OPTIONS, refetchOnMount: 'always' } as const;

export function useFinancialHealthQuery() {
  return useQuery<FinancialHealthReport>({
    queryKey: QUERY_KEYS.accounting.report('health-check'),
    queryFn: ({ signal }) => fetchJson<FinancialHealthReport>('/api/accounting/reports/health-check', { signal }),
    ...REPORT_OPTIONS,
  });
}

export interface VoucherSyncResult {
  success: boolean;
  message: string;
  syncedCount: number;
}

export function useSyncMissingVouchers() {
  const queryClient = useQueryClient();
  return useMutation<VoucherSyncResult, unknown, void>({
    mutationFn: () => fetchJson<VoucherSyncResult>('/api/accounting/quick-fix/sync-all-vouchers', { method: 'POST' }),
    // صدور اسناد دوبل فاکتورها: فهرست اسناد، مانده‌ها، گزارش‌ها (و گزارش سلامت)، اسناد انبار/فروش
    onSuccess: () => invalidateAfterVoucherChange(queryClient),
    // پیام خطا مثل قبل در کادر پیام همین زیرتب نمایش داده می‌شود
    onError: silentMutationError,
  });
}

export type { AutomationRow, AutomationSummary } from '../../lib/accounting/automationStatus';

export interface AutomationStatusData {
  report: AutomationRow[];
  summary: AutomationSummary | null;
}

export function useAutomationStatusQuery() {
  return useQuery<AutomationStatusData>({
    queryKey: QUERY_KEYS.accounting.report('automation-status'),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<{ report?: unknown; summary?: AutomationSummary } | null>('/accounting/automation-status', { signal });
      return {
        report: Array.isArray(res?.report) ? (res.report as AutomationRow[]) : [],
        summary: res?.summary || null,
      };
    },
    ...REPORT_OPTIONS,
  });
}

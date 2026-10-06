import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { safeExtractArray } from '../../utils';
import type { Cheque } from '../../types';
import { ACCOUNTING_LIST_QUERY_OPTIONS, fetchAccountingList, silentMutationError } from './accountingQueryConfig';
import { invalidateAfterChequeChange } from './accountingInvalidation';
import { useOnDemandReport, type OnDemandReportSpec } from './useOnDemandReport';

/**
 * چک‌های صیادی: فهرست چک‌ها با useQuery؛ ثبت، تغییر وضعیت و حذف با useMutation (همان آدرس‌ها و بدنه‌های صفحه
 * پیشین). تغییر وضعیت (وصول/خرج/برگشت) تراکنش خزانه و سند می‌سازد، پس کلیدهای خزانه و اسناد هم باطل می‌شوند.
 */

export interface ChequeFilters {
  type?: string;
  status?: string;
}

/** بدنه فرم ثبت چک (همان داده ChequesTab) */
export type ChequePayload = object;

export interface ChequeStatusVariables {
  id: number;
  status: string;
  description?: string;
  bankAccountId?: number;
  /** v9.0.85 (TD-498): خرج چک فقط با شناسه تأمین‌کننده */
  transfereePartyId?: number;
  /** v9.0.98 (TD-506): تاریخ اقدام (ISO)؛ خالی ← امروز کسب‌وکار در سرور */
  actionDate?: string;
}

function chequesUrl(filters: ChequeFilters): string {
  const params = new URLSearchParams();
  if (filters.type) params.append('type', filters.type);
  if (filters.status) params.append('status', filters.status);
  const query = params.toString();
  return query ? `/accounting/cheques?${query}` : '/accounting/cheques';
}

export function useChequesQuery(filters: ChequeFilters = {}) {
  return useQuery<Cheque[]>({
    queryKey: QUERY_KEYS.accounting.cheques(filters),
    queryFn: ({ signal }) => fetchAccountingList<Cheque>(chequesUrl(filters), signal, 'cheques'),
    ...ACCOUNTING_LIST_QUERY_OPTIONS,
  });
}

export function useChequeMutations() {
  const queryClient = useQueryClient();
  const common = {
    onSuccess: () => { void invalidateAfterChequeChange(queryClient); },
    onError: silentMutationError,
  };

  const createCheque = useMutation<unknown, unknown, ChequePayload>({
    mutationFn: (data) => fetchJson('/accounting/cheques', { method: 'POST', body: JSON.stringify(data) }),
    ...common,
  });

  const updateChequeStatus = useMutation<unknown, unknown, ChequeStatusVariables>({
    mutationFn: ({ id, status, description, bankAccountId, transfereePartyId, actionDate }) => fetchJson(`/accounting/cheques/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, description, notes: description, bankAccountId, transfereePartyId, actionDate }),
    }),
    ...common,
  });

  const deleteCheque = useMutation<unknown, unknown, number>({
    mutationFn: (id) => fetchJson(`/accounting/cheques/${id}`, { method: 'DELETE' }),
    ...common,
  });

  return { createCheque, updateChequeStatus, deleteCheque };
}

export interface ChequeReconciliationRow {
  code: string;
  title: string;
  ledgerBalance: number;
  expectedBalance: number;
  discrepancy: number;
  counts: { cheques: number };
}

// V1.6.0: آشتی‌سنجی دفتر چک صیادی با دفاتر دوبل (دکمه «آشتی‌سنجی دفتر چک»)
const CHEQUE_RECONCILIATION_REPORT: OnDemandReportSpec<Record<string, never>, ChequeReconciliationRow[]> = {
  key: () => QUERY_KEYS.accounting.report('cheque-reconciliation'),
  idleKey: QUERY_KEYS.accounting.report('cheque-reconciliation', { idle: true }),
  url: () => '/accounting/reports/cheque-reconciliation',
  parse: (res) => safeExtractArray<ChequeReconciliationRow>(res),
  errorText: 'خطا در آشتی‌سنجی دفتر چک',
};

export function useChequeReconciliationReport() {
  return useOnDemandReport(CHEQUE_RECONCILIATION_REPORT);
}

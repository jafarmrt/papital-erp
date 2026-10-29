import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { safeExtractArray } from '../../utils';
import type { PettyCashExpenseLine, TreasuryTransaction } from '../../types';
import type { ColleagueExpense, ColleagueExpenseList } from '../../lib/treasury/colleagueExpense';
import { ACCOUNTING_LIST_QUERY_OPTIONS, fetchAccountingList, silentMutationError } from './accountingQueryConfig';
import { invalidateAfterTreasuryChange } from './accountingInvalidation';
import type { ContraAccountOption } from './useTreasuryQueries';

/**
 * v10.1.32 (D-16، ت۳۰ «متغیر»): صورت‌هزینه تنخواه‌گردان — حساب‌های هزینه‌ای که سرور می‌پذیرد، ثبت صورت‌هزینه و ردیف‌های
 * یک صورت‌هزینه ثبت‌شده. شارژ و برگشت وجه همان انتقال وجه خزانه است.
 */

export interface PettyCashExpensePayload {
  date?: string;
  description?: string;
  lines: Array<{ accountId: number; amount: string; description?: string; sellerName?: string; invoiceNumber?: string }>;
  attachments?: unknown[];
}

export function usePettyCashExpenseAccountsQuery(enabled: boolean) {
  return useQuery<ContraAccountOption[]>({
    queryKey: QUERY_KEYS.accounting.pettyCashExpenseAccounts(),
    queryFn: ({ signal }) => fetchAccountingList<ContraAccountOption>('/accounting/treasury/petty-cash/expense-accounts', signal, 'petty cash expense accounts'),
    ...ACCOUNTING_LIST_QUERY_OPTIONS,
    enabled,
  });
}

/** ردیف‌های صورت‌هزینه؛ فقط وقتی پنجره آن باز است خوانده می‌شود */
export function usePettyCashLinesQuery(id: number | null) {
  return useQuery<PettyCashExpenseLine[]>({
    queryKey: QUERY_KEYS.accounting.pettyCashLines(id ?? 0),
    queryFn: ({ signal }) => fetchJson(`/accounting/treasury/${id}/petty-cash-lines`, { signal }).then(r => safeExtractArray<PettyCashExpenseLine>(r)),
    enabled: id !== null,
  });
}

export function usePettyCashExpenseMutation() {
  const queryClient = useQueryClient();
  return useMutation<TreasuryTransaction, unknown, { fundId: number; payload: PettyCashExpensePayload }>({
    mutationFn: ({ fundId, payload }) => fetchJson<TreasuryTransaction>(`/accounting/treasury/petty-cash/${fundId}/expenses`, {
      method: 'POST', body: JSON.stringify(payload),
    }),
    onSuccess: () => { void invalidateAfterTreasuryChange(queryClient); },
    onError: silentMutationError,
  });
}

/** v11 (tool 4): an expense a colleague paid from their own pocket; the lines are a petty cash statement's */
export interface ColleagueExpensePayload extends PettyCashExpensePayload {
  personnelId: number;
}

export function useColleagueExpensesQuery(enabled: boolean) {
  return useQuery<ColleagueExpenseList>({
    queryKey: QUERY_KEYS.accounting.colleagueExpenses(),
    queryFn: ({ signal }) => fetchJson<{ data: ColleagueExpenseList }>('/accounting/treasury/colleague-expenses', { signal }).then(r => r.data),
    enabled,
  });
}

export function useColleagueExpenseMutation() {
  const queryClient = useQueryClient();
  return useMutation<ColleagueExpense, unknown, ColleagueExpensePayload>({
    mutationFn: payload => fetchJson<ColleagueExpense>('/accounting/treasury/colleague-expenses', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => { void invalidateAfterTreasuryChange(queryClient); void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.accounting.colleagueExpenses() }); },
    onError: silentMutationError,
  });
}

export function useVoidColleagueExpenseMutation() {
  const queryClient = useQueryClient();
  return useMutation<unknown, unknown, { id: number; reason: string }>({
    mutationFn: ({ id, reason }) => fetchJson(`/accounting/treasury/colleague-expenses/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: () => { void invalidateAfterTreasuryChange(queryClient); void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.accounting.colleagueExpenses() }); },
    onError: silentMutationError,
  });
}

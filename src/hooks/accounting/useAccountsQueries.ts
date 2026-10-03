import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { Account, FinancialSummaryStats } from '../../types';
import { ACCOUNTING_LIST_QUERY_OPTIONS, fetchAccountingList, silentMutationError } from './accountingQueryConfig';
import { invalidateAfterAccountChange } from './accountingInvalidation';

/**
 * کدینگ حساب‌ها و خلاصه داشبورد مالی: خواندن با useQuery و ایجاد/ویرایش/حذف/کدینگ استاندارد با useMutation
 * (همان آدرس‌ها و بدنه‌های صفحه پیشین).
 */

/** بدنه فرم حساب (همان داده فرم ChartOfAccountsTab) */
export type AccountPayload = object;

export function useAccountingSummaryQuery() {
  return useQuery<FinancialSummaryStats | null>({
    queryKey: QUERY_KEYS.accounting.summary(),
    queryFn: async ({ signal }) => {
      try {
        const res = await fetchJson<{ stats?: FinancialSummaryStats } | null>('/accounting/summary', { signal });
        return res?.stats ?? null;
      } catch (err: unknown) {
        if (!signal.aborted) console.error('Error loading accounting stats:', err);
        throw err;
      }
    },
    ...ACCOUNTING_LIST_QUERY_OPTIONS,
  });
}

export function useAccountsListQuery() {
  return useQuery<Account[]>({
    queryKey: QUERY_KEYS.accounting.accountsList(),
    queryFn: ({ signal }) => fetchAccountingList<Account>('/accounting/accounts', signal, 'accounts'),
    ...ACCOUNTING_LIST_QUERY_OPTIONS,
  });
}

export function useAccountsTreeQuery() {
  return useQuery<Account[]>({
    queryKey: QUERY_KEYS.accounting.accountsTree(),
    queryFn: ({ signal }) => fetchAccountingList<Account>('/accounting/accounts/tree', signal, 'accounts tree'),
    ...ACCOUNTING_LIST_QUERY_OPTIONS,
  });
}

export function useAccountMutations() {
  const queryClient = useQueryClient();
  const onSuccess = () => { void invalidateAfterAccountChange(queryClient); };

  const createAccount = useMutation<unknown, unknown, AccountPayload>({
    mutationFn: (data) => fetchJson('/accounting/accounts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess,
    onError: silentMutationError,
  });

  const updateAccount = useMutation<unknown, unknown, { id: number; data: AccountPayload }>({
    mutationFn: ({ id, data }) => fetchJson(`/accounting/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
    onSuccess,
    onError: silentMutationError,
  });

  const deleteAccount = useMutation<unknown, unknown, number>({
    mutationFn: (id) => fetchJson(`/accounting/accounts/${id}`, {
      method: 'DELETE',
    }),
    onSuccess,
    onError: silentMutationError,
  });

  const seedStandardAccounts = useMutation<{ message?: string } | null, unknown, void>({
    mutationFn: () => fetchJson<{ message?: string } | null>('/accounting/accounts/seed-standard', {
      method: 'POST',
    }),
    onSuccess,
    onError: silentMutationError,
  });

  return { createAccount, updateAccount, deleteAccount, seedStandardAccounts };
}

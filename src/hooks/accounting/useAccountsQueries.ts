import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { Account, FinancialSummaryStats } from '../../types';
import { ACCOUNTING_LIST_QUERY_OPTIONS, fetchAccountingList, silentMutationError, type AccountingListQueryOptions } from './accountingQueryConfig';
import { invalidateAfterAccountChange } from './accountingInvalidation';
import { READ_ON_EVERY_OPENING } from '../queries/readOnEveryOpening';

/**
 * کدینگ حساب‌ها و خلاصه داشبورد مالی: خواندن با useQuery و ایجاد/ویرایش/حذف/کدینگ استاندارد با useMutation
 * (همان آدرس‌ها و بدنه‌های صفحه پیشین).
 */

/** بدنه فرم حساب (همان داده فرم ChartOfAccountsTab) */
export type AccountPayload = object;

export function useAccountingSummaryQuery({ enabled = true }: AccountingListQueryOptions = {}) {
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
    enabled,
  });
}

export function useAccountsListQuery({ enabled = true }: AccountingListQueryOptions = {}) {
  return useQuery<Account[]>({
    queryKey: QUERY_KEYS.accounting.accountsList(),
    queryFn: ({ signal }) => fetchAccountingList<Account>('/accounting/accounts', signal, 'accounts'),
    ...ACCOUNTING_LIST_QUERY_OPTIONS,
    enabled,
  });
}

export function useAccountsTreeQuery({ enabled = true }: AccountingListQueryOptions = {}) {
  return useQuery<Account[]>({
    queryKey: QUERY_KEYS.accounting.accountsTree(),
    queryFn: ({ signal }) => fetchAccountingList<Account>('/accounting/accounts/tree', signal, 'accounts tree'),
    ...ACCOUNTING_LIST_QUERY_OPTIONS,
    enabled,
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

/** `GET /accounting/mappings`: the account code of each automatic posting concept, the concepts turned off, and how many accounts exist */
export interface AccountingMappings {
  mappings: Record<string, string>;
  disabled: string[];
  accountsCount: number;
}

export const ACCOUNTING_MAPPINGS_KEY = [...QUERY_KEYS.accounting.all, 'mappings'] as const;

/**
 * 10.3 (ARCH review finding 3, part 13): the accounting settings tab's mappings, read again on each opening of the tab;
 * under `accounting`, so a seeded chart of accounts or a change of the mappings elsewhere refreshes it
 */
export function useAccountingMappingsQuery() {
  return useQuery<AccountingMappings>({
    queryKey: ACCOUNTING_MAPPINGS_KEY,
    queryFn: async ({ signal }) => {
      const res = await fetchJson<Record<string, unknown> | null>('/accounting/mappings', { signal });
      const { disabled, accountsCount, ...codes } = res ?? {};
      const mappings: Record<string, string> = {};
      for (const [concept, code] of Object.entries(codes)) if (typeof code === 'string') mappings[concept] = code;
      return {
        mappings,
        disabled: Array.isArray(disabled) ? disabled.filter((d): d is string => typeof d === 'string') : [],
        accountsCount: Number(accountsCount) || 0,
      };
    },
    ...READ_ON_EVERY_OPENING,
  });
}

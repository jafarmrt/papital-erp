import { useQuery } from '@tanstack/react-query';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { Customer, Personnel } from '../../types';
import { ACCOUNTING_LIST_QUERY_OPTIONS, fetchAccountingList } from './accountingQueryConfig';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';

/**
 * طرف‌حساب‌های قابل انتخاب در فرم‌های حسابداری (سند، خزانه، چک، مرور حساب‌ها): فهرست انتخاب GET /customers/options (TD-887) و
 * GET /personnel?limit=1000 صفحه پیشین؛ کلیدها زیر customers و personnel‌اند تا ذخیره مشتری/پرسنل تازه‌شان کند.
 */

const CUSTOMERS_KEY = QUERY_KEYS.customers.options({ scope: 'accounting-parties' });
const PERSONNEL_KEY = QUERY_KEYS.personnel.lookup({ scope: 'accounting-parties', limit: 1000 });

export function useAccountingCustomersQuery() {
  return useQuery<Customer[]>({
    queryKey: CUSTOMERS_KEY,
    queryFn: ({ signal }) => fetchAccountingList<Customer>(PICK_LIST_URLS.customers, signal, 'customers'),
    ...ACCOUNTING_LIST_QUERY_OPTIONS,
  });
}

export function useAccountingPersonnelQuery() {
  return useQuery<Personnel[]>({
    queryKey: PERSONNEL_KEY,
    queryFn: ({ signal }) => fetchAccountingList<Personnel>('/personnel?limit=1000', signal, 'personnel'),
    ...ACCOUNTING_LIST_QUERY_OPTIONS,
  });
}

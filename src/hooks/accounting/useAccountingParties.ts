import { useQuery } from '@tanstack/react-query';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { Customer, Personnel } from '../../types';
import { ACCOUNTING_LIST_QUERY_OPTIONS, fetchAccountingList } from './accountingQueryConfig';

/**
 * طرف‌حساب‌های قابل انتخاب در فرم‌های حسابداری (سند، خزانه، چک، مرور حساب‌ها): همان GET /customers?limit=1000 و
 * GET /personnel?limit=1000 صفحه پیشین؛ کلیدها زیر customers و personnel‌اند تا ذخیره مشتری/پرسنل تازه‌شان کند.
 */

const CUSTOMERS_KEY = QUERY_KEYS.customers.list({ scope: 'accounting-parties', limit: 1000 });
const PERSONNEL_KEY = QUERY_KEYS.personnel.lookup({ scope: 'accounting-parties', limit: 1000 });

export function useAccountingCustomersQuery() {
  return useQuery<Customer[]>({
    queryKey: CUSTOMERS_KEY,
    queryFn: ({ signal }) => fetchAccountingList<Customer>('/customers?limit=1000', signal, 'customers'),
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

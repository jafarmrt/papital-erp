import { useQuery } from '@tanstack/react-query';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { Customer, Personnel } from '../../types';
import { ACCOUNTING_LIST_QUERY_OPTIONS, fetchAccountingList } from './accountingQueryConfig';
import toast from 'react-hot-toast';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';
import { PERSONNEL_PICK_CAP_TOAST_ID, PERSONNEL_PICK_LIMIT, PERSONNEL_PICK_URL, takePersonnelPick } from '../../lib/personnel/personnelList';

/**
 * طرف‌حساب‌های قابل انتخاب در فرم‌های حسابداری (سند، خزانه، چک، مرور حساب‌ها): فهرست انتخاب GET /customers/options (TD-887) و
 * GET /personnel?limit=5001 (PERSONNEL_PICK_URL، سقف ۵٬۰۰۰ و یک ردیف برای دانستن بیشتر بودن) صفحه پیشین؛ کلیدها زیر customers و personnel‌اند تا ذخیره مشتری/پرسنل تازه‌شان کند.
 */

const CUSTOMERS_KEY = QUERY_KEYS.customers.options({ scope: 'accounting-parties' });
const PERSONNEL_KEY = QUERY_KEYS.personnel.lookup({ scope: 'accounting-parties', limit: PERSONNEL_PICK_LIMIT });

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
    queryFn: async ({ signal }) => {
      // OBS-R1-69 (TD-1321): a list cut at the cap says so once instead of hiding the rest
      const { rows, notice } = takePersonnelPick(await fetchAccountingList<Personnel>(PERSONNEL_PICK_URL, signal, 'personnel'));
      if (notice) toast(notice, { id: PERSONNEL_PICK_CAP_TOAST_ID });
      return rows;
    },
    ...ACCOUNTING_LIST_QUERY_OPTIONS,
  });
}

import { useMutation } from '@tanstack/react-query';
import * as xlsx from 'xlsx';
import { fetchJson } from '../../api';
import { formatPersianDate } from '../../utils';
import type { Transaction } from '../../types';

/**
 * صفحه کاردکس: خروجی اکسل همه تراکنش‌های فیلترشده (GET /transactions?export=true) با useMutation تا دکمه
 * در طول دریافت غیرفعال بماند و کلیک دوباره درخواست دوم نفرستد. خواندنی است و کشی را باطل نمی‌کند.
 */

export interface TransactionsExportFilters {
  /** متن جستجوی خام (نه debounce‌شده) — مثل قبل */
  search: string;
  type: string;
  startDate: string;
  endDate: string;
}

function exportQuery(filters: TransactionsExportFilters): string {
  const query = new URLSearchParams({ export: 'true' });
  if (filters.search && filters.search.trim() !== '') query.append('search', filters.search.trim());
  if (filters.type && filters.type !== 'all') query.append('type', filters.type);
  if (filters.startDate) query.append('startDate', filters.startDate);
  if (filters.endDate) query.append('endDate', filters.endDate);
  return query.toString();
}

async function exportTransactions(filters: TransactionsExportFilters): Promise<void> {
  const res = await fetchJson<{ data?: unknown } | Transaction[] | null>(`/transactions?${exportQuery(filters)}`);
  const fullData: Transaction[] = res && !Array.isArray(res) && Array.isArray(res.data)
    ? res.data
    : (Array.isArray(res) ? res : []);

  const ws = xlsx.utils.json_to_sheet(fullData.map(t => ({
    'تاریخ': formatPersianDate(t.date),
    'کاربر': t.user || '-',
    'نوع تراکنش': t.type === 'in' ? 'ورود به انبار' : 'خروج از انبار',
    'نام کالا': t.item_name,
    'کد کالا': t.item_code,
    'نوع کالا': t.item_type === 'product' ? 'محصول' : 'ماده اولیه',
    'مقدار': t.quantity,
    'واحد': t.item_unit,
    'کد پیگیری/سند': t.document_ref,
    'نوع سند': t.document_type
  })));
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'تراکنش‌ها');
  xlsx.writeFile(wb, `Transactions.xlsx`);
}

export function useTransactionsExport() {
  return useMutation<void, unknown, TransactionsExportFilters>({
    mutationFn: exportTransactions,
    // مثل قبل خطا فقط در کنسول ثبت می‌شود (نه toast پیش‌فرض کلاینت)
    onError: (err) => { console.error(err); },
  });
}

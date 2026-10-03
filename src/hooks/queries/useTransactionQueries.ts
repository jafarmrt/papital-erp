import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { normalizeRunningKardex, type RunningKardexData } from '../../lib/transactions/runningKardex';
import type { Transaction } from '../../types';

/**
 * کاردکس انبار با React Query (FE-005): فهرست تراکنش‌های صفحه «کاردکس» و کاردکس تفصیلی یک کالا (مودال مشترک
 * صفحه کاردکس و انبارگردانی). هر درخواست سیگنال React Query را می‌گیرد تا با بسته شدن صفحه/مودال یا رفتن به
 * فیلتر/صفحه دیگر لغو شود؛ فیلترها و صفحه بخشی از کلید کش‌اند، پس پاسخ دیررس یک فیلتر قدیمی هرگز جای نتیجه
 * فیلتر تازه را نمی‌گیرد.
 */

const FIVE_MINUTES = 5 * 60 * 1000;

export interface TransactionFilters {
  page?: number;
  limit?: number;
  search?: string;
  type?: string;
  documentType?: string;
  itemId?: number;
  startDate?: string;
  endDate?: string;
  includeDeleted?: boolean;
}

export interface TransactionsPageData {
  transactions: Transaction[];
  total: number;
  totalPages: number;
  page: number;
}

interface TransactionsResponse {
  data?: unknown;
  total?: number;
  totalPages?: number;
  page?: number;
}

/** همان پارامترهای GET /transactions صفحه کاردکس (export در این فهرست نیست) */
export function transactionsSearchParams(filters: TransactionFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(filters.page ?? 1));
  params.set('limit', String(filters.limit ?? 50));
  if (filters.search?.trim()) params.set('search', filters.search.trim());
  if (filters.type && (filters.type === 'in' || filters.type === 'out')) params.set('type', filters.type);
  if (filters.documentType && filters.documentType !== 'all') params.set('documentType', filters.documentType);
  if (filters.itemId && !isNaN(Number(filters.itemId))) params.set('itemId', String(filters.itemId));
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  if (filters.includeDeleted) params.set('includeDeleted', 'true');
  return params;
}

export function useTransactionsQuery(filters: TransactionFilters) {
  return useQuery<TransactionsPageData>({
    queryKey: QUERY_KEYS.transactions.list(filters),
    queryFn: async ({ signal }) => {
      try {
        const res = await fetchJson<TransactionsResponse | Transaction[] | null>(
          `/transactions?${transactionsSearchParams(filters).toString()}`,
          { signal },
        );
        const envelope: TransactionsResponse = res && !Array.isArray(res) ? res : {};
        const rawData: Transaction[] = Array.isArray(envelope.data)
          ? envelope.data
          : (Array.isArray(res) ? res : []);
        return {
          transactions: rawData,
          total: envelope.total || 0,
          totalPages: envelope.totalPages || 1,
          page: envelope.page || filters.page || 1,
        };
      } catch (err: unknown) {
        if (!signal.aborted) console.error('Error loading transactions:', err);
        throw err;
      }
    },
    staleTime: FIVE_MINUTES,
    gcTime: 30 * 60 * 1000,
    // بیشتر فرم‌های تغییر موجودی کش کاردکس را باطل نمی‌کنند: باز شدن صفحه همیشه فهرست را تازه می‌خواند
    // (داده کش‌شده تا رسیدن پاسخ نمایش داده می‌شود)
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    // مثل قبل: تا رسیدن نتیجه فیلتر/صفحه تازه، ردیف‌های قبلی زیر نشانگر بارگذاری می‌مانند
    placeholderData: keepPreviousData,
  });
}

/**
 * کاردکس تفصیلی یک کالا (GET /inventory/item-kardex/:itemId). مثل قبل هر بار باز شدن مودال از سرور خوانده می‌شود
 * و خطا بی‌درنگ (بدون تلاش مجدد) با پیام فارسی در مودال نمایش داده می‌شود.
 */
export function useItemKardexQuery(itemId: number, enabled: boolean) {
  return useQuery<RunningKardexData>({
    queryKey: QUERY_KEYS.transactions.itemKardex(itemId),
    enabled: enabled && Boolean(itemId),
    queryFn: async ({ signal }) => normalizeRunningKardex(
      await fetchJson<unknown>(`/inventory/item-kardex/${itemId}`, { signal }),
    ),
    staleTime: FIVE_MINUTES,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: false,
  });
}

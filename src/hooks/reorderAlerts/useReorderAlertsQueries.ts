import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { listFromResponse } from '../../lib/invoices/invoiceForm';
import { reorderItemsFromResponse, type ReorderItem } from '../../lib/reorderAlerts/reorderItems';
import type { Customer } from '../../types';

/**
 * صفحه نقطه سفارش: خواندنی‌های صفحه با React Query (FE-005) به‌جای fetchJson/useState دستی.
 * همان آدرس‌ها و همان نرمال‌سازی پاسخ‌ها؛ هر درخواست سیگنال React Query را می‌گیرد تا با بسته شدن صفحه
 * (یا مودال) لغو شود. مثل قبل، هر بار باز شدن صفحه فهرست هشدارها دوباره از سرور خوانده می‌شود.
 */

const FIVE_MINUTES = 5 * 60 * 1000;
const REORDER_ALERTS_KEY = QUERY_KEYS.items.reorderAlerts();
// فهرست طرف‌حساب‌های مودال سفارش خرید (GET /customers?limit=1000)؛ کلید جدا از فهرست‌های صفحه‌بندی‌شده مشتریان
const SUPPLIERS_KEY = QUERY_KEYS.customers.list({ scope: 'reorder-suppliers', limit: 1000 });
// آرایه‌های خالی ثابت تا محاسبات وابسته به لیست‌ها با هر رندر دوباره اجرا نشوند
const NO_ITEMS: ReorderItem[] = [];
const NO_SUPPLIERS: Customer[] = [];

export function useReorderAlertsQuery() {
  const query = useQuery<ReorderItem[]>({
    queryKey: REORDER_ALERTS_KEY,
    queryFn: async ({ signal }) => {
      try {
        return reorderItemsFromResponse(await fetchJson<unknown>('/items/reorder-alerts', { signal }));
      } catch (err: unknown) {
        if (!signal.aborted) console.error('Error loading reorder alerts:', err);
        throw err;
      }
    },
    staleTime: FIVE_MINUTES,
    // مثل قبل: باز شدن صفحه همیشه فهرست را تازه می‌خواند (داده کش‌شده تا رسیدن پاسخ نگه داشته می‌شود)
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    // مثل قبل: خطا بی‌درنگ در کادر خطا نمایش داده می‌شود و «تلاش مجدد» دستی است
    retry: false,
  });

  const { refetch } = query;
  const reload = useCallback(() => { void refetch(); }, [refetch]);

  return {
    items: query.data ?? NO_ITEMS,
    loading: query.isFetching,
    error: query.isError,
    reload,
  };
}

/** طرف‌حساب‌های قابل انتخاب در مودال سفارش خرید؛ فقط وقتی مودال باز است خوانده می‌شود */
export function useReorderSuppliersQuery(enabled: boolean): Customer[] {
  const query = useQuery<Customer[]>({
    queryKey: SUPPLIERS_KEY,
    enabled,
    queryFn: async ({ signal }) => {
      try {
        return listFromResponse<Customer>(await fetchJson<unknown>('/customers?limit=1000', { signal }));
      } catch (err: unknown) {
        if (!signal.aborted) console.error('Error fetching suppliers:', err);
        throw err;
      }
    },
    staleTime: FIVE_MINUTES,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return query.data ?? NO_SUPPLIERS;
}

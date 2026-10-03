import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { fetchJson } from '../../api';
import type { Customer, ItemPrice } from '../../types';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { useWarehousesQuery, type WarehouseItem } from '../queries/useSettingsQueries';
import { listFromResponse, type InvoiceDocumentDetails } from '../../lib/invoices/invoiceForm';
import type { InvoiceListDocument } from '../../lib/invoices/invoiceListDocuments';

/**
 * صفحه صدور فاکتور: خواندنی‌های صفحه با React Query (FE-005) به‌جای fetchJson/useState دستی.
 * همان آدرس‌ها و همان نرمال‌سازی پاسخ‌ها؛ هر درخواست سیگنال React Query را می‌گیرد تا با بسته شدن صفحه لغو شود.
 */

const FIVE_MINUTES = 5 * 60 * 1000;
// آرایه‌های خالی ثابت تا effectهای وابسته به لیست‌ها در زمان بارگذاری با هر رندر دوباره اجرا نشوند
const NO_WAREHOUSES: WarehouseItem[] = [];
const NO_CUSTOMERS: Customer[] = [];
const NO_PROFORMAS: InvoiceListDocument[] = [];

/** پیش‌فاکتورهای باز صفحه صدور فاکتور (GET /documents?status=proforma&limit=1000) */
export function useOpenProformasQuery() {
  return useQuery<InvoiceListDocument[]>({
    queryKey: QUERY_KEYS.documents.openProformas(),
    queryFn: async ({ signal }) => listFromResponse<InvoiceListDocument>(
      await fetchJson<unknown>('/documents?status=proforma&limit=1000', { signal }),
    ),
    staleTime: FIVE_MINUTES,
  });
}

/** قیمت‌های تعریف‌شده یک کالا؛ خطا مثل قبل یک بار با پیام فارسی اعلام می‌شود */
export function useItemPricesQuery(itemId: string) {
  return useQuery<ItemPrice[]>({
    queryKey: QUERY_KEYS.prices.byItem(itemId ? Number(itemId) : null),
    enabled: Boolean(itemId),
    queryFn: async ({ signal }) => {
      try {
        const res = await fetchJson<unknown>(`/items/${itemId}/prices`, { signal });
        return Array.isArray(res) ? (res as ItemPrice[]) : [];
      } catch (err: unknown) {
        if (!signal.aborted) {
          console.error(`Failed to load prices for item ${itemId}:`, err);
          toast.error('خطا در دریافت قیمت‌های کالا');
        }
        throw err;
      }
    },
    staleTime: FIVE_MINUTES,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useInvoiceReferenceData(docType: string) {
  const queryClient = useQueryClient();

  const warehousesQuery = useWarehousesQuery();
  const customersQuery = useQuery<Customer[]>({
    queryKey: QUERY_KEYS.customers.list({ scope: 'invoice-buyers' }),
    queryFn: async ({ signal }) => listFromResponse<Customer>(await fetchJson<unknown>('/customers?limit=1000', { signal })),
    staleTime: FIVE_MINUTES,
  });
  const proformasQuery = useOpenProformasQuery();
  // شماره بعدی سند همیشه تازه خوانده می‌شود (staleTime صفر): شماره کش‌شده ممکن است در این فاصله مصرف شده باشد
  const nextRefQuery = useQuery<string>({
    queryKey: QUERY_KEYS.documents.nextRef(docType),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<{ nextRef?: string } | null>(`/documents/next-ref?type=${docType}`, { signal });
      return res?.nextRef ?? '';
    },
    staleTime: 0,
  });

  // بارگذاری سند برای ویرایش و چاپ؛ درخواست‌های در جریان با بسته شدن صفحه لغو می‌شوند
  const inFlightDocIds = useRef(new Set<number>());
  useEffect(() => {
    const ids = inFlightDocIds.current;
    return () => {
      ids.forEach(id => { void queryClient.cancelQueries({ queryKey: QUERY_KEYS.documents.detail(id) }); });
      ids.clear();
    };
  }, [queryClient]);

  const loadDocument = useCallback(async (id: number): Promise<InvoiceDocumentDetails | null> => {
    inFlightDocIds.current.add(id);
    try {
      return await queryClient.fetchQuery({
        queryKey: QUERY_KEYS.documents.detail(id),
        queryFn: async ({ signal }) => (await fetchJson<InvoiceDocumentDetails | null>(`/documents/${id}`, { signal })) ?? null,
        staleTime: 0,
      });
    } finally {
      inFlightDocIds.current.delete(id);
    }
  }, [queryClient]);

  const refreshProformas = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.documents.openProformas() });
  }, [queryClient]);

  const { refetch: refetchNextRefQuery } = nextRefQuery;
  const refetchNextRef = useCallback(() => { void refetchNextRefQuery(); }, [refetchNextRefQuery]);

  return {
    warehouses: warehousesQuery.data ?? NO_WAREHOUSES,
    customersList: customersQuery.data ?? NO_CUSTOMERS,
    proformas: proformasQuery.data ?? NO_PROFORMAS,
    nextRef: nextRefQuery.data ?? '',
    loadDocument,
    refreshProformas,
    refetchNextRef,
  };
}

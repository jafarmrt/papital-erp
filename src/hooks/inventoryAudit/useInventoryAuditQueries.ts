import { useCallback, useEffect, useMemo, useRef } from 'react';
import { keepPreviousData, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { listFromResponse } from '../../lib/invoices/invoiceForm';
import { normalizeAuditItems, type AuditItemRow, type IntegrityReport } from '../../lib/inventoryAudit/auditSheet';

/**
 * صفحه انبارگردانی: خواندنی‌های صفحه با React Query (FE-005) به‌جای fetchJson/useState دستی.
 * همان آدرس‌ها و همان نرمال‌سازی پاسخ‌ها؛ هر درخواست سیگنال React Query را می‌گیرد تا با بسته شدن صفحه لغو شود.
 * مثل قبل، باز شدن صفحه، رفتن به هر زبانه و تغییر انبار شمارش داده همان زبانه را دوباره از سرور می‌خواند
 * (داده کش‌شده تا رسیدن پاسخ نمایش داده می‌شود).
 */

export type InventoryAuditTab = 'new_audit' | 'integrity' | 'reports' | 'transfers' | 'bom_allocations';

const FIVE_MINUTES = 5 * 60 * 1000;
const DEFAULT_NEXT_REF = 'AUD-1002';
const NEXT_REF_KEY = QUERY_KEYS.documents.nextRef('audit');
const INTEGRITY_KEY = QUERY_KEYS.inventory.integrityAudit();
// فهرست کالاهای مودال بازسازی موجودی (GET /items?limit=1000)؛ کلید جدا از فهرست‌های صفحه‌بندی‌شده کالا
const REBUILD_ITEMS_KEY = QUERY_KEYS.items.list({ scope: 'inventory-rebuild', limit: 1000 });
const AUDIT_DOCS_FILTER = { type: 'audit' };
const TRANSFER_DOCS_FILTER = { type: 'transfer' };
// آرایه‌های خالی ثابت تا محاسبات وابسته به لیست‌ها با هر رندر دوباره اجرا نشوند
const NO_ROWS: AuditItemRow[] = [];
const NO_ITEMS: Array<Record<string, unknown>> = [];

function logUnlessAborted(signal: AbortSignal, label: string, err: unknown): void {
  if (!signal.aborted) console.error(label, err);
}

/**
 * سوابق انبارگردانی / حواله‌های انتقال (GET /documents?type=…): همان کلید و همان پاسخ خام useDocumentsQuery
 * ({ type }) تا کش با فهرست اسناد مشترک بماند، به‌علاوه سیگنال لغو و بارگذاری فقط با باز بودن زبانه.
 */
function useTypedDocumentsQuery(filter: { type: string }, enabled: boolean, logLabel: string) {
  return useQuery<unknown>({
    queryKey: QUERY_KEYS.documents.list(filter),
    enabled,
    queryFn: async ({ signal }) => {
      try {
        return (await fetchJson<unknown>(`/documents?type=${filter.type}`, { signal })) ?? null;
      } catch (err: unknown) {
        logUnlessAborted(signal, logLabel, err);
        throw err;
      }
    },
    staleTime: FIVE_MINUTES,
    refetchOnWindowFocus: false,
  });
}

export function useInventoryAuditQueries(activeTab: InventoryAuditTab, selectedLocation: string) {
  const queryClient = useQueryClient();

  const integrityQuery = useQuery<IntegrityReport | null>({
    queryKey: INTEGRITY_KEY,
    queryFn: async ({ signal }) => {
      try {
        const res = await fetchJson<(IntegrityReport & { report?: IntegrityReport }) | null>('/inventory/integrity-audit', { signal });
        return res?.report || res || null;
      } catch (err: unknown) {
        logUnlessAborted(signal, 'Error loading integrity report:', err);
        throw err;
      }
    },
    staleTime: FIVE_MINUTES,
    refetchOnWindowFocus: false,
  });

  const rebuildItemsQuery = useQuery<Array<Record<string, unknown>>>({
    queryKey: REBUILD_ITEMS_KEY,
    queryFn: async ({ signal }) => {
      try {
        return listFromResponse<Record<string, unknown>>(await fetchJson<unknown>('/items?limit=1000', { signal }));
      } catch (err: unknown) {
        logUnlessAborted(signal, 'Error loading items:', err);
        throw err;
      }
    },
    staleTime: FIVE_MINUTES,
    refetchOnWindowFocus: false,
  });

  // شماره بعدی سند همیشه تازه خوانده می‌شود (staleTime صفر): شماره کش‌شده ممکن است در این فاصله مصرف شده باشد
  const nextRefQuery = useQuery<string>({
    queryKey: NEXT_REF_KEY,
    queryFn: async ({ signal }) => {
      const data = await fetchJson<{ nextRef?: string } | null>('/documents/next-ref?type=audit', { signal });
      if (data?.nextRef) {
        const num = String(data.nextRef);
        return num.startsWith('AUD-') ? num : `AUD-${num}`;
      }
      // پاسخ بدون شماره: مثل قبل شماره قبلی نمایش داده می‌شود
      return queryClient.getQueryData<string>(NEXT_REF_KEY) ?? DEFAULT_NEXT_REF;
    },
    staleTime: 0,
  });

  const auditItemsQuery = useQuery<AuditItemRow[]>({
    queryKey: QUERY_KEYS.inventory.auditItems(selectedLocation),
    // selectedLocation کد انبار است (TD-480)؛ تا فهرست انبارها نرسیده، برگه درخواستی نمی‌فرستد
    enabled: activeTab === 'new_audit' && selectedLocation !== '',
    queryFn: async ({ signal }) => {
      try {
        const res = await fetchJson<unknown>(`/documents/audit-items?location=${encodeURIComponent(selectedLocation)}`, { signal });
        return normalizeAuditItems(listFromResponse<unknown>(res));
      } catch (err: unknown) {
        logUnlessAborted(signal, 'Error loading audit items:', err);
        throw err;
      }
    },
    // تا رسیدن اقلام انبار تازه، اقلام انبار قبلی مثل قبل روی برگه می‌ماند
    placeholderData: keepPreviousData,
    staleTime: FIVE_MINUTES,
    refetchOnWindowFocus: false,
  });

  const auditDocsQuery = useTypedDocumentsQuery(AUDIT_DOCS_FILTER, activeTab === 'reports', 'Error loading past audits:');
  const transfersQuery = useTypedDocumentsQuery(TRANSFER_DOCS_FILTER, activeTab === 'transfers', 'Error loading transfers:');

  // باز شدن صفحه، رفتن به یک زبانه یا تغییر انبار شمارش: داده همان زبانه دوباره خوانده می‌شود.
  // cancelRefetch: false — اگر همان کوئری همین حالا در حال دریافت است، درخواست دوم فرستاده نمی‌شود.
  const opened = useRef(false);
  useEffect(() => {
    const keys: QueryKey[] = [];
    if (!opened.current) {
      opened.current = true;
      keys.push(INTEGRITY_KEY, REBUILD_ITEMS_KEY, NEXT_REF_KEY);
    }
    if (activeTab === 'integrity') keys.push(INTEGRITY_KEY);
    if (activeTab === 'new_audit') keys.push(QUERY_KEYS.inventory.auditItems(selectedLocation), NEXT_REF_KEY);
    if (activeTab === 'reports') keys.push(QUERY_KEYS.documents.list(AUDIT_DOCS_FILTER));
    if (activeTab === 'transfers') keys.push(QUERY_KEYS.documents.list(TRANSFER_DOCS_FILTER));
    keys.forEach(queryKey => {
      void queryClient.refetchQueries({ queryKey, exact: true, type: 'active' }, { cancelRefetch: false });
    });
  }, [activeTab, selectedLocation, queryClient]);

  const { refetch: refetchIntegrity } = integrityQuery;
  const refreshIntegrity = useCallback(() => { void refetchIntegrity(); }, [refetchIntegrity]);
  const { refetch: refetchAuditItems } = auditItemsQuery;
  const refreshAuditItems = useCallback(() => { void refetchAuditItems(); }, [refetchAuditItems]);

  const auditDocs = useMemo(() => listFromResponse<Record<string, unknown>>(auditDocsQuery.data), [auditDocsQuery.data]);
  const transfers = useMemo(() => listFromResponse<Record<string, unknown>>(transfersQuery.data), [transfersQuery.data]);

  return {
    integrityReport: integrityQuery.data ?? null,
    integrityLoading: integrityQuery.isFetching,
    refreshIntegrity,
    rebuildItems: rebuildItemsQuery.data ?? NO_ITEMS,
    nextRef: nextRefQuery.data ?? DEFAULT_NEXT_REF,
    auditItems: auditItemsQuery.data ?? NO_ROWS,
    refreshAuditItems,
    auditDocs,
    auditDocsLoading: auditDocsQuery.isFetching,
    transfers,
    transfersLoading: transfersQuery.isFetching,
  };
}

export interface InventoryDocumentLine {
  code?: string;
  name?: string;
  unit?: string;
  quantity?: number | string;
  system_stock?: number | string;
  variance?: number | string;
  location?: string;
}

export interface InventoryDocumentDetail {
  id?: number;
  ref_number?: string;
  refNumber?: string;
  date?: string;
  location?: string;
  user?: string;
  notes?: string | null;
  /** v9.0.67 (TD-489): انبار مبدأ و مقصد حواله انتقال */
  sourceLocation?: string;
  destinationLocation?: string;
  items?: InventoryDocumentLine[];
}

/**
 * جزئیات یک سند (GET /documents/:id) برای مودال‌های انبارگردانی و حواله؛ هر بار باز شدن مودال دوباره خوانده می‌شود
 * و با بستن صفحه لغو می‌شود. خطا مثل قبل یک بار با پیام فارسی اعلام می‌شود.
 */
export function useInventoryDocumentDetail(docId: number | null, errorText: string, logLabel: string) {
  return useQuery<InventoryDocumentDetail | null>({
    queryKey: QUERY_KEYS.documents.detail(docId ?? 0),
    enabled: docId !== null,
    queryFn: async ({ signal }) => {
      try {
        return (await fetchJson<InventoryDocumentDetail | null>(`/documents/${docId}`, { signal })) ?? null;
      } catch (err: unknown) {
        if (!signal.aborted) {
          console.error(`Failed to fetch ${logLabel} document ${docId}:`, err);
          toast.error(errorText);
        }
        throw err;
      }
    },
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

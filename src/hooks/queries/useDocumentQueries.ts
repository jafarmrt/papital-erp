import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { READ_ON_EVERY_OPENING } from './readOnEveryOpening';
import type { DocumentLineStock } from '../../lib/documents/documentLineStock';

export interface DocumentFilters {
  type?: string;
  /** v9.0.344 (TD-800): چند نوع با ویرگول (`invoice,proforma`)، به جای `type` */
  types?: string;
  status?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

// v10.0.216 (OBS-R1-97): درخواست فهرست اسناد و داده‌های پایه صفحه اسناد انبار با ترک صفحه لغو می‌شود (`signal`)
export function useDocumentsQuery(filters: DocumentFilters) {
  return useQuery({
    queryKey: QUERY_KEYS.documents.list(filters),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (filters.type && filters.type !== 'all') params.set('type', filters.type);
      if (filters.types) params.set('types', filters.types);
      if (filters.status && filters.status !== 'all') params.set('status', filters.status);
      if (filters.search?.trim()) params.set('search', filters.search.trim());
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      if (filters.page) params.set('page', String(filters.page));
      if (filters.limit) params.set('limit', String(filters.limit));

      const res = await fetchJson(`/documents${params.toString() ? `?${params.toString()}` : ''}`, { signal });
      return res ?? null;
    },
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/** the approvers of a document from its workflow history, for the signature block of its print (V10-6.2) */
export interface DocSignature { name: string; roleTitle: string; date: string }

/**
 * 10.3 (ARCH review finding 3, part 15): the signatures under the document's own key, so an approval (which refreshes
 * `documents`) shows on a print that is open; read again on every opening of the print
 */
export function useDocSignaturesQuery(docId: number | null) {
  return useQuery({
    queryKey: [...QUERY_KEYS.documents.detail(docId ?? 0), 'signatures'],
    queryFn: async ({ signal }) => {
      const res = await fetchJson<{ signatures?: unknown } | null>(`/accounting/doc-signatures?entityId=${docId}`, { signal });
      return Array.isArray(res?.signatures) ? res.signatures as DocSignature[] : [];
    },
    enabled: docId !== null,
    ...READ_ON_EVERY_OPENING,
  });
}

/**
 * 10.3 (ARCH review finding 3, part 15): a document as the approval inbox shows it (`GET /documents/:id`, the answer as
 * it comes), under the document's own key, which the stock windows and the invoice page share; read again on each opening
 */
export function useDocumentDetailQuery<T>(docId: number | null) {
  return useQuery({
    queryKey: QUERY_KEYS.documents.detail(docId ?? 0),
    queryFn: async ({ signal }) => (await fetchJson<T | null>(`/documents/${docId}`, { signal })) ?? null,
    enabled: docId !== null,
    ...READ_ON_EVERY_OPENING,
  });
}

/** v10.0.151 (TD-1175): the warehouse and sellable stock of a document's outgoing lines, under the document's key */
export function useDocumentLineStockQuery(docId: number | null) {
  return useQuery({
    queryKey: [...QUERY_KEYS.documents.detail(docId ?? 0), 'line-stock'],
    queryFn: async ({ signal }) => {
      const res = await fetchJson<{ data?: DocumentLineStock[] } | null>(`/documents/${docId}/line-stock`, { signal });
      return Array.isArray(res?.data) ? res.data : [];
    },
    enabled: docId !== null,
    ...READ_ON_EVERY_OPENING,
  });
}

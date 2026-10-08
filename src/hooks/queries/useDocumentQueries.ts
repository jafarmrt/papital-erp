import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';

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

export function useDocumentsQuery(filters: DocumentFilters) {
  return useQuery({
    queryKey: QUERY_KEYS.documents.list(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.type && filters.type !== 'all') params.set('type', filters.type);
      if (filters.types) params.set('types', filters.types);
      if (filters.status && filters.status !== 'all') params.set('status', filters.status);
      if (filters.search?.trim()) params.set('search', filters.search.trim());
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      if (filters.page) params.set('page', String(filters.page));
      if (filters.limit) params.set('limit', String(filters.limit));

      const res = await fetchJson(`/documents${params.toString() ? `?${params.toString()}` : ''}`);
      return res ?? null;
    },
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';

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

export function useTransactionsQuery(filters: TransactionFilters) {
  return useQuery({
    queryKey: QUERY_KEYS.transactions.list(filters),
    queryFn: async () => {
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

      const res = await fetchJson(`/transactions?${params.toString()}`);
      const rawData = Array.isArray(res?.data)
        ? res.data
        : (Array.isArray(res) ? res : []);
      return {
        transactions: rawData,
        total: res?.total || 0,
        totalPages: res?.totalPages || 1,
        page: res?.page || filters.page || 1,
      };
    },
    staleTime: 30 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (prev: any) => prev,
  });
}

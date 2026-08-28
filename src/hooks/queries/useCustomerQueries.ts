import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { Customer } from '../../types';
import { toast } from 'react-hot-toast';
import { QUERY_KEYS, customerKeys } from '../../lib/queryKeys';
import { invalidateDomain } from '../../lib/queryInvalidation';

export { customerKeys };

interface CustomersResponse {
  data: Customer[];
  total: number;
  page: number;
  totalPages: number;
}

export function useCustomersQuery(page: number, limit: number, search?: string, partyType?: string) {
  return useQuery<CustomersResponse>({
    queryKey: QUERY_KEYS.customers.list({ page, limit, search, partyType }),
    queryFn: async () => {
      const query = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });
      if (search && search.trim()) {
        query.append('search', search.trim());
      }
      if (partyType && partyType !== 'all') {
        query.append('partyType', partyType);
      }
      const res = await fetchJson(`/customers?${query.toString()}`);
      if (res && res.data) {
        return {
          data: Array.isArray(res.data) ? res.data : [],
          total: res.total || 0,
          page: res.page || page,
          totalPages: res.totalPages || 1,
        };
      }
      if (Array.isArray(res)) {
        return {
          data: res,
          total: res.length,
          page: 1,
          totalPages: Math.ceil(res.length / limit) || 1,
        };
      }
      return { data: [], total: 0, page: 1, totalPages: 1 };
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useSaveCustomerMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, payload }: { id?: number | null; payload: any }) => {
      const url = id ? `/customers/${id}` : '/customers';
      const method = id ? 'PUT' : 'POST';
      return fetchJson(url, {
        method,
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (_, variables) => {
      invalidateDomain(queryClient, 'customers');
      toast.success(variables.id ? 'اطلاعات مشتری با موفقیت ویرایش شد' : 'حساب شخص جدید با موفقیت ثبت شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در ذخیره اطلاعات مشتری');
    },
  });
}

export function useDeleteCustomerMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      return fetchJson(`/customers/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      invalidateDomain(queryClient, 'customers');
      toast.success('حساب مشتری با موفقیت حذف شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در حذف حساب مشتری');
    },
  });
}

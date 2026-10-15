import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { invalidateDomains } from '../../lib/queryInvalidation';
import { isCustomerTagColor, type CustomerTagColor, type CustomerTagRow } from '../../lib/customers/customerTags';
import { errorMessageOf } from '../../utils';

/** نشانی فهرست برچسب‌های طرف حساب؛ صفحه طرف حساب‌ها و صفحه ارتباط با مشتری هر دو می‌خوانند */
export const CUSTOMER_TAGS_URL = '/customers/tags';

export function tagRowsOf(res: unknown): CustomerTagRow[] {
  const body = res as { data?: unknown } | null;
  const raw: unknown[] = Array.isArray(body?.data) ? body.data : (Array.isArray(res) ? res : []);
  return raw.flatMap((r) => {
    const row = r as Partial<CustomerTagRow>;
    if (typeof row?.id !== 'number' || typeof row.name !== 'string') return [];
    return [{
      id: row.id,
      name: row.name,
      color: isCustomerTagColor(row.color) ? row.color : 'slate',
      version: Number(row.version) || 1,
      customerCount: Number(row.customerCount) || 0,
    }];
  });
}

/** v10.1.20 (N-02 بخش ۳): برچسب‌های زنده طرف حساب‌ها */
export function useCustomerTagsQuery(enabled = true) {
  return useQuery<CustomerTagRow[]>({
    queryKey: QUERY_KEYS.customers.tags,
    queryFn: async () => tagRowsOf(await fetchJson(CUSTOMER_TAGS_URL)),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export interface CustomerTagSave {
  id?: number;
  name: string;
  color: CustomerTagColor;
  version?: number;
}

export function useSaveCustomerTagMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name, color, version }: CustomerTagSave) => fetchJson(
      id ? `${CUSTOMER_TAGS_URL}/${id}` : CUSTOMER_TAGS_URL,
      { method: id ? 'PUT' : 'POST', body: JSON.stringify(id ? { name, color, version } : { name, color }) },
    ),
    onSuccess: () => { void invalidateDomains(queryClient, ['customers', 'crm']); },
    onError: (err: unknown) => { toast.error(errorMessageOf(err) || 'برچسب ذخیره نشد.'); },
  });
}

export function useDeleteCustomerTagMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => fetchJson(`${CUSTOMER_TAGS_URL}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void invalidateDomains(queryClient, ['customers', 'crm']);
      toast.success('برچسب حذف شد.');
    },
    onError: (err: unknown) => { toast.error(errorMessageOf(err) || 'برچسب حذف نشد.'); },
  });
}

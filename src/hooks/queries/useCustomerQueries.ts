import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { Customer } from '../../types';
import { toast } from 'react-hot-toast';
import { QUERY_KEYS, customerKeys } from '../../lib/queryKeys';
import { invalidateDomain, invalidatePreset } from '../../lib/queryInvalidation';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';
import { cappedPickListUrl, takePickList } from '../../lib/permissions/pickListCap';
import { customerAccountCardUrl } from '../../lib/customers/customerAccountCard';
import { customerDocumentsUrl } from '../../lib/customers/customerDocuments';
import type { AccountCardReport } from '../../lib/accounting/accountCard';
import { READ_ON_EVERY_OPENING } from './readOnEveryOpening';

export { customerKeys };

interface CustomersResponse {
  data: Customer[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * طرف حساب‌ها از فهرست انتخاب (فرم پروژه؛ بی یادداشت و نسخه رکورد، TD-887). v11 phase 6.1ch (C13): at most the cap; the
 * pickers over a cut list also search on the server
 */
export function useCustomerOptionsQuery(options: { readOnEveryOpening?: boolean; enabled?: boolean } = {}) {
  return useQuery<Customer[]>({
    queryKey: QUERY_KEYS.customers.options({ all: true }),
    queryFn: async ({ signal }) => {
      const res = await fetchJson(cappedPickListUrl(PICK_LIST_URLS.customers), { signal });
      return takePickList<Customer>(Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []));
    },
    staleTime: 60 * 1000,
    enabled: options.enabled ?? true,
    // 10.3 (part 16): the project form reads it again on each opening
    ...(options.readOnEveryOpening ? READ_ON_EVERY_OPENING : {}),
  });
}

export function useCustomersQuery(page: number = 1, limit: number = 50, search?: string, partyType?: string, tagId?: number | null) {
  return useQuery<CustomersResponse>({
    queryKey: QUERY_KEYS.customers.list({ page, limit, search, partyType, tagId: tagId ?? null }),
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
      if (tagId) query.append('tagId', String(tagId));
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
    // v10.0.135 (TD-1226): پیام موفقیت را صفحه می‌دهد؛ پیش‌تر هوک هم پیام می‌داد و دو پیام دیده می‌شد
    // 10.3: the sales files and the dashboard show the customer's name too
    onSuccess: () => {
      void invalidatePreset(queryClient, 'customerChange');
    },
    onError: (err: any) => {
      // v10.1.51 (OBS-R2-26): after a stale version (409) the list is read again, so the form reopens on the stored version
      if (err?.status === 409) void invalidateDomain(queryClient, 'customers');
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
      void invalidatePreset(queryClient, 'customerChange');
      toast.success('حساب مشتری با موفقیت حذف شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در حذف حساب مشتری');
    },
  });
}

/**
 * 10.3 (ARCH review finding 3, part 12): a party's account card (`GET /customers/:id/account-card`, which answers the
 * report both as `report` and spread). It sits under the accounting reports, so a voucher, a treasury entry or a
 * document refreshes it while the card or the dossier is open; it is read again on each opening of a party.
 */
export function useCustomerAccountCardQuery(customerId: number | null) {
  return useQuery<AccountCardReport | null>({
    queryKey: QUERY_KEYS.accounting.report('customer-account-card', { customerId }),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<(AccountCardReport & { report?: AccountCardReport }) | null>(customerAccountCardUrl(customerId ?? 0), { signal });
      return res?.report ?? res ?? null;
    },
    enabled: customerId !== null,
    ...READ_ON_EVERY_OPENING,
  });
}

/** a sales document of a party as its dossier lists it (`GET /customers/:id/documents`) */
export interface CustomerSalesDocument {
  id: number;
  type?: string;
  status?: string;
  [field: string]: unknown;
}

/** 10.3 (part 12): the party's sales documents for its dossier, under the party's key, so a document change refreshes them */
export function useCustomerDocumentsQuery(customerId: number | null) {
  return useQuery<CustomerSalesDocument[]>({
    queryKey: [...QUERY_KEYS.customers.detail(customerId ?? 0), 'documents'] as const,
    queryFn: async ({ signal }) => {
      const res = await fetchJson<unknown>(customerDocumentsUrl(customerId ?? 0), { signal });
      const body = res as { data?: unknown } | null;
      return (Array.isArray(res) ? res : Array.isArray(body?.data) ? body.data : []) as CustomerSalesDocument[];
    },
    enabled: customerId !== null,
    ...READ_ON_EVERY_OPENING,
  });
}

/**
 * 10.3: a sales file turned into a customer adds or links a customer, so the customer lists (the invoice form it opens
 * picks from them), the sales files and the dashboard change; it refreshed only the sales files before
 */
export function useConvertLeadToCustomerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (leadId: number) => fetchJson(`/crm/leads/${leadId}/convert-to-customer`, { method: 'POST' }),
    onSuccess: () => {
      void invalidatePreset(queryClient, 'customerChange');
    },
    // the sales files page says a failure and ends its own progress notice, as before this hook (not the client's toast)
    onError: () => undefined,
  });
}

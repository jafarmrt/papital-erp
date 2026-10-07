import { useCallback, useEffect, useRef } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { JournalVoucher } from '../../types';
import { ACCOUNTING_LIST_QUERY_OPTIONS, fetchAccountingList, silentMutationError } from './accountingQueryConfig';
import { invalidateAfterVoucherChange } from './accountingInvalidation';
import { toVoucherPage, voucherListParams, type JournalVoucherPage, type VoucherListFilters } from '../../lib/accounting/voucherList';

/**
 * اسناد حسابداری: فهرست اسناد با useQuery و همه ذخیره‌ها (ثبت/ویرایش/حذف/معکوس/اصلاحی/تایید/قطعی) با useMutation —
 * همان آدرس‌ها، بدنه‌ها و پیام‌های صفحه پیشین. هر ذخیره کلیدهای تغییر سند را باطل می‌کند
 * (فهرست اسناد، خلاصه، مانده حساب‌ها، گزارش‌ها، اسناد انبار/فروش و لیست‌های حقوق).
 */

export interface VoucherFilters {
  startDate?: string;
  endDate?: string;
  type?: string;
  search?: string;
}

export type VoucherStatus = 'draft' | 'approved' | 'permanent';

/** بدنه سند حسابداری (همان داده NewVoucherModal) */
export type VoucherPayload = object;

export interface VoucherCorrectionPayload {
  reason: string;
  newItems: object[];
  newDescription?: string;
  date?: string;
}

export interface VoucherActionResult {
  message?: string;
  [key: string]: unknown;
}

function vouchersUrl(filters: VoucherFilters): string {
  const params = new URLSearchParams();
  if (filters.startDate) params.append('startDate', filters.startDate);
  if (filters.endDate) params.append('endDate', filters.endDate);
  if (filters.type) params.append('voucherType', filters.type);
  if (filters.search) params.append('search', filters.search);
  const query = params.toString();
  return query ? `/accounting/vouchers?${query}` : '/accounting/vouchers';
}

export function useVouchersQuery(filters: VoucherFilters = {}) {
  return useQuery<JournalVoucher[]>({
    queryKey: QUERY_KEYS.accounting.vouchers(filters),
    queryFn: ({ signal }) => fetchAccountingList<JournalVoucher>(vouchersUrl(filters), signal, 'vouchers'),
    ...ACCOUNTING_LIST_QUERY_OPTIONS,
  });
}

/**
 * v9.0.109 (TD-565): یک صفحه از فهرست اسناد با صافی‌ها، `total` و شمار هر وضعیت از سرور (برگه «اسناد حسابداری»).
 * کلید زیر `vouchers()` است تا هر ذخیره سند همین صفحه را هم باطل کند.
 */
export function useVoucherPageQuery(filters: VoucherListFilters, page: number, limit: number) {
  return useQuery<JournalVoucherPage>({
    queryKey: [...QUERY_KEYS.accounting.vouchers(), 'page', filters, page, limit],
    queryFn: async ({ signal }) => toVoucherPage(
      await fetchJson<unknown>(`/accounting/vouchers?${voucherListParams(filters, page, limit).toString()}`, { signal }),
      page,
      limit,
    ),
    ...ACCOUNTING_LIST_QUERY_OPTIONS,
    placeholderData: keepPreviousData,
  });
}

const STATUS_LABELS: Record<VoucherStatus, string> = {
  draft: 'پیش‌نویس (یادداشت اولیه)',
  approved: 'تایید شده (حسابرسی‌شده)',
  permanent: 'دائم و قطعی (قفل دفاتر)',
};

export function useVoucherMutations() {
  const queryClient = useQueryClient();
  const onSuccess = () => { void invalidateAfterVoucherChange(queryClient); };
  const common = { onSuccess, onError: silentMutationError };

  const saveVoucher = useMutation<unknown, unknown, { editingId: number | null; data: VoucherPayload }>({
    mutationFn: ({ editingId, data }) => (editingId !== null
      ? fetchJson(`/accounting/vouchers/${editingId}`, { method: 'PUT', body: JSON.stringify(data) })
      : fetchJson('/accounting/vouchers', { method: 'POST', body: JSON.stringify(data) })),
    ...common,
  });

  const deleteVoucher = useMutation<unknown, unknown, number>({
    mutationFn: (id) => fetchJson(`/accounting/vouchers/${id}`, { method: 'DELETE' }),
    ...common,
  });

  const reverseVoucher = useMutation<VoucherActionResult | null, unknown, { voucherId: number; reason?: string; date?: string }>({
    mutationFn: ({ voucherId, reason, date }) => fetchJson(`/accounting/vouchers/${voucherId}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ reason, date }),
    }),
    onSuccess: (res) => {
      toast.success(res?.message || 'سند معکوس با موفقیت صادر شد');
      onSuccess();
    },
    onError: silentMutationError,
  });

  const correctVoucher = useMutation<VoucherActionResult | null, unknown, { voucherId: number; data: VoucherCorrectionPayload }>({
    mutationFn: ({ voucherId, data }) => fetchJson(`/accounting/vouchers/${voucherId}/correct`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: (res) => {
      toast.success(res?.message || 'سند عکس و سند اصلاحی با موفقیت صادر شدند');
      onSuccess();
    },
    onError: silentMutationError,
  });

  const finalizeVoucher = useMutation<VoucherActionResult | null, unknown, number>({
    mutationFn: (voucherId) => fetchJson(`/accounting/vouchers/${voucherId}/finalize`, { method: 'POST' }),
    onSuccess: (res) => {
      toast.success(res?.message || 'سند با موفقیت قطعی و دائم شد');
      onSuccess();
    },
    onError: silentMutationError,
  });

  const batchFinalizeVouchers = useMutation<VoucherActionResult | null, unknown, number[]>({
    mutationFn: (ids) => fetchJson('/accounting/vouchers/batch-finalize', { method: 'POST', body: JSON.stringify({ ids }) }),
    onSuccess: (res) => {
      toast.success(res?.message || 'اسناد با موفقیت قطعی و دائم شدند');
      onSuccess();
    },
    onError: silentMutationError,
  });

  const batchApproveVouchers = useMutation<VoucherActionResult | null, unknown, number[]>({
    mutationFn: (ids) => fetchJson('/accounting/vouchers/batch-approve', { method: 'POST', body: JSON.stringify({ ids }) }),
    onSuccess: (res) => {
      toast.success(res?.message || 'اسناد پیش‌نویس با موفقیت تایید حسابداری شدند');
      onSuccess();
    },
    onError: silentMutationError,
  });

  const setVoucherStatus = useMutation<unknown, unknown, { voucherId: number; status: VoucherStatus; reason?: string }>({
    mutationFn: ({ voucherId, status, reason }) => fetchJson(`/accounting/vouchers/${voucherId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, reason }),
    }),
    onSuccess: (_res, { status }) => {
      toast.success(`وضعیت سند با موفقیت به «${STATUS_LABELS[status] || status}» تغییر یافت`);
      onSuccess();
    },
    onError: silentMutationError,
  });

  return {
    saveVoucher,
    deleteVoucher,
    reverseVoucher,
    correctVoucher,
    finalizeVoucher,
    batchFinalizeVouchers,
    batchApproveVouchers,
    setVoucherStatus,
  };
}

/**
 * بارگذاری یک سند برای نمایش جزئیات (مرور حساب‌ها): همیشه تازه از سرور؛ درخواست‌های در جریان با بسته شدن
 * تب لغو می‌شوند (همان الگوی بارگذاری سند در صفحه صدور فاکتور).
 */
export function useVoucherDetailLoader() {
  const queryClient = useQueryClient();
  const inFlight = useRef(new Set<number>());

  useEffect(() => {
    const ids = inFlight.current;
    return () => {
      ids.forEach(id => { void queryClient.cancelQueries({ queryKey: QUERY_KEYS.accounting.voucherDetail(id) }); });
      ids.clear();
    };
  }, [queryClient]);

  return useCallback(async (id: number): Promise<JournalVoucher | null> => {
    inFlight.current.add(id);
    try {
      return await queryClient.fetchQuery({
        queryKey: QUERY_KEYS.accounting.voucherDetail(id),
        queryFn: async ({ signal }) => (await fetchJson<JournalVoucher | null>(`/accounting/vouchers/${id}`, { signal })) ?? null,
        staleTime: 0,
        retry: false,
      });
    } finally {
      inFlight.current.delete(id);
    }
  }, [queryClient]);
}

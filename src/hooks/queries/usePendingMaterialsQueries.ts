import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { PendingMaterial, Category } from '../../types';
import { toast } from 'react-hot-toast';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { invalidateDomain, invalidatePreset } from '../../lib/queryInvalidation';
import type { PendingMaterialForm } from '../../lib/pendingMaterials/pendingMaterialForm';
import { pendingMaterialListUrl, type PendingMaterialListFilters, type PendingMaterialPage } from '../../lib/pendingMaterials/pendingMaterialList';

/** v10.0.27 (OBS-R1-90): one page of the queue from the server, with its status counts; categories for the filter */
export function usePendingMaterialsQuery(filters: PendingMaterialListFilters) {
  return useQuery<{ page: PendingMaterialPage<PendingMaterial>; categories: Category[] }>({
    queryKey: [...QUERY_KEYS.pendingMaterials.list(), filters],
    queryFn: async () => {
      const [page, catRes] = await Promise.all([
        fetchJson<PendingMaterialPage<PendingMaterial>>(pendingMaterialListUrl(filters)),
        fetchJson('/categories?type=raw_material'),
      ]);
      const categories = Array.isArray(catRes?.data) ? catRes.data : (Array.isArray(catRes) ? catRes : []);
      return { page: { ...page, data: Array.isArray(page?.data) ? page.data : [] }, categories };
    },
    placeholderData: keepPreviousData,
    staleTime: 1000 * 30,
  });
}

export function useApprovePendingMaterialMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: PendingMaterialForm }) => {
      return fetchJson(`/pending-materials/${id}/approve`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      void invalidatePreset(queryClient, 'pendingMaterialChange');
      toast.success('ماده اولیه با موفقیت تأیید شد و به انبار اضافه گردید');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در تأیید ماده اولیه');
    },
  });
}

export function useRejectPendingMaterialMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      return fetchJson(`/pending-materials/${id}/reject`, {
        method: 'PUT',
        body: JSON.stringify({ rejectionReason: reason }),
      });
    },
    onSuccess: () => {
      void invalidateDomain(queryClient, 'pendingMaterials');
      toast.success('ماده اولیه رد شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در رد ماده اولیه');
    },
  });
}

export function useUpdatePendingMaterialMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: PendingMaterialForm }) => {
      return fetchJson(`/pending-materials/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      void invalidateDomain(queryClient, 'pendingMaterials');
      toast.success('مشخصات ماده اولیه به‌روزرسانی شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در ویرایش ماده اولیه');
    },
  });
}

export function useDeletePendingMaterialMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      return fetchJson(`/pending-materials/${id}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      void invalidateDomain(queryClient, 'pendingMaterials');
      toast.success('درخواست ماده اولیه حذف شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در حذف درخواست');
    },
  });
}

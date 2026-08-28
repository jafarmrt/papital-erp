import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { PendingMaterial, Category } from '../../types';
import { toast } from 'react-hot-toast';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { invalidateDomain, invalidatePreset } from '../../lib/queryInvalidation';

export function usePendingMaterialsQuery() {
  return useQuery<{ items: PendingMaterial[]; categories: Category[] }>({
    queryKey: QUERY_KEYS.pendingMaterials.list(),
    queryFn: async () => {
      const [matRes, catRes] = await Promise.all([
        fetchJson('/pending-materials'),
        fetchJson('/categories?type=raw_material'),
      ]);
      const items = Array.isArray(matRes?.data) ? matRes.data : (Array.isArray(matRes) ? matRes : []);
      const categories = Array.isArray(catRes?.data) ? catRes.data : (Array.isArray(catRes) ? catRes : []);
      return { items, categories };
    },
    staleTime: 1000 * 30,
  });
}

export function useApprovePendingMaterialMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: any }) => {
      return fetchJson(`/pending-materials/${id}/approve`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      invalidatePreset(queryClient, 'pendingMaterialChange');
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
      invalidateDomain(queryClient, 'pendingMaterials');
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
    mutationFn: async ({ id, payload }: { id: number; payload: any }) => {
      return fetchJson(`/pending-materials/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      invalidateDomain(queryClient, 'pendingMaterials');
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
      invalidateDomain(queryClient, 'pendingMaterials');
      toast.success('درخواست ماده اولیه حذف شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در حذف درخواست');
    },
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { Personnel, User } from '../../types';
import { toast } from 'react-hot-toast';
import { QUERY_KEYS, personnelKeys } from '../../lib/queryKeys';
import { invalidateDomain } from '../../lib/queryInvalidation';

export { personnelKeys };

/**
 * Hook to query all personnel
 */
export function usePersonnelListQuery() {
  return useQuery<Personnel[]>({
    queryKey: QUERY_KEYS.personnel.list(),
    queryFn: async () => {
      const res = await fetchJson('/personnel');
      return Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to query system users for linking with personnel
 */
export function useUsersListQuery() {
  return useQuery<User[]>({
    queryKey: ['users', 'list'],
    queryFn: async () => {
      try {
        const res = await fetchJson('/users');
        return Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
      } catch (e) {
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Hook to create or update personnel
 */
export function useSavePersonnelMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, payload }: { id?: number | null; payload: any }) => {
      const url = id ? `/personnel/${id}` : '/personnel';
      const method = id ? 'PUT' : 'POST';
      return fetchJson(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (_, variables) => {
      invalidateDomain(queryClient, 'personnel');
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.personnel.all });
      toast.success(variables.id ? 'اطلاعات پرسنل با موفقیت به‌روزرسانی شد' : 'پرسنل جدید با موفقیت ثبت شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در ذخیره اطلاعات پرسنل');
    },
  });
}

/**
 * Hook to delete personnel
 */
export function useDeletePersonnelMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      return fetchJson(`/personnel/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      invalidateDomain(queryClient, 'personnel');
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.personnel.all });
      toast.success('پرسنل با موفقیت حذف شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در حذف پرسنل');
    },
  });
}

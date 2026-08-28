import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { toast } from 'react-hot-toast';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { invalidateDomain, invalidateDomains } from '../../lib/queryInvalidation';

export function useUsersQuery() {
  return useQuery({
    queryKey: QUERY_KEYS.users.list(),
    queryFn: async () => {
      const res = await fetchJson('/users');
      return Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
    },
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useRolesQuery() {
  return useQuery({
    queryKey: QUERY_KEYS.roles.list(),
    queryFn: async () => {
      const res = await fetchJson('/roles');
      return Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function usePermissionCatalogQuery() {
  return useQuery({
    queryKey: QUERY_KEYS.permissions.catalog(),
    queryFn: async () => {
      const res = await fetchJson('/permissions');
      return Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useDeleteUserMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: number) => {
      return fetchJson(`/users/${userId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      invalidateDomain(queryClient, 'users').then(() => {
        toast.success('کاربر با موفقیت حذف شد');
      });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در حذف کاربر');
    },
  });
}

export function useSaveUserMutation(onDone?: () => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, payload }: { userId?: number | null; payload: any }) => {
      if (userId) {
        return fetchJson(`/users/${userId}`, { method: 'PUT', body: JSON.stringify(payload) });
      }
      return fetchJson('/users', { method: 'POST', body: JSON.stringify(payload) });
    },
    onSuccess: (_res, vars) => {
      invalidateDomains(queryClient, ['users', 'roles']).then(() => {
        toast.success(vars.userId ? 'اطلاعات کاربر با موفقیت ویرایش شد' : 'کاربر جدید با موفقیت ایجاد شد');
        onDone?.();
      });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در ثبت کاربر');
    },
  });
}

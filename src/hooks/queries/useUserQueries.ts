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
      void invalidateDomain(queryClient, 'users').then(() => {
        toast.success('کاربر با موفقیت حذف شد');
      });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در حذف کاربر');
    },
  });
}

export function useDeleteRoleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (roleId: number) => {
      return fetchJson(`/roles/${roleId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      void invalidateDomains(queryClient, ['roles', 'users']).then(() => {
        toast.success('نقش با موفقیت حذف شد');
      });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در حذف نقش');
    },
  });
}

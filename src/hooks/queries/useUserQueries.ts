import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { toast } from 'react-hot-toast';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { invalidateDomain, invalidateDomains } from '../../lib/queryInvalidation';

// OBS-R1-38: every read passes React Query's signal (a closed page aborts it) and every write of the users and roles
// screens is a mutation that refreshes the lists it changes.

export function useUsersQuery() {
  return useQuery({
    queryKey: QUERY_KEYS.users.list(),
    queryFn: async ({ signal }) => {
      const res = await fetchJson('/users', { signal });
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
    queryFn: async ({ signal }) => {
      const res = await fetchJson('/roles', { signal });
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
    queryFn: async ({ signal }) => {
      const res = await fetchJson('/permissions', { signal });
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

export interface UserSavePayload {
  username: string;
  password: string;
  full_name: string;
  role: string;
}

/** Creates a user (no id) or edits one; the users list is refreshed. Errors are left to the form (deleted username). */
export function useSaveUserMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id?: number | null; payload: UserSavePayload }) =>
      id
        ? fetchJson(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
        : fetchJson('/users', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => invalidateDomain(queryClient, 'users'),
  });
}

/** Restores a deleted user with a new role and a temporary password; the users list is refreshed. */
export function useRestoreUserMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, role, password }: { id: number; role: string; password: string }) =>
      fetchJson(`/users/${id}/restore`, { method: 'POST', body: JSON.stringify({ role, password }) }),
    onSuccess: () => invalidateDomain(queryClient, 'users'),
  });
}

/** Creates a role (no id) or edits one; the roles and users lists are refreshed. */
export function useSaveRoleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id?: number | null; body: unknown }) =>
      id
        ? fetchJson(`/roles/${id}`, { method: 'PUT', body: JSON.stringify(body) })
        : fetchJson('/roles', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => invalidateDomains(queryClient, ['roles', 'users']),
  });
}

import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { Personnel, User } from '../../types';
import { toast } from 'react-hot-toast';
import { QUERY_KEYS, personnelKeys } from '../../lib/queryKeys';
import { invalidateDomain } from '../../lib/queryInvalidation';
import { EMPTY_PERSONNEL_STATS, personnelPageUrl, type PersonnelPage, type PersonnelPageParams } from '../../lib/personnel/personnelList';

export { personnelKeys };

/**
 * Hook to query all personnel (the pick lists). OBS-R2-57: the personnel page reads it only while a window that needs every
 * personnel is open (`enabled`), and its table reads `usePersonnelPageQuery`.
 */
export function usePersonnelListQuery(options: { enabled?: boolean; refetchOnMount?: boolean | 'always' } = {}) {
  return useQuery<Personnel[]>({
    enabled: options.enabled ?? true,
    queryKey: QUERY_KEYS.personnel.list(),
    queryFn: async ({ signal }) => {
      const res = await fetchJson('/personnel', { signal });
      return Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
    // v10.2 package 11 part 5c (TD-1361): the payroll page reads the salaries again on every opening, as it did before
    ...(options.refetchOnMount !== undefined ? { refetchOnMount: options.refetchOnMount } : {}),
  });
}

/** OBS-R2-57 (TD-1321): one page of the personnel table, searched, filtered and counted on the server */
export function usePersonnelPageQuery(params: PersonnelPageParams) {
  return useQuery<PersonnelPage<Personnel>>({
    queryKey: QUERY_KEYS.personnel.page(params),
    queryFn: async () => {
      const res = await fetchJson<Partial<PersonnelPage<Personnel>>>(personnelPageUrl(params));
      return {
        data: Array.isArray(res?.data) ? res.data : [],
        total: Number(res?.total ?? 0),
        page: Number(res?.page ?? params.page),
        limit: Number(res?.limit ?? params.limit),
        stats: res?.stats ?? EMPTY_PERSONNEL_STATS,
      };
    },
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
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
      void invalidateDomain(queryClient, 'personnel');
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.personnel.all });
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
      void invalidateDomain(queryClient, 'personnel');
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.personnel.all });
      toast.success('پرسنل با موفقیت حذف شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در حذف پرسنل');
    },
  });
}

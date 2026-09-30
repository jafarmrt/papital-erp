import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { toast } from 'react-hot-toast';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { ProductionProject } from '../../types';

export function useProjectsQuery(options?: { enabled?: boolean }) {
  return useQuery<ProductionProject[]>({
    queryKey: QUERY_KEYS.projects.list(),
    queryFn: async ({ signal }) => {
      const res = await fetchJson('/projects', { signal });
      return Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
    },
    staleTime: 60 * 1000,
    gcTime: 15 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useProjectDetailQuery(projectId: number | null, options?: { enabled?: boolean }) {
  return useQuery<ProductionProject | null>({
    queryKey: QUERY_KEYS.projects.detail(projectId ?? 0),
    queryFn: async ({ signal }) => {
      if (!projectId) return null;
      const res = await fetchJson(`/projects/${projectId}`, { signal });
      return res || null;
    },
    staleTime: 30 * 1000,
    enabled: (options?.enabled ?? true) && projectId !== null && projectId > 0,
  });
}

export function useDeleteProjectMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      return fetchJson<{ success?: boolean; error?: string }>(`/projects/${id}`, { method: 'DELETE' });
    },
    onSuccess: (res) => {
      if (res && res.success) {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.projects.all });
        toast.success('پروژه با موفقیت حذف شد');
      } else {
        toast.error(res?.error || 'خطا در حذف پروژه');
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در ارتباط با سرور هنگام حذف پروژه');
    },
  });
}

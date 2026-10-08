import { keepPreviousData, useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { toast } from 'react-hot-toast';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { ProductionProject } from '../../types';
import {
  PROJECT_LIST_PAGE_SIZE,
  projectListParams,
  toProjectListPage,
  type ProjectListFilters,
  type ProjectListPage,
} from '../../lib/projects/projectList';

/**
 * v9.0.412 (TD-743): یک صفحه از فهرست پروژه‌ها با صافی‌های سرور (`GET /projects`)؛ پیش‌تر همه پروژه‌ها با همه JSONها
 * خوانده و در مرورگر صافی می‌شدند.
 */
export function useProjectListQuery(filters: ProjectListFilters, page: number, limit: number = PROJECT_LIST_PAGE_SIZE) {
  return useQuery<ProjectListPage>({
    queryKey: [...QUERY_KEYS.projects.list(), filters, page, limit],
    queryFn: async ({ signal }) => toProjectListPage(
      await fetchJson<unknown>(`/projects?${projectListParams(filters, page, limit).toString()}`, { signal }),
      page,
      limit,
    ),
    staleTime: 60 * 1000,
    gcTime: 15 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/** پرونده کامل و تازه یک پروژه (فرم ویرایش از فهرست خلاصه باز می‌شود و نسخه تازه می‌خواهد، TD-742) */
export function fetchProjectRecord(queryClient: QueryClient, projectId: number): Promise<ProductionProject> {
  return queryClient.fetchQuery({
    queryKey: QUERY_KEYS.projects.detail(projectId),
    queryFn: ({ signal }) => fetchJson<ProductionProject>(`/projects/${projectId}`, { signal }),
    staleTime: 0,
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
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.projects.all });
        toast.success('پروژه با موفقیت حذف شد');
      } else {
        toast.error(res?.error || 'خطا در حذف پروژه');
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در ارتباط با سامانه هنگام حذف پروژه');
    },
  });
}

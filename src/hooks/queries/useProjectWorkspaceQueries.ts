import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';
import type { Item } from '../../types';
import type { ProjectStepCounts } from '../../lib/projects/projectSteps';

/** the counts of a project's step bar; under the project's key, so every project save that invalidates it refreshes them */
export const projectStepsKey = (projectId: number) => [...QUERY_KEYS.projects.detail(projectId), 'steps'] as const;

export function useProjectStepCounts(projectId: number | null) {
  return useQuery<ProjectStepCounts>({
    queryKey: projectStepsKey(projectId ?? 0),
    queryFn: ({ signal }) => fetchJson<ProjectStepCounts>(`/projects/${projectId}/steps`, { signal }),
    enabled: projectId !== null,
    staleTime: 30 * 1000,
  });
}

/** the item pick list the materials and delivery tabs read (TD-888); under the items key, so a stock change refreshes it */
export function useProjectItemOptions(enabled: boolean) {
  return useQuery<Item[]>({
    queryKey: [...QUERY_KEYS.items.all, 'options', 'project-workspace'] as const,
    queryFn: async ({ signal }) => {
      const res = await fetchJson<unknown>(PICK_LIST_URLS.items, { signal });
      if (Array.isArray(res)) return res as Item[];
      const data = (res as { data?: unknown } | null)?.data;
      return Array.isArray(data) ? (data as Item[]) : [];
    },
    enabled,
    staleTime: 60 * 1000,
  });
}

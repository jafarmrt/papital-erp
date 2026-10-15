import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';

/** v10.1.5 (TD-1229, D-06 part A): one workflow definition as the definitions list sends it */
export interface WorkflowDefinitionSummary {
  id: number;
  code: string;
  title: string;
  entityType: string;
  description?: string | null;
  version?: number | null;
  isActive?: number | null;
  isArchived?: number | null;
  stateCount?: number;
  transitionCount?: number;
  activeInstancesCount?: number;
}

export type WorkflowLifecycleAction = 'activate' | 'deactivate' | 'archive' | 'restore';

export interface WorkflowLifecycleAnswer {
  success: boolean;
  data?: { changed: boolean; replaced?: { id: number; title: string } };
}

/** Turns a definition on or off, archives or restores it (`workflow.admin`); the definitions list refetches after it */
export function useWorkflowLifecycleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, replaceActive }: { id: number; action: WorkflowLifecycleAction; replaceActive?: boolean }): Promise<WorkflowLifecycleAnswer> =>
      fetchJson(`/workflow/definitions/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify(action === 'activate' && replaceActive ? { replaceActive: true } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workflow.definitions() });
    },
  });
}

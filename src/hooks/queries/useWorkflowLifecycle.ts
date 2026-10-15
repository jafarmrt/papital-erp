import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkflowVersionDiff } from '../../lib/workflow/workflowVersionDiff';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';

/** v10.1.7 (TD-1229, D-06 part A): one workflow definition as the definitions list sends it */
export interface WorkflowDefinitionSummary {
  id: number;
  code: string;
  title: string;
  entityType: string;
  description?: string | null;
  version?: number | null;
  /** v10.1.17 (TD-1270): the version new records start with; `version` above it is an unpublished draft */
  publishedVersion?: number | null;
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

/** v10.1.17 (TD-1270, D-06 part D): a definition's unpublished draft and what it changes against the published version */
export interface WorkflowDraftState {
  definitionId: number;
  publishedVersion: number;
  draftVersion: number | null;
  diff: WorkflowVersionDiff | null;
}

export function useWorkflowDraftQuery(id: number) {
  return useQuery({
    queryKey: QUERY_KEYS.workflow.definitionDraft(id),
    queryFn: (): Promise<WorkflowDraftState> => fetchJson(`/workflow/definitions/${id}/draft`),
    enabled: id > 0,
  });
}

export interface WorkflowPublishAnswer {
  success: boolean;
  data?: { publishedVersion: number; previousPublishedVersion: number; revertedFrom?: number; discardedDraftVersion?: number | null };
}

/** Publishes the draft the admin looked at, or reverts to an earlier version (`workflow.admin`); lists and versions refetch */
export function useWorkflowPublishMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, draftVersion, revertTo }: { id: number; draftVersion?: number; revertTo?: number }): Promise<WorkflowPublishAnswer> =>
      revertTo
        ? fetchJson(`/workflow/definitions/${id}/revert`, { method: 'POST', body: JSON.stringify({ version: revertTo }) })
        : fetchJson(`/workflow/definitions/${id}/publish`, { method: 'POST', body: JSON.stringify({ draftVersion }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workflow.definitions() });
    },
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { invalidatePreset, invalidateDomain } from '../../lib/queryInvalidation';
import { toast } from 'react-hot-toast';

export interface WorkflowState {
  id: number;
  workflowDefinitionId: number;
  stateKey: string;
  title: string;
  stateType: 'initial' | 'intermediate' | 'terminal';
  color: string;
  stepOrder: number;
}

export interface WorkflowTransition {
  id: number;
  workflowDefinitionId: number;
  fromStateId: number;
  toStateId: number;
  actionKey: string;
  title: string;
  requiredRole?: string;
  requiredPermission?: string;
  approvalRuleType?: string;
  kValue?: number;
  autoActionKey?: string;
}

export interface WorkflowInstance {
  id: number;
  workflowDefinitionId: number;
  definitionVersion?: number;
  approvalProgressJson?: Record<string, any>;
  entityType: string;
  entityId: string;
  currentStateId: number;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'TERMINATED' | 'REJECTED';
  startedBy?: number;
  startedByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowHistoryLog {
  id: number;
  instanceId: number;
  fromStateId?: number;
  toStateId?: number;
  transitionId?: number;
  performedBy?: number;
  performedByName?: string;
  actionKey: string;
  actionTitle?: string;
  comment?: string;
  snapshotData?: Record<string, any>;
  createdAt: string;
}

export interface WorkflowInstanceData {
  instance: WorkflowInstance | null;
  definition?: {
    id: number;
    code: string;
    title: string;
    entityType: string;
    version: number;
  };
  currentState?: WorkflowState;
  allStates?: WorkflowState[];
  availableTransitions?: WorkflowTransition[];
  history?: WorkflowHistoryLog[];
  approvalProgress?: Record<string, any>;
  entityContext?: Record<string, any>;
}

export function useWorkflowInboxQuery(page = 1, limit = 50) {
  return useQuery({
    queryKey: QUERY_KEYS.workflow.inbox({ page, limit }),
    queryFn: async () => {
      return fetchJson(`/workflow/inbox?page=${page}&limit=${limit}`);
    },
    staleTime: 1000 * 15, // 15 seconds
  });
}

export function useWorkflowInstanceQuery(entityType: string, entityId: string | number | undefined) {
  return useQuery<WorkflowInstanceData>({
    queryKey: QUERY_KEYS.workflow.instance(entityType, entityId ?? ''),
    queryFn: async () => {
      if (!entityId) return { instance: null };
      return fetchJson(`/workflow/instance/${entityType}/${entityId}`);
    },
    enabled: Boolean(entityId),
  });
}

export function useStartWorkflowMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { workflowCode: string; entityType: string; entityId: string | number }) => {
      return fetchJson('/workflow/start', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    },
    onSuccess: (_, variables) => {
      invalidatePreset(queryClient, 'workflowChange');
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.workflow.instance(variables.entityType, variables.entityId)
      });
      toast.success('چرخه تایید ورکفلو با موفقیت فعال گردید');
    },
    onError: (err: any) => {
      toast.error(err.message || 'خطا در فعال‌سازی چرخه کاری');
    }
  });
}

export function useExecuteTransitionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      instanceId: number;
      transitionId: number;
      comment?: string;
      snapshotData?: Record<string, any>;
      entityType?: string;
      entityId?: string | number;
    }) => {
      return fetchJson('/workflow/transition', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    },
    onSuccess: (res, variables) => {
      invalidatePreset(queryClient, 'workflowChange');
      if (variables.entityType && variables.entityId) {
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.workflow.instance(variables.entityType, variables.entityId)
        });
      }
      toast.success('اقدام ورکفلو با موفقیت ثبت شد');
    },
    onError: (err: any) => {
      toast.error(err.message || 'خطا در ثبت اقدام ورکفلو');
    }
  });
}

export function useWorkflowDefinitionsQuery() {
  return useQuery({
    queryKey: ['workflow', 'definitions'],
    queryFn: async () => {
      return fetchJson('/workflow/definitions');
    }
  });
}

export function useWorkflowDefinitionDetailQuery(id?: number) {
  return useQuery({
    queryKey: ['workflow', 'definition', id],
    queryFn: async () => {
      if (!id) return null;
      return fetchJson(`/workflow/definitions/${id}`);
    },
    enabled: Boolean(id)
  });
}

export function useSaveWorkflowDefinitionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: any) => {
      return fetchJson('/workflow/definitions', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow', 'definitions'] });
      toast.success('تعریف ورکفلو با موفقیت ذخیره گردید');
    },
    onError: (err: any) => {
      toast.error(err.message || 'خطا در ذخیره‌سازی ورکفلو');
    }
  });
}

export function useUpdateCanvasPositionsMutation() {
  return useMutation({
    mutationFn: async (positions: Array<{ id: number; positionX: number; positionY: number }>) => {
      return fetchJson('/workflow/positions', {
        method: 'POST',
        body: JSON.stringify({ positions })
      });
    }
  });
}

export function useWorkflowSlaAnalyticsQuery() {
  return useQuery({
    queryKey: ['workflow', 'analytics', 'sla'],
    queryFn: async () => {
      return fetchJson('/workflow/analytics/sla');
    },
    refetchInterval: 30000 // Refresh SLA metrics every 30s
  });
}

export function useMyTasksQuery(status = 'pending', page = 1, limit = 50) {
  return useQuery({
    queryKey: ['workflow', 'tasks', 'my-tasks', status, page, limit],
    queryFn: async () => {
      return fetchJson(`/workflow/tasks/my-tasks?status=${status}&page=${page}&limit=${limit}`);
    },
    refetchInterval: 15000
  });
}

export function useTaskStatsQuery() {
  return useQuery({
    queryKey: ['workflow', 'tasks', 'stats'],
    queryFn: async () => {
      return fetchJson('/workflow/tasks/stats');
    },
    refetchInterval: 15000
  });
}

export function useExecuteTaskMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { taskId: number; action?: 'approve' | 'reject'; comment?: string; snapshotData?: Record<string, any> }) => {
      return fetchJson(`/workflow/tasks/${payload.taskId}/execute`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    },
    onSuccess: () => {
      invalidatePreset(queryClient, 'workflowChange');
      queryClient.invalidateQueries({ queryKey: ['workflow', 'tasks'] });
      toast.success('وظیفه با موفقیت تعیین تکلیف و اجرا گردید');
    },
    onError: (err: any) => {
      toast.error(err.message || 'خطا در اجرای وظیفه');
    }
  });
}

export function useDelegationsQuery() {
  return useQuery({
    queryKey: ['workflow', 'delegations'],
    queryFn: async () => {
      const res = await fetchJson('/workflow/delegations');
      return Array.isArray(res?.data) ? res.data : [];
    },
    staleTime: 30000
  });
}

export function useCreateDelegationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      fromUserId?: number;
      toUserId: number;
      scope?: string;
      startDate: string;
      endDate: string;
      reason?: string;
    }) => {
      return fetchJson('/workflow/delegations', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow', 'delegations'] });
      queryClient.invalidateQueries({ queryKey: ['workflow', 'tasks'] });
      toast.success('تفویض اختیار جدید با موفقیت ایجاد گردید');
    },
    onError: (err: any) => {
      toast.error(err.message || 'خطا در ثبت تفویض اختیار');
    }
  });
}

export function useRevokeDelegationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      return fetchJson(`/workflow/delegations/${id}/revoke`, {
        method: 'POST'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow', 'delegations'] });
      queryClient.invalidateQueries({ queryKey: ['workflow', 'tasks'] });
      toast.success('تفویض اختیار با موفقیت لغو گردید');
    },
    onError: (err: any) => {
      toast.error(err.message || 'خطا در لغو تفویض اختیار');
    }
  });
}



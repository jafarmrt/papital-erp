import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { invalidatePreset } from '../../lib/queryInvalidation';
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
  isInitiatorExcluded?: number;
  isInitiatorOnly?: number;
  approvalRuleType?: string;
  kValue?: number;
  autoActionKey?: string;
  /** v7.0.89 (TD-085): متن فارسی شرط‌های اقدام */
  conditions?: string[];
  conditionsMatch?: 'AND' | 'OR';
}

/** v7.0.89 (TD-085): اقدامی که نقش کاربر اجازه می‌دهد ولی شرط‌هایش برقرار نیست */
export interface WorkflowBlockedTransition {
  id: number;
  title: string;
  actionKey: string;
  conditions: string[];
  conditionsMatch: 'AND' | 'OR';
  unmetConditions: string[];
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
  /** v10.0.65 (TD-1142): without an instance, whether an active definition exists for the entity type */
  startable?: boolean;
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
  blockedTransitions?: WorkflowBlockedTransition[];
  history?: WorkflowHistoryLog[];
  approvalProgress?: Record<string, any>;
  entityContext?: Record<string, any>;
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
      void invalidatePreset(queryClient, 'workflowChange');
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.workflow.instance(variables.entityType, variables.entityId)
      });
      toast.success('گردش کار آغاز شد.');
    },
    onError: (err: any) => {
      toast.error(err.message || 'گردش کار آغاز نشد؛ دوباره تلاش کنید.');
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
      void invalidatePreset(queryClient, 'workflowChange');
      if (variables.entityType && variables.entityId) {
        void queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.workflow.instance(variables.entityType, variables.entityId)
        });
      }
      toast.success('اقدام ثبت شد.');
    },
    onError: (err: any) => {
      toast.error(err.message || 'اقدام ثبت نشد؛ دوباره تلاش کنید.');
    }
  });
}

export function useWorkflowDefinitionsQuery() {
  return useQuery({
    queryKey: QUERY_KEYS.workflow.definitions(),
    queryFn: async () => {
      return fetchJson('/workflow/definitions');
    }
  });
}

export function useWorkflowDefinitionDetailQuery(id?: number) {
  return useQuery({
    queryKey: QUERY_KEYS.workflow.definition(id),
    queryFn: async () => {
      if (!id) return null;
      return fetchJson(`/workflow/definitions/${id}`);
    },
    enabled: Boolean(id)
  });
}

export interface WorkflowVersionSnapshotState {
  id: number;
  stateKey: string;
  title: string;
  stateType?: string | null;
}

export interface WorkflowVersionSnapshotTransition {
  id: number;
  fromStateId: number;
  toStateId: number;
  title: string;
  requiredRole?: string | null;
}

export interface WorkflowDefinitionVersion {
  id: number;
  definitionId: number;
  version: number;
  title: string;
  description: string;
  createdAt: string;
  dslJson: {
    states?: WorkflowVersionSnapshotState[];
    transitions?: WorkflowVersionSnapshotTransition[];
  };
}

/** v7.0.87 (TD-112): تاریخچه فقط‌خواندنی نسخه‌های یک تعریف؛ ذخیره تعریف آن را تازه می‌کند (پیشوند کلید definitions) */
export function useWorkflowDefinitionVersionsQuery(id?: number) {
  return useQuery({
    queryKey: QUERY_KEYS.workflow.definitionVersions(id),
    queryFn: async (): Promise<WorkflowDefinitionVersion[]> => {
      const res = await fetchJson(`/workflow/definitions/${id}/versions`);
      return Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
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
      // TD-469: پیشوند definitions جزئیات و نسخه‌ها را هم دربرمی‌گیرد (پیش‌تر کلید جزئیات ['workflow','definition',id] بود)
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workflow.definitions() });
      toast.success('طرح گردش کار ذخیره شد.');
    },
    onError: (err: any) => {
      toast.error(err.message || 'طرح گردش کار ذخیره نشد؛ دوباره تلاش کنید.');
    }
  });
}

export function useUpdateCanvasPositionsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ definitionId, positions }: { definitionId: number; positions: Array<{ id: number; positionX: number; positionY: number }> }) => {
      return fetchJson('/workflow/positions', {
        method: 'POST',
        body: JSON.stringify({ definitionId, positions })
      });
    },
    // TD-469: پیش‌تر کش جزئیات تازه نمی‌شد و باز کردن دوباره طراح مختصات قدیم را نشان می‌داد و ذخیره آن را برمی‌گرداند
    onSuccess: (_res, variables) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workflow.definition(variables.definitionId) });
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

/** v10.0.133 (TD-1224) */
export const TASK_ALREADY_DONE_MESSAGE = 'این کار را کاربر دیگری پیش‌تر انجام داده است؛ کارتابل تازه شد.';

export function useExecuteTaskMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { taskId: number; action?: 'approve' | 'reject'; transitionId?: number; comment?: string; snapshotData?: Record<string, unknown> }) => {
      return fetchJson(`/workflow/tasks/${payload.taskId}/execute`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    },
    onSuccess: (res: { message?: string; data?: { code?: string; task?: { status?: string } } }) => {
      void invalidatePreset(queryClient, 'workflowChange');
      void queryClient.invalidateQueries({ queryKey: ['workflow', 'tasks'] });
      // v10.0.133 (TD-1224): کاری که دیگری پیش‌تر انجام داده، کار این کاربر نیست؛ پیام سبز «کار انجام شد» نمی‌گیرد
      if (res?.data?.code === 'WF_TASK_ALREADY_COMPLETED') {
        toast(TASK_ALREADY_DONE_MESSAGE, { icon: 'ℹ️' });
        return;
      }
      // v8.0.91 (TD-371): امضای ناقص حدنصاب کار را باز می‌گذارد؛ پیام سرور شمار امضاها را می‌گوید
      toast.success(res?.data?.task?.status === 'pending' && res.message ? res.message : 'کار انجام شد.');
    },
    onError: (err: any) => {
      toast.error(err.message || 'کار انجام نشد؛ دوباره تلاش کنید.');
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
      void queryClient.invalidateQueries({ queryKey: ['workflow', 'delegations'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow', 'tasks'] });
      toast.success('تفویض اختیار ثبت شد.');
    },
    onError: (err: any) => {
      toast.error(err.message || 'تفویض اختیار ثبت نشد؛ دوباره تلاش کنید.');
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
      void queryClient.invalidateQueries({ queryKey: ['workflow', 'delegations'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow', 'tasks'] });
      toast.success('تفویض اختیار لغو شد.');
    },
    onError: (err: any) => {
      toast.error(err.message || 'تفویض اختیار لغو نشد؛ دوباره تلاش کنید.');
    }
  });
}



import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type {
  MyWorkshopDeliveries, MyWorkshopTasks, ProjectWorkshopReports, WorkshopApproveResult, WorkshopReportView, WorkshopReviewItem,
} from '../../lib/workshop/workshopContract';

/**
 * v10.1.40 (N-01 part 3): the workshop cartable's reads and writes (`/api/workshop/...`, part 2). Every write refreshes
 * the cartable; an approval also refreshes the piecework logs and the projects, since it writes a work log and links the
 * schedule row.
 */

const WORKSHOP_KEY = ['workshop'] as const;

export function useMyWorkshopTasksQuery(enabled: boolean) {
  return useQuery({
    queryKey: [...WORKSHOP_KEY, 'my-tasks'],
    queryFn: () => fetchJson('/workshop/my-tasks') as Promise<MyWorkshopTasks>,
    staleTime: 30000,
    enabled,
  });
}

export function useMyWorkshopDeliveriesQuery(enabled: boolean) {
  return useQuery({
    queryKey: [...WORKSHOP_KEY, 'my-deliveries'],
    queryFn: () => fetchJson('/workshop/my-deliveries') as Promise<MyWorkshopDeliveries>,
    staleTime: 30000,
    enabled,
  });
}

export function useWorkshopReviewQuery(enabled: boolean) {
  return useQuery({
    queryKey: [...WORKSHOP_KEY, 'review'],
    queryFn: async () => {
      const res = (await fetchJson('/workshop/review/reports')) as { data?: unknown };
      return Array.isArray(res?.data) ? (res.data as WorkshopReviewItem[]) : [];
    },
    staleTime: 30000,
    enabled,
  });
}

export function useProjectWorkshopReportsQuery(projectId: number, enabled: boolean) {
  return useQuery({
    queryKey: [...WORKSHOP_KEY, 'project', projectId],
    queryFn: () => fetchJson(`/workshop/projects/${projectId}/reports`) as Promise<ProjectWorkshopReports>,
    staleTime: 30000,
    enabled: enabled && projectId > 0,
  });
}

const post = (url: string, body: unknown, method: 'POST' | 'PUT' = 'POST') =>
  fetchJson(url, { method, body: JSON.stringify(body) });

/** One mutation for every cartable write; the caller passes the request and reads the answer. */
export function useWorkshopMutation<TInput, TResult>(send: (input: TInput) => Promise<TResult>, opts: { touchesWorkLogs?: boolean } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: WORKSHOP_KEY });
      if (opts.touchesWorkLogs) {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.piecework.all });
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.projects.all });
      }
    },
  });
}

export interface ReportRef { projectId: number; stageId: number; productId: string; rowId: string }

export const workshopRequests = {
  submitReport: (input: ReportRef & { quantity: string; notes: string }) =>
    post('/workshop/reports', input) as Promise<{ report: WorkshopReportView }>,
  editReport: (input: { id: number; version: number; quantity: string; notes: string }) =>
    post(`/workshop/reports/${input.id}`, { version: input.version, quantity: input.quantity, notes: input.notes }, 'PUT') as Promise<{ report: WorkshopReportView }>,
  withdrawReport: (input: { id: number; version: number }) =>
    post(`/workshop/reports/${input.id}/withdraw`, { version: input.version }) as Promise<{ report: WorkshopReportView }>,
  confirmDelivery: (input: { kind: 'document' | 'allocation'; id: number; status: 'received' | 'discrepancy'; note: string }) =>
    post('/workshop/deliveries/confirm', input),
  approveReport: (input: { id: number; version: number; quantity?: string; date?: string; note: string; acknowledgedManualLogIds?: number[] }) =>
    post(`/workshop/reports/${input.id}/approve`, {
      version: input.version, note: input.note,
      ...(input.acknowledgedManualLogIds?.length ? { acknowledgedManualLogIds: input.acknowledgedManualLogIds } : {}),
      ...(input.quantity ? { quantity: input.quantity } : {}),
      ...(input.date ? { date: input.date } : {}),
    }) as Promise<WorkshopApproveResult>,
  rejectReport: (input: { id: number; version: number; reason: string }) =>
    post(`/workshop/reports/${input.id}/reject`, { version: input.version, reason: input.reason }) as Promise<{ report: WorkshopReportView }>,
  tickMatrix: (input: { projectId: number; itemId: number; stageOrder: number; stageTitle: string }) =>
    post(`/projects/${input.projectId}/product-progress`, {
      items: [{ item_id: input.itemId, stage_order: input.stageOrder, stage_title: input.stageTitle, status: 'completed' }],
    }, 'PUT'),
};

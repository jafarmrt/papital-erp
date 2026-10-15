import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { invalidatePreset } from '../../lib/queryInvalidation';
import { errorMessageOf } from '../../utils';

/**
 * v10.1.15 (D-06 part C, OBS-R2-73): what a delegation form reads without the design keys — the scopes of
 * `/workflow/delegation-scopes` and the users of `/users/list-simple` (never the full user directory) — the user's own
 * delegations for «تفویض‌های من», and the system admin's «بستن فرایند» (TD-1265).
 */

export interface DelegationScope { code: string; title: string }
export interface DelegationUser { id: number; username: string; full_name?: string }
export interface DelegationRow {
  id: number;
  fromUserId: number;
  toUserId: number;
  fromUserName: string;
  toUserName: string;
  scope: string;
  scopeTitle?: string | null;
  startDate: string;
  endDate: string;
  reason?: string | null;
  status: 'active' | 'scheduled' | 'expired' | 'revoked';
}

const listOf = <T,>(res: unknown): T[] => {
  const body = res as { data?: unknown } | unknown[] | null;
  if (Array.isArray(body)) return body as T[];
  return Array.isArray(body?.data) ? (body.data as T[]) : [];
};

export function useDelegationScopesQuery(enabled = true) {
  return useQuery({
    queryKey: ['workflow', 'delegation-scopes'],
    queryFn: async () => listOf<DelegationScope>(await fetchJson('/workflow/delegation-scopes')),
    staleTime: 60000,
    enabled,
  });
}

export function useDelegationUsersQuery(enabled = true) {
  return useQuery({
    queryKey: ['users', 'list-simple'],
    queryFn: async () => listOf<DelegationUser>(await fetchJson('/users/list-simple')),
    staleTime: 60000,
    enabled,
  });
}

export function useMyDelegationsQuery(enabled = true) {
  return useQuery({
    queryKey: ['workflow', 'delegations', 'mine'],
    queryFn: async () => listOf<DelegationRow>(await fetchJson('/workflow/delegations?mine=1')),
    staleTime: 30000,
    enabled,
  });
}

/** Persian name of a delegation's scope: «همه گردش‌کارها» or the workflow's title */
export function delegationScopeLabel(scope: string | null | undefined, title?: string | null): string {
  if (['all', '*', ''].includes(String(scope ?? 'ALL').trim().toLowerCase())) return 'همه گردش‌کارها';
  return title ? `گردش کار: ${title}` : 'گردش کار حذف‌شده';
}

export function useTerminateInstanceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { instanceId: number; reason: string; entityType: string; entityId: string | number }) =>
      fetchJson(`/workflow/instances/${payload.instanceId}/terminate`, {
        method: 'POST',
        body: JSON.stringify({ reason: payload.reason }),
      }),
    onSuccess: (_res, variables) => {
      void invalidatePreset(queryClient, 'workflowChange');
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workflow.instance(variables.entityType, variables.entityId) });
      toast.success('فرایند گردش کار بسته شد.');
    },
    onError: (err: unknown) => {
      toast.error(errorMessageOf(err) || 'فرایند بسته نشد؛ دوباره تلاش کنید.');
    },
  });
}

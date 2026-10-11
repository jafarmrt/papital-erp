import { useEffect, useState } from 'react';
import { fetchJson } from '../../api';
import type { RequisitionWorkflowActions } from '../../lib/procurement/requisitionActions';

export type RequisitionActionsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: RequisitionWorkflowActions };

/**
 * OBS-R2-38 (TD-992): اقدام‌های مجاز گام جاری درخواست برای همین کاربر؛ درخواست پیشین با abort لغو می‌شود و خطای خواندن
 * نشان داده می‌شود، نه «بی اقدام».
 */
export function useRequisitionWorkflowActions(requisitionId: number | undefined, status: string, enabled: boolean): RequisitionActionsState {
  const [state, setState] = useState<RequisitionActionsState>({ status: 'loading' });
  useEffect(() => {
    if (!enabled || !requisitionId) return undefined;
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetchJson<{ data: RequisitionWorkflowActions }>(`/api/procurement/requisitions/${requisitionId}/workflow-actions`, { signal: controller.signal })
      .then(res => {
        if (controller.signal.aborted) return;
        const data = res?.data;
        setState({ status: 'ready', data: { hasInstance: Boolean(data?.hasInstance), actions: Array.isArray(data?.actions) ? data.actions : [] } });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: err instanceof Error && err.message ? err.message : 'اقدام‌های گردش کار این درخواست خوانده نشد.' });
      });
    return () => controller.abort();
  }, [requisitionId, status, enabled]);
  return state;
}

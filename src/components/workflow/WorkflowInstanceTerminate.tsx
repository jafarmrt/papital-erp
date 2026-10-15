import React, { useState } from 'react';
import { Ban } from 'lucide-react';
import { useHasPermission } from '../../contexts/AuthContext';
import { useTerminateInstanceMutation } from '../../hooks/queries/useWorkflowDelegationQueries';
import type { WorkflowHistoryLog } from '../../hooks/queries/useWorkflowQueries';
import { WORKFLOW_TERMINATE_PERMISSION } from '../../lib/permissions/workflowPermissions';
import { WORKFLOW_TERMINATE_REASON_MIN, workflowTerminateEffect, workflowTerminateRefusal } from '../../lib/workflow/workflowLifecycle';
import { OFFLINE_SUBMIT_TITLE, PHONE_TAP_TARGET } from '../../lib/pwa/phoneLayout';
import { useOnlineStatus } from '../../lib/pwa/useOnlineStatus';

/**
 * v10.1.16 (D-06 part C, TD-1265): «بستن فرایند» of a running record that cannot move on, for the system-wide workflow key,
 * with a required reason; offered only for record types the server closes (`workflowTerminateRefusal`). A closed record
 * shows that it was closed and why.
 */
export function WorkflowInstanceTerminate({ instance, entityType, entityId, history, onDone }: {
  instance: { id: number; status: string };
  entityType: string;
  entityId: string | number;
  history: WorkflowHistoryLog[];
  onDone?: () => void;
}): React.ReactElement | null {
  const canTerminate = useHasPermission(WORKFLOW_TERMINATE_PERMISSION);
  const online = useOnlineStatus();
  const mutation = useTerminateInstanceMutation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (instance.status === 'TERMINATED') {
    const closed = [...history].reverse().find((h) => h.actionKey === 'terminate');
    return (
      <div role="status" className="mb-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/40 text-xs text-gray-700 dark:text-gray-300">
        این فرایند بسته شده و دیگر اقدامی ندارد.{closed?.comment ? ` دلیل: ${closed.comment}` : ''}
      </div>
    );
  }
  if (instance.status !== 'IN_PROGRESS' || !canTerminate || workflowTerminateRefusal(entityType)) return null;

  const tooShort = reason.trim().length < WORKFLOW_TERMINATE_REASON_MIN;
  const submit = () => {
    mutation.mutate({ instanceId: instance.id, reason: reason.trim(), entityType, entityId }, {
      onSuccess: () => {
        setOpen(false);
        setReason('');
        onDone?.();
      },
    });
  };

  if (!open) {
    return (
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 ${PHONE_TAP_TARGET}`}
        >
          <Ban className="w-3.5 h-3.5" />
          بستن فرایند
        </button>
      </div>
    );
  }

  return (
    <div className="mb-3 p-3 rounded-xl border-2 border-rose-300 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/20 text-xs space-y-2">
      <p className="font-bold text-gray-900 dark:text-white">بستن فرایند گردش کار</p>
      <p className="text-gray-700 dark:text-gray-300">
        فرایند بی تأیید گام‌های باقی‌مانده بسته می‌شود و کارهای کارتابل آن کنار می‌روند. {workflowTerminateEffect(entityType)}
      </p>
      <label className="block font-medium text-gray-700 dark:text-gray-300" htmlFor={`wf-terminate-${instance.id}`}>دلیل بستن (الزامی)</label>
      <textarea
        id={`wf-terminate-${instance.id}`}
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="مثال: گام بررسی امضاکننده‌ای ندارد."
        className="w-full p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className={`px-3 py-1.5 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 ${PHONE_TAP_TARGET}`}>
          انصراف
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={tooShort || mutation.isPending || !online}
          title={online ? undefined : OFFLINE_SUBMIT_TITLE}
          className={`px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50 ${PHONE_TAP_TARGET}`}
        >
          {mutation.isPending ? 'در حال بستن...' : 'بستن فرایند'}
        </button>
      </div>
    </div>
  );
}

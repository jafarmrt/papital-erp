import { toast } from 'react-hot-toast';
import { ApiError } from '../../api';
import { confirmAction } from '../ConfirmDialogHost';
import { errorMessageOf } from '../../utils/formatters';
import { RUNNING_INSTANCES_CONTINUE, workflowDeactivationEffect, workflowDeactivationRefusal } from '../../lib/workflow/workflowLifecycle';
import { useWorkflowLifecycleMutation, type WorkflowDefinitionSummary } from '../../hooks/queries/useWorkflowLifecycle';

/**
 * v10.1.7 (TD-1229, D-06 part A): the confirmations of turning a workflow on and off. Turning one off says what
 * changes for users; activating one whose record type has another active workflow asks before replacing it (ت۲).
 */
export function useWorkflowLifecycleActions() {
  const mutation = useWorkflowLifecycleMutation();
  const fail = (err: unknown, fallback: string) => toast.error(errorMessageOf(err) || fallback);

  const activate = async (def: WorkflowDefinitionSummary) => {
    try {
      await mutation.mutateAsync({ id: def.id, action: 'activate' });
      toast.success(`گردش کار «${def.title}» فعال شد.`);
    } catch (err: unknown) {
      if (!(err instanceof ApiError && err.code === 'WF_ACTIVE_DEFINITION_EXISTS')) {
        fail(err, 'گردش کار فعال نشد؛ دوباره تلاش کنید.');
        return;
      }
      const ok = await confirmAction({
        title: 'جایگزینی گردش کار فعال',
        message: `${err.message} ${RUNNING_INSTANCES_CONTINUE} ادامه می‌دهید؟`,
        confirmText: 'فعال کن و جایگزین شود',
        cancelText: 'انصراف',
      });
      if (!ok) return;
      try {
        const answer = await mutation.mutateAsync({ id: def.id, action: 'activate', replaceActive: true });
        const replaced = answer?.data?.replaced;
        toast.success(replaced ? `گردش کار «${def.title}» فعال و «${replaced.title}» غیرفعال شد.` : `گردش کار «${def.title}» فعال شد.`);
      } catch (again: unknown) {
        fail(again, 'گردش کار فعال نشد؛ دوباره تلاش کنید.');
      }
    }
  };

  const deactivate = async (def: WorkflowDefinitionSummary) => {
    const refusal = workflowDeactivationRefusal(def.entityType);
    if (refusal) {
      toast.error(refusal);
      return;
    }
    const ok = await confirmAction({
      title: 'غیرفعال کردن گردش کار',
      message: `با غیرفعال شدن «${def.title}»: ${workflowDeactivationEffect(def.entityType)} ${RUNNING_INSTANCES_CONTINUE}`,
      confirmText: 'غیرفعال کن',
      cancelText: 'انصراف',
    });
    if (!ok) return;
    try {
      await mutation.mutateAsync({ id: def.id, action: 'deactivate' });
      toast.success(`گردش کار «${def.title}» غیرفعال شد.`);
    } catch (err: unknown) {
      fail(err, 'گردش کار غیرفعال نشد؛ دوباره تلاش کنید.');
    }
  };

  const archive = async (def: WorkflowDefinitionSummary) => {
    const ok = await confirmAction({
      title: 'بایگانی گردش کار',
      message: `«${def.title}» از فهرست اصلی بیرون می‌رود و فقط در «بایگانی» دیده می‌شود. حذف نمی‌شود، چون پرونده‌های گذشته به آن اشاره دارند، و هر زمان می‌توانید آن را بازگردانید.`,
      confirmText: 'بایگانی کن',
      cancelText: 'انصراف',
    });
    if (!ok) return;
    try {
      await mutation.mutateAsync({ id: def.id, action: 'archive' });
      toast.success(`گردش کار «${def.title}» بایگانی شد.`);
    } catch (err: unknown) {
      fail(err, 'گردش کار بایگانی نشد؛ دوباره تلاش کنید.');
    }
  };

  const restore = async (def: WorkflowDefinitionSummary) => {
    try {
      await mutation.mutateAsync({ id: def.id, action: 'restore' });
      toast.success(`گردش کار «${def.title}» از بایگانی بازگشت و غیرفعال است.`);
    } catch (err: unknown) {
      fail(err, 'گردش کار از بایگانی بازنگشت؛ دوباره تلاش کنید.');
    }
  };

  return { activate, deactivate, archive, restore, pending: mutation.isPending };
}

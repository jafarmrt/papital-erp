import { WorkflowTransitionExecutor } from '../workflow/workflowTransitionExecutor.js';
import type { RequisitionWorkflowActions } from '../../lib/procurement/requisitionActions.js';

/**
 * OBS-R2-38 (TD-992): اقدام‌هایی که این کاربر در گام جاری گردش کار درخواست خرید اجرا می‌کند، با همان قاعده ویجت گردش
 * کار (نقش و مجوز امضاکننده، «آغازکننده تأیید نکند»، شرط‌های اقدام). خواننده درخواست خرید آن‌ها را می‌خواند، حتی بی
 * مجوزهای گردش کار، چون دکمه‌های پنجره جزئیات درخواست از همین‌ها ساخته می‌شوند.
 */
export async function requisitionWorkflowActions(
  requisitionId: number,
  user: { id?: number; role?: string; permissions?: string[] },
): Promise<RequisitionWorkflowActions> {
  const data = await WorkflowTransitionExecutor.getInstanceByEntity(
    'purchase_requisition', String(requisitionId), user.id, user.role, user.permissions ?? [],
  );
  if (!data) return { hasInstance: false, actions: [] };
  return {
    hasInstance: true,
    actions: data.availableTransitions.map(t => ({ actionKey: t.actionKey, title: t.title })),
  };
}

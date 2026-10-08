import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { purchaseRequisitions } from '../../db/schema.js';
import { registerWorkflowTransitionAction, workflowEntityNumericId, type WorkflowActionTarget, type WorkflowTransitionEvent } from '../workflow/workflowTransitionActions.js';
import { PROCUREMENT_RECEIVE_PERMISSION } from '../../lib/permissions/procurementPermissions.js';
import type { RequisitionItemWithReceipt } from './requisitionReceipt.js';
import { assertProcurementIncomingDocument, receiveRequisitionItems, RECEIVED_REQUISITION_STATUSES } from './requisitionReceiveAction.js';

/** وضعیت درخواست خرید از گام گردش‌کار؛ گام ناشناخته وضعیت را عوض نمی‌کند (نگاشت executeWorkflowAction از v8.0.71) */
export function requisitionStatusOfStep(stateKey: string, current: string): string {
  switch (stateKey) {
    case 'draft':
    case 'pending':
      return 'pending';
    case 'procurement_review':
      return 'under_review';
    case 'manager_approval':
    case 'ordered':
    case 'received':
    case 'rejected':
      return stateKey;
    default:
      return current;
  }
}

async function lockRequisition(tx: DbExecutor, entityId: string) {
  const id = Number(entityId);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  const [row] = await tx.select().from(purchaseRequisitions)
    .where(and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.isDeleted, 0)))
    .for('update');
  return row;
}

/**
 * v9.0.2 (TD-415، یافته A02-01): وضعیت درخواست خرید از گام مقصد هر انتقال گردش‌کارش می‌آید، در همان تراکنش انتقال و زیر
 * قفل ردیف درخواست، از هر مسیری که انتقال اجرا شود (صفحه تدارکات، کارتابل، روت انتقال، تحویل سفارش). ورود به «دریافت‌شده»
 * کالای درخواست را با receiveRequisitionItems دریافت می‌کند (v8.0.71، TD-326) و خطای آن کل انتقال را برمی‌گرداند؛
 * درخواستی که پیش‌تر دریافت شده دوباره دریافت نمی‌شود.
 *
 * پیش‌تر شنونده workflowEventBus پس از پرتاب پیش از commit، با اتصال جدا وضعیت را می‌نوشت و سفارش‌های پیش‌نویس را تحویل
 * می‌داد: «دریافت کالا»یی که رد و برگشت خورده بود، سفارش را قطعی و کالا را وارد انبار می‌کرد.
 */
export async function applyRequisitionTransition(tx: DbExecutor, event: WorkflowTransitionEvent): Promise<void> {
  const req = await lockRequisition(tx, event.entityId);
  if (!req) return;
  const status = requisitionStatusOfStep(event.toStateKey, req.status);
  const items = status === 'received' && !RECEIVED_REQUISITION_STATUSES.has(req.status)
    ? await receiveRequisitionItems(tx, { id: req.id, code: req.code, projectName: req.projectName, items: req.items as RequisitionItemWithReceipt[] }, {
      username: event.performedByName || 'کارشناس تدارکات',
      allowBackdate: event.allowBackdate,
      assertIncoming: assertProcurementIncomingDocument,
    })
    : req.items;
  await tx.update(purchaseRequisitions)
    .set({ status, items, updatedAt: new Date().toISOString() })
    .where(eq(purchaseRequisitions.id, req.id));
}

/**
 * v9.0.451 (TD-904، یافته P5-P01، تصمیم ت۳ الف): گامی که درخواست را «دریافت‌شده» می‌کند کالای آن را وارد انبار می‌کند، پس
 * از امضاکننده (یا نقش تفویض‌کننده) همان مجوز ثبت قطعی سند رسید را می‌خواهد، از هر مسیر انتقال: روت انتقال، کارتابل،
 * «دریافت کالا»ی صفحه تدارکات و انتقال دریافتِ تحویل سفارش. پیش‌تر گام‌های پیش‌فرض مجوز لازم نداشتند و دارنده
 * `workflow.execute` بی هیچ مجوز انبار کالا را وارد انبار می‌کرد.
 */
export function receivePermissionsOfStep(target: WorkflowActionTarget): string[] {
  return requisitionStatusOfStep(target.toStateKey, '') === 'received' ? [PROCUREMENT_RECEIVE_PERMISSION] : [];
}

export function registerRequisitionWorkflowAction(): void {
  registerWorkflowTransitionAction(['purchase_requisition'], {
    lockEntity: async (tx, entityId) => {
      await lockRequisition(tx, entityId);
    },
    run: applyRequisitionTransition,
    requiredPermissions: receivePermissionsOfStep,
    // v9.0.33 (TD-443): درخواست هست و حذف نشده است
    entityExists: async (tx, entityId) => {
      const id = workflowEntityNumericId(entityId);
      if (id === undefined) return false;
      const [row] = await tx.select({ id: purchaseRequisitions.id }).from(purchaseRequisitions)
        .where(and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.isDeleted, 0)));
      return !!row;
    },
  });
}

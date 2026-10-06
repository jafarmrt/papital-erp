import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documents } from '../../db/schema.js';

/**
 * v9.0.39 (TD-446، یافته B14-04، تصمیم مالک محصول ت۴): فقط سند فروش (فاکتور یا پیش‌فاکتور) با وضعیت پیش‌نویس یا
 * پیش‌فاکتور خودکار وارد گردش کار تأیید می‌شود. رسید، حواله و هر سند قطعی فرایند نمی‌گیرد.
 */
export const APPROVAL_WORKFLOW_DOC_TYPES: ReadonlyArray<string> = ['invoice', 'proforma'];
export const APPROVAL_WORKFLOW_DOC_STATUSES: ReadonlyArray<string> = ['draft', 'proforma'];

export function isApprovalWorkflowDocument(doc: { type: string | null; status: string | null }): boolean {
  return APPROVAL_WORKFLOW_DOC_TYPES.includes(doc.type ?? '') && APPROVAL_WORKFLOW_DOC_STATUSES.includes(doc.status ?? '');
}

/** سند ثبت‌شده (با همان تراکنش خوانده می‌شود) گردش کار تأیید می‌گیرد یا نه */
export async function needsApprovalWorkflow(tx: DbExecutor, documentId: number): Promise<boolean> {
  const [doc] = await tx.select({ type: documents.type, status: documents.status }).from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.isDeleted, 0)));
  return !!doc && isApprovalWorkflowDocument(doc);
}

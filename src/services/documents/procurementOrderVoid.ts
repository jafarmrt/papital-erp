import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documentItems, documents, purchaseRequisitions } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { rebuildOrderedRows, type OrderedRow } from '../../lib/documents/procurementOrderVoid.js';

/**
 * v10.0.94 (TD-1195): درخواست خرید سفارشی که ابطال می‌شود، پیش از کالاها و سند قفل می‌شود (همان ترتیب تحویل سفارش که
 * درخواست را پیش از سند قفل می‌کند)، تا ابطال و تحویل هم‌زمان یک سفارش به بن‌بست نرسند.
 */
export async function lockRequisitionOfOrder(tx: DbExecutor, requisitionId: number | null | undefined): Promise<void> {
  if (!requisitionId) return;
  await tx.select({ id: purchaseRequisitions.id }).from(purchaseRequisitions)
    .where(eq(purchaseRequisitions.id, Number(requisitionId)))
    .for('update');
}

/**
 * پس از ابطال سفارش تحویل‌نشده (سند و سطرهایش حذف نرم شده‌اند)، مقدار سفارش‌شده کالاهای آن در درخواست از سفارش‌های زنده
 * دوباره ساخته می‌شود (`rebuildOrderedRows`) و ردیف ممیزی «درخواست خرید» با همین تراکنش نوشته می‌شود. سفارش تحویل‌شده
 * (قطعی) اینجا بازسازی نمی‌شود؛ مقدار دریافتی آن پرونده TD-912 است.
 */
export async function releaseVoidedProcurementOrder(tx: DbExecutor, doc: {
  id: number;
  refNumber: string | null;
  status: string | null;
  procurementRequisitionId: number | null;
  lineItemIds: number[];
}, username: string): Promise<void> {
  if (!doc.procurementRequisitionId || doc.status === 'final') return;
  const [req] = await tx.select({ id: purchaseRequisitions.id, code: purchaseRequisitions.code, items: purchaseRequisitions.items })
    .from(purchaseRequisitions)
    .where(and(eq(purchaseRequisitions.id, doc.procurementRequisitionId), eq(purchaseRequisitions.isDeleted, 0)));
  if (!req) return;
  const itemIds = new Set(doc.lineItemIds.map(Number).filter(id => id > 0));
  const rows = (Array.isArray(req.items) ? req.items : []) as OrderedRow[];
  if (itemIds.size === 0 && !rows.some(r => r.linkedDocumentIds?.includes(doc.id))) return;
  const liveLines = itemIds.size === 0 ? [] : await tx.select({ itemId: documentItems.itemId, quantity: documentItems.quantity })
    .from(documentItems)
    .innerJoin(documents, eq(documents.id, documentItems.documentId))
    .where(and(
      eq(documents.procurementRequisitionId, req.id),
      eq(documents.isDeleted, 0),
      eq(documentItems.isDeleted, 0),
      inArray(documentItems.itemId, [...itemIds]),
    ));
  const rebuilt = rebuildOrderedRows(rows, liveLines, itemIds, doc.id);
  await tx.update(purchaseRequisitions).set({ items: rebuilt }).where(eq(purchaseRequisitions.id, req.id));
  const changed = rebuilt.flatMap((row, i) => row === rows[i] ? [] : [{ before: rows[i], after: row }]);
  await logActivity({
    tx,
    username,
    action: 'UPDATE',
    entity: 'درخواست خرید',
    entityId: req.id,
    description: `بازگشت مقدار سفارش‌شده درخواست خرید ${req.code} با ابطال سفارش ${doc.refNumber || doc.id}`,
    details: { operation: 'VOID_PROCUREMENT_ORDER', documentId: doc.id, rows: changed },
  });
}

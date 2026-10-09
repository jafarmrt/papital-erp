import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documentItems, documents, purchaseRequisitions } from '../../db/schema.js';
import { AppError, NotFoundError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { fin } from '../../lib/financialDecimal.js';
import { rebuildOrderRows, type RequisitionItemWithReceipt } from './requisitionReceipt.js';
import { requisitionOrderDocuments } from './requisitionReceiveAction.js';
import { describeOverOrders, findOverOrders } from './requisitionOrder.js';

type Line = { itemId: number | null; quantity: string | number | null };
/** همان شکل `LinkedOrderLine` / `LinkedOrderEdit` بسته اسناد (تدارکات آن را import نمی‌کند؛ ریشه ترکیب این دو را وصل می‌کند) */
type LinkedOrderLine = { itemId: number; quantity: number | string };
interface LinkedOrderEdit {
  documentId: number;
  requisitionId: number;
  oldLines: LinkedOrderLine[];
  newLines: LinkedOrderLine[];
  overOrderReason?: string;
  user: string;
}

async function lockedRequisition(tx: DbExecutor, requisitionId: number) {
  const [req] = await tx.select().from(purchaseRequisitions)
    .where(and(eq(purchaseRequisitions.id, requisitionId), eq(purchaseRequisitions.isDeleted, 0)))
    .for('update');
  return req ?? null;
}

/**
 * سطرهای سفارش‌های زنده درخواست (هر وضعیت) و سفارش‌های قطعی زنده؛ با `replace` سطرهای تازه یک سند به‌جای سطرهای ذخیره‌شده
 * آن شمرده می‌شود (ویرایش پیش از نوشتن سطرها).
 */
async function liveOrderLines(
  tx: DbExecutor,
  req: { id: number; items: RequisitionItemWithReceipt[] },
  replace?: { documentId: number; lines: LinkedOrderLine[] },
): Promise<{ ordered: Line[]; received: Line[] }> {
  const orders = await requisitionOrderDocuments(tx, req);
  const ids = orders.map(o => o.id).filter(id => id !== replace?.documentId);
  const rows = ids.length === 0 ? [] : await tx.select({
    documentId: documentItems.documentId, itemId: documentItems.itemId, quantity: documentItems.quantity, status: documents.status,
  }).from(documentItems)
    .innerJoin(documents, eq(documents.id, documentItems.documentId))
    .where(and(inArray(documentItems.documentId, ids), eq(documentItems.isDeleted, 0), eq(documents.isDeleted, 0)));
  const ordered: Line[] = rows.map(r => ({ itemId: r.itemId, quantity: r.quantity.toString() }));
  const received: Line[] = rows.filter(r => r.status === 'final').map(r => ({ itemId: r.itemId, quantity: r.quantity.toString() }));
  if (replace) ordered.push(...replace.lines.map(l => ({ itemId: Number(l.itemId), quantity: l.quantity })));
  return { ordered, received };
}

/**
 * v10.0.39 (TD-912، یافته P5-P03، تصمیم ت۹ الف): ابطال سفارش وصل به درخواست خرید، در تراکنش ابطال و زیر قفل ردیف درخواست،
 * مقدار سفارش‌شده و دریافتی کالاهای همان سفارش را از اسناد زنده دوباره می‌سازد. پیش‌تر انبار و حسابداری برمی‌گشت ولی
 * درخواست «دریافت‌شده» با همان مقدار دریافتی می‌ماند و سفارش دوباره ۴۰۹ می‌گرفت.
 */
async function voidOrder(tx: DbExecutor, voided: { documentId: number; requisitionId: number; user: string }): Promise<void> {
  const req = await lockedRequisition(tx, voided.requisitionId);
  if (!req) return;
  const items = (Array.isArray(req.items) ? req.items : []) as RequisitionItemWithReceipt[];
  const voidedLines = await tx.select({ itemId: documentItems.itemId }).from(documentItems)
    .where(eq(documentItems.documentId, voided.documentId));
  const itemIds = new Set(voidedLines.map(l => Number(l.itemId)).filter(id => id > 0));
  if (itemIds.size === 0) return;
  const { ordered, received } = await liveOrderLines(tx, { id: req.id, items });
  const rebuilt = rebuildOrderRows(items, itemIds, ordered, received);
  await tx.update(purchaseRequisitions).set({ items: rebuilt, updatedAt: new Date().toISOString() })
    .where(eq(purchaseRequisitions.id, req.id));
  await logActivity({
    tx,
    username: voided.user,
    action: 'UPDATE',
    entity: 'درخواست خرید',
    entityId: req.id,
    description: `بازسازی مقدار سفارش‌شده و دریافتی درخواست خرید ${req.code} پس از ابطال سفارش ${voided.documentId}`,
    details: { operation: 'VOID_PROCUREMENT_ORDER', documentId: voided.documentId, before: items, after: rebuilt },
  });
}

/** مقدار سفارش‌شده هر کالا در سفارش‌های زنده دیگرِ درخواست، روی ردیف‌ها (برای `findOverOrders`) */
function rowsWithOrdered(items: RequisitionItemWithReceipt[], ordered: Line[]): RequisitionItemWithReceipt[] {
  const itemIds = new Set(items.map(r => Number(r.itemId)).filter(id => id > 0));
  return rebuildOrderRows(items, itemIds, ordered, []);
}

/**
 * v10.0.40 (TD-913، یافته P5-P04، تصمیم ت۹ الف): ویرایش سطرهای سفارش وصل همان قاعده «سفارش بیش از درخواست با دلیل»
 * (TD-289) را دارد. اگر مقدار بیش از درخواست کالایی با این ویرایش بیشتر شود و دلیلی نیامده باشد ۴۲۲
 * `OVER_ORDER_REASON_REQUIRED`؛ با دلیل، روی ردیف کالا (`overOrders`)، یادداشت درخواست و یادداشت سند ثبت می‌شود. مقدار
 * سفارش‌شده ردیف‌های درخواست با سطرهای تازه دوباره ساخته می‌شود. پیش‌تر ویرایش سفارش ۶ به ۹ بی دلیل پذیرفته می‌شد و
 * تحویلش ۹ دریافت می‌کرد با `overOrders` خالی.
 */
async function editOrder(tx: DbExecutor, edit: LinkedOrderEdit): Promise<{ note: string }> {
  const req = await lockedRequisition(tx, edit.requisitionId);
  if (!req) throw new NotFoundError(`درخواست خرید سفارش ${edit.documentId} یافت نشد.`);
  const items = (Array.isArray(req.items) ? req.items : []) as RequisitionItemWithReceipt[];
  const others = await liveOrderLines(tx, { id: req.id, items }, { documentId: edit.documentId, lines: [] });
  const base = rowsWithOrdered(items, others.ordered);
  const asLines = (lines: LinkedOrderLine[]) => lines.map(l => ({ itemId: Number(l.itemId), quantity: l.quantity }));
  const before = new Map(findOverOrders(base, asLines(edit.oldLines)).map(o => [o.itemId, o.excess]));
  const increased = findOverOrders(base, asLines(edit.newLines))
    .filter(o => fin(o.excess).greaterThan(before.get(o.itemId) ?? 0))
    .map(o => ({ ...o, excess: fin(o.excess).subtract(before.get(o.itemId) ?? 0).toNumber() }));
  const reason = edit.overOrderReason?.trim() || '';
  if (increased.length > 0 && !reason) {
    throw new AppError(
      `سفارش بیش از درخواست خرید ${req.code}: ${describeOverOrders(increased)}. برای ثبت ویرایش، دلیل سفارش بیش از درخواست را وارد کنید.`,
      422, 'OVER_ORDER_REASON_REQUIRED', { overOrders: increased },
    );
  }

  const today = await businessTodayIsoDate();
  const itemIds = new Set([...edit.oldLines, ...edit.newLines].map(l => Number(l.itemId)).filter(id => id > 0));
  const withNew = await liveOrderLines(tx, { id: req.id, items }, { documentId: edit.documentId, lines: edit.newLines });
  const rebuilt = rebuildOrderRows(items, itemIds, withNew.ordered, withNew.received);
  for (const over of increased) {
    const row = rebuilt.find(r => Number(r.itemId) === over.itemId);
    if (row) row.overOrders = [...(row.overOrders ?? []), { quantity: over.excess, reason, user: edit.user, date: today, documentIds: [edit.documentId] }];
  }
  const notes = increased.length > 0
    ? `${req.notes || ''}\n[سفارش بیش از درخواست با ویرایش سفارش (${edit.user}، ${today}): ${reason} — ${describeOverOrders(increased)}]`.trim()
    : req.notes;
  await tx.update(purchaseRequisitions).set({ items: rebuilt, notes, updatedAt: new Date().toISOString() })
    .where(eq(purchaseRequisitions.id, req.id));
  await logActivity({
    tx,
    username: edit.user,
    action: 'UPDATE',
    entity: 'درخواست خرید',
    entityId: req.id,
    description: `ویرایش سفارش ${edit.documentId} درخواست خرید ${req.code}${increased.length > 0 ? ` (سفارش بیش از درخواست با دلیل: ${reason})` : ''}`,
    details: { operation: 'EDIT_PROCUREMENT_ORDER', documentId: edit.documentId, before: items, after: rebuilt, ...(increased.length > 0 ? { overOrders: increased, overOrderReason: reason } : {}) },
  });
  return { note: increased.length > 0 ? `[سفارش بیش از درخواست: ${reason}]` : '' };
}

/** ریشه ترکیب (`registerWorkflowDomainActions`) این را برای بسته اسناد ثبت می‌کند تا ابطال و ویرایش سند سفارش درخواست را به‌روز کنند */
export const procurementOrderHooks = {
  lockRequisition: async (tx: DbExecutor, requisitionId: number): Promise<void> => { await lockedRequisition(tx, requisitionId); },
  editOrder,
  voidOrder,
};
